import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../models/page_elements.dart';
import '../models/stroke.dart';
import '../persistence/page_store.dart';

/// Undoable operations. Every op carries its page slot (page id) so undo
/// works across page switches within the same notebook session.
sealed class InkOp {
  String get slot;
}
class AddStrokeOp extends InkOp {
  @override final String slot;
  final Stroke stroke;
  AddStrokeOp(this.slot, this.stroke);
}
class RemoveStrokesOp extends InkOp {
  @override final String slot;
  final List<Stroke> strokes;
  RemoveStrokesOp(this.slot, this.strokes);
}
class AddElementsOp extends InkOp {
  @override final String slot;
  final List<PageElement> elements;
  AddElementsOp(this.slot, this.elements);
}
class RemoveElementsOp extends InkOp {
  @override final String slot;
  final List<PageElement> elements;
  RemoveElementsOp(this.slot, this.elements);
}
class ReplaceElementOp extends InkOp {
  @override final String slot;
  final PageElement before, after;
  ReplaceElementOp(this.slot, this.before, this.after);
}
class ReorderElementsOp extends InkOp {
  @override final String slot;
  final List<PageElement> before, after; // full z-order snapshots
  ReorderElementsOp(this.slot, this.before, this.after);
}
class TransformOp extends InkOp {
  @override final String slot;
  final List<Stroke> beforeStrokes, afterStrokes;
  final List<PageElement> beforeEls, afterEls;
  TransformOp(this.slot, this.beforeStrokes, this.afterStrokes,
      this.beforeEls, this.afterEls);
}

/// One notebook editing session: current page doc, live stroke, selection,
/// clipboard, undo/redo (200 steps), and audio-sync stamping.
class StrokeEngine extends ChangeNotifier {
  final PageStore store;
  String? currentPageId;
  Stroke? live; // stroke being drawn right now

  static const maxUndo = 200;
  final List<List<InkOp>> _undo = [];
  final List<List<InkOp>> _redo = [];
  bool get canUndo => _undo.isNotEmpty;
  bool get canRedo => _redo.isNotEmpty;

  // selection
  final Set<String> selectedStrokeIds = {};
  final Set<String> selectedElementIds = {};
  bool get hasSelection =>
      selectedStrokeIds.isNotEmpty || selectedElementIds.isNotEmpty;

  // clipboard
  List<Stroke> _clipStrokes = [];
  List<PageElement> _clipElements = [];
  bool get hasClipboard => _clipStrokes.isNotEmpty || _clipElements.isNotEmpty;

  // audio sync
  bool recordingActive = false;
  DateTime? _recStart;
  int? replayCursorMs; // null = normal painting

  // pending eraser batch
  List<Stroke>? _pendingErase;
  String? _pendingEraseSlot;

  StrokeEngine(this.store);

  PageDoc get doc {
    final id = currentPageId;
    if (id == null) return _empty;
    return store.load(id);
  }

  static final _empty = PageDoc('__none__');

  void setCurrentPage(String pageId) {
    if (currentPageId == pageId) return;
    live = null;
    _pendingErase = null;
    clearSelection();
    currentPageId = pageId;
    notifyListeners();
  }

  /// Explicit repaint + persist hook (called after any mutation batch).
  void notifyPageChanged() {
    final id = currentPageId;
    if (id != null) store.markDirty(id);
    notifyListeners();
  }

  // ───────────────────────── live stroke ─────────────────────────

  void beginStroke({
    required PenKind kind, required int colorValue, required double size,
    required Offset first,
  }) {
    live = Stroke(
      id: 'live', kind: kind, colorValue: colorValue, size: size,
      points: [StrokePoint(first.dx, first.dy, 0.4)],
    );
    if (recordingActive && _recStart != null) {
      live!.tStart = DateTime.now().difference(_recStart!).inMilliseconds;
    }
    notifyListeners();
  }

  void extendStroke(Offset p, {double pressure = 0.5}) {
    live?.points.add(StrokePoint(p.dx, p.dy, pressure));
    notifyListeners();
  }

  /// Commits the live stroke and returns it (null if degenerate).
  Stroke? commitStroke() {
    final s = live;
    live = null;
    if (s == null) return null;
    if (s.points.length < 2) {
      final a = s.points.first;
      // dot → keep as micro stroke (2 points)
      s.points.add(StrokePoint(a.dx + 0.5, a.dy + 0.5, a.p));
    }
    if (recordingActive && _recStart != null) {
      s.tEnd = DateTime.now().difference(_recStart!).inMilliseconds;
    }
    final stroke = Stroke(
      id: 's${_counter++}', kind: s.kind, colorValue: s.colorValue,
      size: s.size, points: s.points, tStart: s.tStart, tEnd: s.tEnd,
    );
    doc.strokes.add(stroke);
    _push([AddStrokeOp(currentPageId!, stroke)]);
    notifyPageChanged();
    return stroke;
  }

  void cancelLive() {
    live = null;
    notifyListeners();
  }

  int _counter = 0;

  // ───────────────────────── eraser ─────────────────────────

  /// Stroke eraser: removes strokes near the point. Batched per drag.
  void eraseAt(Offset pt, double radius) {
    final d = doc;
    final hits = d.strokes
        .where((s) => s.hitTest(pt, radius))
        .toList();
    if (hits.isEmpty) return;
    d.strokes.removeWhere((s) => hits.contains(s));
    _pendingEraseSlot = currentPageId;
    _pendingErase ??= [];
    _pendingErase!.addAll(hits);
    notifyListeners();
  }

  /// Area eraser: wipes everything intersecting the rect. One op per gesture.
  void eraseArea(Rect r) {
    final d = doc;
    final hitStrokes = d.strokes.where((s) => s.intersectsRect(r)).toList();
    final hitEls = d.elements.where((e) => e.bbox().overlaps(r)).toList();
    if (hitStrokes.isEmpty && hitEls.isEmpty) return;
    d.strokes.removeWhere((s) => hitStrokes.contains(s));
    d.elements.removeWhere((e) => hitEls.contains(e));
    _push([
      RemoveStrokesOp(currentPageId!, hitStrokes),
      RemoveElementsOp(currentPageId!, hitEls),
    ]);
    notifyPageChanged();
  }

  void endErase() {
    final batch = _pendingErase;
    final slot = _pendingEraseSlot;
    _pendingErase = null;
    _pendingEraseSlot = null;
    if (batch != null && batch.isNotEmpty && slot != null) {
      _push([RemoveStrokesOp(slot, batch)]);
      notifyPageChanged();
    }
  }

  // ───────────────────────── elements ─────────────────────────

  void addElement(PageElement el) {
    doc.elements.add(el);
    _push([AddElementsOp(currentPageId!, [el])]);
    notifyPageChanged();
  }

  void replaceElement(PageElement before, PageElement after) {
    final i = doc.elements.indexOf(before);
    if (i >= 0) doc.elements[i] = after;
    _push([ReplaceElementOp(currentPageId!, before, after)]);
    notifyPageChanged();
  }

  void removeElement(PageElement el) {
    doc.elements.remove(el);
    selectedElementIds.remove(el.id);
    _push([RemoveElementsOp(currentPageId!, [el])]);
    notifyPageChanged();
  }

  /// Atomic multi-op group (e.g. shape recognition replace).
  void applyGroup(List<InkOp> ops) {
    for (final op in ops) {
      final d = store.load(op.slot);
      switch (op) {
        case AddStrokeOp(:final stroke):
          d.strokes.add(stroke);
        case RemoveStrokesOp(:final strokes):
          d.strokes.removeWhere((s) => strokes.contains(s));
        case AddElementsOp(:final elements):
          d.elements.addAll(elements);
        case RemoveElementsOp(:final elements):
          d.elements.removeWhere((e) => elements.contains(e));
        case ReplaceElementOp():
          final i = d.elements.indexOf(op.before);
          if (i >= 0) d.elements[i] = op.after;
        case ReorderElementsOp(:final after):
          d.elements
            ..clear()
            ..addAll(after);
        case TransformOp():
          _applyTransform(d, op, undo: false);
      }
    }
    _push(ops);
    notifyPageChanged();
  }

  /// Replace a committed stroke with a recognized shape element (one undo).
  void replaceStrokeWithElement(Stroke stroke, PageElement el) {
    applyGroup([
      RemoveStrokesOp(currentPageId!, [stroke]),
      AddElementsOp(currentPageId!, [el]),
    ]);
  }

  // ───────────────────────── selection ─────────────────────────

  void selectInLasso(List<Offset> poly) {
    if (poly.length < 3) return;
    clearSelection();
    final d = doc;
    final hit = d.strokes.where((s) => s.insidePolygon(poly)).toList();
    // group expansion — grouped strokes travel together
    final groupIds = hit.map((s) => s.groupId).whereType<String>().toSet();
    for (final s in d.strokes) {
      if (hit.contains(s) ||
          (s.groupId != null && groupIds.contains(s.groupId))) {
        s.selected = true;
        selectedStrokeIds.add(s.id);
      }
    }
    final bb = _polyBbox(poly);
    for (final e in d.elements) {
      if (e.bbox().overlaps(bb) && _polyHitsElement(poly, e)) {
        e.selected = true;
        selectedElementIds.add(e.id);
      }
    }
    notifyListeners();
  }

  bool _polyHitsElement(List<Offset> poly, PageElement e) {
    for (final c in e.corners()) {
      if (Stroke.pointInPoly(c, poly)) return true;
    }
    return false;
  }

  static Rect _polyBbox(List<Offset> poly) {
    var l = poly.first.dx, t = poly.first.dy, r = l, b = t;
    for (final p in poly) {
      if (p.dx < l) l = p.dx;
      if (p.dx > r) r = p.dx;
      if (p.dy < t) t = p.dy;
      if (p.dy > b) b = p.dy;
    }
    return Rect.fromLTRB(l, t, r, b);
  }

  void selectInRect(Rect r) => selectInLasso([
    r.topLeft, r.topRight, r.bottomRight, r.bottomLeft,
  ]);

  void toggleSelectStroke(Stroke s) {
    s.selected = !s.selected;
    if (s.selected) {
      selectedStrokeIds.add(s.id);
      if (s.groupId != null) {
        for (final o in doc.strokes.where((o) => o.groupId == s.groupId)) {
          o.selected = true;
          selectedStrokeIds.add(o.id);
        }
      }
    } else {
      selectedStrokeIds.remove(s.id);
    }
    notifyListeners();
  }

  void toggleSelectElement(PageElement e) {
    e.selected = !e.selected;
    if (e.selected) {
      selectedElementIds.add(e.id);
    } else {
      selectedElementIds.remove(e.id);
    }
    notifyListeners();
  }

  void selectAll() {
    clearSelection();
    for (final s in doc.strokes) {
      s.selected = true;
      selectedStrokeIds.add(s.id);
    }
    for (final e in doc.elements) {
      e.selected = true;
      selectedElementIds.add(e.id);
    }
    notifyListeners();
  }

  void clearSelection() {
    for (final s in store.allCachedStrokes()) {
      s.selected = false;
    }
    for (final e in store.allCachedElements()) {
      e.selected = false;
    }
    selectedStrokeIds.clear();
    selectedElementIds.clear();
    notifyListeners();
  }

  Rect get selectionBbox {
    var r = Rect.zero;
    var first = true;
    for (final s in doc.strokes.where((s) => s.selected)) {
      final b = s.bbox();
      r = first ? b : r.expandToInclude(b);
      first = false;
    }
    for (final e in doc.elements.where((e) => e.selected)) {
      final b = e.bbox();
      r = first ? b : r.expandToInclude(b);
      first = false;
    }
    return r;
  }

  List<Stroke> get selectedStrokes =>
      doc.strokes.where((s) => s.selected).toList();
  List<PageElement> get selectedElements =>
      doc.elements.where((e) => e.selected).toList();

  // ───────────────────────── selection gestures ─────────────────────────

  /// Snapshot selection for an undoable transform gesture.
  void beginSelectionGesture() {
    _gestureBefore = (
      strokes: [for (final s in selectedStrokes) s.deepCopy()],
      elements: [for (final e in selectedElements) e.deepCopy()],
    );
  }

  ({List<Stroke> strokes, List<PageElement> elements}) _gestureBefore =
      (strokes: [], elements: []);

  void translateSelectionBy(Offset d) {
    for (final s in selectedStrokes) {
      s.translateBy(d);
    }
    for (final e in selectedElements) {
      e.translateBy(d);
    }
    notifyListeners();
  }

  void scaleSelectionBy(double factor, Offset anchor) {
    for (final s in selectedStrokes) {
      s.scaleBy(factor, anchor);
    }
    for (final e in selectedElements) {
      e.scaleBy(factor, anchor);
    }
    notifyListeners();
  }

  void rotateSelectionBy(double rad, Offset center) {
    for (final s in selectedStrokes) {
      s.rotateBy(rad, center);
    }
    for (final e in selectedElements) {
      e.rotateBy(rad, center);
    }
    notifyListeners();
  }

  void commitSelectionGesture() {
    if (_gestureBefore.strokes.isEmpty && _gestureBefore.elements.isEmpty) {
      return;
    }
    _push([TransformOp(
      currentPageId!,
      _gestureBefore.strokes,
      [for (final s in selectedStrokes) s.deepCopy()],
      _gestureBefore.elements,
      [for (final e in selectedElements) e.deepCopy()],
    )]);
    _gestureBefore = (strokes: [], elements: []);
    notifyPageChanged();
  }

  // ───────────────────────── clipboard / z-order / groups ─────────────────

  void copySelection() {
    _clipStrokes = [for (final s in selectedStrokes) s.deepCopy()];
    _clipElements = [for (final e in selectedElements) e.deepCopy()];
  }

  void cutSelection() {
    copySelection();
    deleteSelection();
  }

  void pasteAt([Offset? at]) {
    if (!hasClipboard) return;
    final anchor = at == null ? null : _clipAnchor();
    final strokes = <Stroke>[];
    for (final s in _clipStrokes) {
      final c = s.deepCopy(newId: 's${_counter++}')
        ..translateBy(at == null ? const Offset(24, 24) : at - anchor!);
      strokes.add(c);
    }
    final elements = <PageElement>[];
    for (final e in _clipElements) {
      final c = e.deepCopy(newId: 'e${_counter++}')
        ..translateBy(at == null ? const Offset(24, 24) : at - anchor!);
      elements.add(c);
    }
    doc.strokes.addAll(strokes);
    doc.elements.addAll(elements);
    _push([
      for (final s in strokes) AddStrokeOp(currentPageId!, s),
      if (elements.isNotEmpty) AddElementsOp(currentPageId!, elements),
    ]);
    clearSelection();
    for (final s in strokes) {
      s.selected = true;
      selectedStrokeIds.add(s.id);
    }
    for (final e in elements) {
      e.selected = true;
      selectedElementIds.add(e.id);
    }
    notifyPageChanged();
  }

  /// Center of clipboard content (for anchored paste).
  Offset _clipAnchor() {
    var r = Rect.zero;
    var first = true;
    for (final s in _clipStrokes) {
      final b = s.bbox();
      r = first ? b : r.expandToInclude(b);
      first = false;
    }
    for (final e in _clipElements) {
      final b = e.bbox();
      r = first ? b : r.expandToInclude(b);
      first = false;
    }
    return r.center;
  }

  void deleteSelection() {
    final strokes = selectedStrokes;
    final elements = selectedElements;
    doc.strokes.removeWhere((s) => s.selected);
    doc.elements.removeWhere((e) => e.selected);
    _push([
      if (strokes.isNotEmpty) RemoveStrokesOp(currentPageId!, strokes),
      if (elements.isNotEmpty) RemoveElementsOp(currentPageId!, elements),
    ]);
    clearSelection();
    notifyPageChanged();
  }

  void groupSelection() {
    final gid = 'g${_counter++}';
    for (final s in selectedStrokes) {
      s.groupId = gid;
    }
    notifyPageChanged();
  }

  void ungroupSelection() {
    for (final s in selectedStrokes) {
      s.groupId = null;
    }
    notifyPageChanged();
  }

  void bringSelectionToFront() {
    final d = doc;
    final els = d.elements.where((e) => e.selected).toList();
    final before = [for (final e in d.elements) e];
    d.elements.removeWhere((e) => e.selected);
    d.elements.addAll(els);
    final strokes = d.strokes.where((s) => s.selected).toList();
    d.strokes.removeWhere((s) => s.selected);
    d.strokes.addAll(strokes);
    _push([ReorderElementsOp(currentPageId!, before, [for (final e in d.elements) e])]);
    notifyPageChanged();
  }

  void sendSelectionToBack() {
    final d = doc;
    final els = d.elements.where((e) => e.selected).toList();
    final before = [for (final e in d.elements) e];
    d.elements.removeWhere((e) => e.selected);
    d.elements.insertAll(0, els);
    final strokes = d.strokes.where((s) => s.selected).toList();
    d.strokes.removeWhere((s) => s.selected);
    d.strokes.insertAll(0, strokes);
    _push([ReorderElementsOp(currentPageId!, before, [for (final e in d.elements) e])]);
    notifyPageChanged();
  }

  // ───────────────────────── audio sync ─────────────────────────

  void beginRecordingSync() {
    recordingActive = true;
    _recStart = DateTime.now();
    notifyListeners();
  }

  void endRecordingSync() {
    recordingActive = false;
    _recStart = null;
    notifyListeners();
  }

  /// Audio replay: null = paint normally; ms = ghost future strokes and
  /// spotlight strokes drawn before [ms].
  void setReplayCursor(int? ms) {
    replayCursorMs = ms;
    notifyListeners();
  }

  // ───────────────────────── undo / redo ─────────────────────────

  void _push(List<InkOp> ops) {
    _undo.add(ops);
    if (_undo.length > maxUndo) _undo.removeAt(0);
    _redo.clear();
  }

  void undo() {
    if (_undo.isEmpty) return;
    final ops = _undo.removeLast();
    for (final op in ops.reversed) {
      _invert(op);
    }
    _redo.add(ops);
    clearSelection();
    notifyPageChanged();
  }

  void redo() {
    if (_redo.isEmpty) return;
    final ops = _redo.removeLast();
    for (final op in ops) {
      _apply(op);
    }
    _undo.add(ops);
    clearSelection();
    notifyPageChanged();
  }

  void _apply(InkOp op) {
    final d = store.load(op.slot);
    switch (op) {
      case AddStrokeOp(:final stroke):
        d.strokes.add(stroke);
      case RemoveStrokesOp(:final strokes):
        d.strokes.removeWhere((s) => strokes.any((x) => x.id == s.id));
      case AddElementsOp(:final elements):
        d.elements.addAll(elements);
      case RemoveElementsOp(:final elements):
        d.elements.removeWhere((e) => elements.any((x) => x.id == e.id));
      case ReplaceElementOp():
        final i = d.elements.indexOf(op.before);
        if (i >= 0) d.elements[i] = op.after;
      case ReorderElementsOp(:final after):
        d.elements
          ..clear()
          ..addAll(after);
      case TransformOp():
        _applyTransform(d, op, undo: false);
    }
  }

  void _invert(InkOp op) {
    final d = store.load(op.slot);
    switch (op) {
      case AddStrokeOp(:final stroke):
        d.strokes.removeWhere((s) => s.id == stroke.id);
      case RemoveStrokesOp(:final strokes):
        d.strokes.addAll(strokes);
      case AddElementsOp(:final elements):
        d.elements.removeWhere((e) => elements.any((x) => x.id == e.id));
      case RemoveElementsOp(:final elements):
        d.elements.addAll(elements);
      case ReplaceElementOp():
        final i = d.elements.indexWhere((e) => e.id == op.after.id);
        if (i >= 0) d.elements[i] = op.before;
      case ReorderElementsOp(:final before):
        d.elements
          ..clear()
          ..addAll(before);
      case TransformOp():
        _applyTransform(d, op, undo: true);
    }
  }

  void _applyTransform(PageDoc d, TransformOp op, {required bool undo}) {
    final srcS = undo ? op.beforeStrokes : op.afterStrokes;
    final srcE = undo ? op.beforeEls : op.afterEls;
    for (final s in srcS) {
      final i = d.strokes.indexWhere((x) => x.id == s.id);
      if (i >= 0) d.strokes[i] = s;
    }
    for (final e in srcE) {
      final i = d.elements.indexWhere((x) => x.id == e.id);
      if (i >= 0) d.elements[i] = e;
    }
  }
}
