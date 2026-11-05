import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';

import '../controllers/laser_controller.dart';
import '../controllers/pdf_document_controller.dart' show PdfLibrary;
import '../controllers/stroke_engine.dart';
import '../controllers/tool_controller.dart';
import '../controllers/viewport_controller.dart';
import '../models/library_models.dart';
import '../models/page_elements.dart';
import '../models/paper.dart';
import '../models/settings.dart';
import '../models/stroke.dart';
import '../models/tool.dart';
import '../controllers/shape_recognizer.dart';
import 'doc_geometry.dart';
import 'ruler_overlay.dart';

enum _Mode { idle, draw, shape, eraseStroke, eraseArea, lasso, laser,
  selectMove, selectTransform, rulerBody, rulerHandle, pan, pinch, touchPan }

class _Pointer {
  final int id;
  final PointerDeviceKind kind;
  final Offset start, startPos;
  final int buttons;
  final DateTime downAt;
  final bool stylus;
  Offset last;
  bool moved = false;
  double pressure = 0.5;
  _Pointer({
    required this.id, required this.kind, required this.start,
    required this.startPos, required this.buttons, required this.downAt,
    required this.stylus, required this.last, this.pressure = 0.5,
  });
}

/// The full input state machine (port of the web GestureRouter):
///  • stylus drawing with pressure + barrel buttons (bitmask, temporary tool)
///  • palm rejection (stylus in proximity ⇒ fingers pan, never draw)
///  • two-finger pinch zoom & pan; two fingers ON selection ⇒ move+scale+rotate
///  • lasso selection with group expansion; taps toggle; empty tap clears
///  • ruler body drag / handle rotate (15° magnets) + draw snapping
///  • stroke eraser (batched per drag) & area eraser
///  • shape tool drag with square/angle snapping
///  • shape recognition on pen lift + 650ms hold
///  • laser trail; text placement taps; double-tap to edit text
///  • mouse wheel / trackpad pan
class GestureRouter extends StatefulWidget {
  final Widget child;
  final DocGeometry geometry;
  final ViewportController viewport;
  final StrokeEngine engine;
  final ToolController tools;
  final LaserController laser;
  final RulerModel ruler;
  final PdfLibrary pdfs;
  final AppSettings settings;
  final ToolActionHost host;
  final void Function(int pageIndex, Offset pagePoint) onPlaceText;
  final void Function(TextEl el, int pageIndex) onEditText;

  const GestureRouter({
    super.key,
    required this.child,
    required this.geometry,
    required this.viewport,
    required this.engine,
    required this.tools,
    required this.laser,
    required this.ruler,
    required this.pdfs,
    required this.settings,
    required this.host,
    required this.onPlaceText,
    required this.onEditText,
  });

  @override
  State<GestureRouter> createState() => _GestureRouterState();
}

class _GestureRouterState extends State<GestureRouter> {
  _Mode _mode = _Mode.idle;
  final Map<int, _Pointer> _pointers = {};
  int _stylusActive = 0;
  DateTime _stylusHoverUntil = DateTime.fromMillisecondsSinceEpoch(0);
  Tool? _barrelTool; // temporary tool while barrel held
  DateTime _lastBarrelTap = DateTime.fromMillisecondsSinceEpoch(0);
  DateTime _lastTipTap = DateTime.fromMillisecondsSinceEpoch(0);
  Offset _lastTipTapPos = Offset.zero;
  Timer? _holdTimer;

  // gesture-scoped data
  int _page = 0;
  Offset _anchorPt = Offset.zero; // page-point space
  Offset _lastPt = Offset.zero;
  final List<Offset> _lasso = []; // doc space
  Rect? _areaRect; // doc space
  Offset? _pinchFocalPrev;
  double _pinchDistPrev = 0;
  double _baseAngle = 0;
  Offset _selAnchor = Offset.zero; // doc space center at gesture start
  int _rulerHandle = -1;
  Stroke? _pendingRec; // committed stroke awaiting recognition

  final ValueNotifier<Offset?> eraserCursor = ValueNotifier(null);

  // overlay repaint ping
  final ChangeNotifier _fx = ChangeNotifier();

  DocGeometry get g => widget.geometry;
  ViewportController get vp => widget.viewport;
  StrokeEngine get eng => widget.engine;
  ToolController get tl => widget.tools;

  Tool get _effectiveTool => _barrelTool ?? tl.tool;

  bool get _stylusNearby =>
      _stylusActive > 0 ||
          DateTime.now().isBefore(_stylusHoverUntil);

  bool get _touchCanDraw =>
      !widget.settings.palmRejection || !_stylusNearby;

  // ───────────────────────── coordinate helpers ─────────────────────────

  Offset _docOf(Offset screen) => vp.screenToDoc(screen);
  int _pageOf(Offset docPos) => g.pageAt(docPos);

  Offset _pagePtOf(Offset screen) {
    final doc = _docOf(screen);
    final p = _pageOf(doc);
    final idx = p < 0 ? _page : p;
    return g.docToPoints(idx, doc);
  }

  double _screenPerPagePoint(int page) => vp.scale / g.pointScale(page);

  // ───────────────────────── pointer plumbing ─────────────────────────

  @override
  Widget build(BuildContext context) {
    return Listener(
      behavior: HitTestBehavior.opaque,
      onPointerDown: _onDown,
      onPointerMove: _onMove,
      onPointerUp: _onUp,
      onPointerCancel: _onUp,
      onPointerHover: _onHover,
      onPointerSignal: _onSignal,
      child: Stack(fit: StackFit.expand, children: [
        widget.child,
        Positioned.fill(
          child: IgnorePointer(
            child: AnimatedBuilder(
              animation: Listenable.merge([_fx, widget.ruler, eraserCursor]),
              builder: (_, __) => CustomPaint(
                painter: _OverlayPainter(router: this),
              ),
            ),
          ),
        ),
      ]),
    );
  }

  void _ping() => _fx.notifyListeners();

  void _onDown(PointerDownEvent e) {
    final stylus = e.kind == PointerDeviceKind.stylus ||
        e.kind == PointerDeviceKind.invertedStylus;
    final p = _Pointer(
      id: e.pointer, kind: e.kind, start: e.position, startPos: e.localPosition,
      buttons: e.buttons, downAt: DateTime.now(), stylus: stylus,
      last: e.localPosition, pressure: e.pressure,
    );
    _pointers[e.pointer] = p;

    if (stylus) {
      _stylusActive++;
      _stylusHoverUntil = DateTime.fromMillisecondsSinceEpoch(0);
      _onStylusDown(p, e);
      return;
    }
    if (e.kind == PointerDeviceKind.touch) {
      _onTouchDown(p, e);
      return;
    }
    if (e.kind == PointerDeviceKind.mouse) {
      _onMouseDown(p, e);
    }
  }

  // ── stylus ──

  void _onStylusDown(_Pointer p, PointerDownEvent e) {
    _holdTimer?.cancel();

    // barrel buttons → temporary tool / instant action
    if (e.buttons != 0 && e.buttons != kPrimaryButton) {
      final action = tl.actionForButtons(e.buttons, widget.settings.pen);
      final now = DateTime.now();
      final isDouble = now.difference(_lastBarrelTap) <
          const Duration(milliseconds: 350);
      _lastBarrelTap = now;
      final chosen = isDouble ? widget.settings.pen.doubleTap : action;
      if (chosen != PenAction.none) {
        if (chosen.tool != null) {
          _barrelTool = chosen.tool;
        } else {
          _dispatch(chosen);
        }
      }
    } else {
      // tip down — double-tap check (for shortcut actions)
      final now = DateTime.now();
      if (now.difference(_lastTipTap) < const Duration(milliseconds: 320) &&
          (e.localPosition - _lastTipTapPos).distance < 32 &&
          _effectiveTool == Tool.pen) {
        final act = widget.settings.pen.doubleTap;
        if (act.tool == null) _dispatch(act);
        _lastTipTap = DateTime.fromMillisecondsSinceEpoch(0);
      } else {
        _lastTipTap = now;
        _lastTipTapPos = e.localPosition;
      }
    }

    // press & hold timer
    _holdTimer = Timer(const Duration(milliseconds: 650), () {
      if (_mode == _Mode.draw && !p.moved) {
        final act = widget.settings.pen.pressHold;
        if (act.tool == null && act != PenAction.none) {
          _finishStroke(recognize: false);
          _dispatch(act);
        }
      }
    });

    _beginToolGesture(p, e.localPosition, e.pressure);
  }

  void _onTouchDown(_Pointer p, PointerDownEvent e) {
    final touches = _pointers.values
        .where((x) => x.kind == PointerDeviceKind.touch).length;
    if (touches == 2) {
      _startPinch();
      return;
    }
    if (touches > 2) return;

    // selection transform? (2nd finger arrives while moving selection)
    if (_mode == _Mode.selectMove) {
      _startSelectTransform();
      return;
    }

    if (_touchCanDraw && _effectiveTool.draws) {
      _beginToolGesture(p, e.localPosition, 0.5);
    } else if (_mode == _Mode.idle) {
      _mode = _Mode.touchPan;
    }
  }

  void _onMouseDown(_Pointer p, PointerDownEvent e) {
    // mouse: left = draw, middle/right = pan
    if (e.buttons & kPrimaryButton != 0) {
      if (_effectiveTool == Tool.pan) {
        _mode = _Mode.pan;
      } else {
        _beginToolGesture(p, e.localPosition, e.pressure);
      }
    } else {
      _mode = _Mode.pan;
    }
  }

  void _startPinch() {
    // two touches — maybe a selection transform instead of zoom
    if (eng.hasSelection && _bothTouchesOnSelection()) {
      _startSelectTransform();
      return;
    }
    _cancelActive(cancelStroke: true);
    _mode = _Mode.pinch;
    _updatePinchRefs();
  }

  bool _bothTouchesOnSelection() {
    final sel = eng.selectionBbox;
    if (sel.isEmpty) return false;
    var hits = 0;
    for (final p in _pointers.values) {
      if (p.kind != PointerDeviceKind.touch) continue;
      final doc = _docOf(p.last);
      if (sel.inflate(24).contains(doc)) hits++;
    }
    return hits >= 2;
  }

  void _updatePinchRefs() {
    final touches = _pointers.values
        .where((x) => x.kind == PointerDeviceKind.touch).toList();
    if (touches.length < 2) return;
    final a = touches[0].last, b = touches[1].last;
    _pinchFocalPrev = (a + b) / 2;
    _pinchDistPrev = (a - b).distance;
  }

  // ── start a tool gesture (stylus / touch-draw / mouse) ──

  void _beginToolGesture(_Pointer p, Offset screen, double pressure) {
    final doc = _docOf(screen);
    final pageIdx = _pageOf(doc);
    if (pageIdx < 0) {
      _mode = _Mode.touchPan;
      return;
    }
    _page = pageIdx;
    if (eng.currentPageId != g.pages[pageIdx].id) {
      eng.setCurrentPage(g.pages[pageIdx].id);
    }
    var pt = g.docToPoints(pageIdx, doc);

    // ruler interactions take priority
    if (widget.ruler.active) {
      final handleTol = 22 / vp.scale;
      final h = widget.ruler.hitHandle(doc, handleTol);
      if (h >= 0) {
        _mode = _Mode.rulerHandle;
        _rulerHandle = h;
        return;
      }
      if (widget.ruler.hitBody(doc, 24 / vp.scale)) {
        _mode = _Mode.rulerBody;
        return;
      }
      // drawing near the ruler snaps
      if (_effectiveTool.isInk &&
          widget.ruler.distanceTo(doc) < 26 / vp.scale) {
        pt = g.docToPoints(pageIdx, widget.ruler.project(doc));
      }
    }

    _anchorPt = pt;
    _lastPt = pt;

    switch (_effectiveTool) {
      case Tool.pen:
      case Tool.highlighter:
        eng.beginStroke(
          kind: tl.activePenKind,
          colorValue: tl.activeColorValue,
          size: tl.activeSize,
          first: pt,
        );
        _mode = _Mode.draw;
      case Tool.eraser:
        _mode = tl.areaEraser ? _Mode.eraseArea : _Mode.eraseStroke;
        if (_mode == _Mode.eraseStroke) {
          eng.eraseAt(pt, _eraserRadiusPage());
        } else {
          _areaRect = Rect.fromPoints(pt, pt);
        }
      case Tool.laser:
        widget.laser.begin(doc, tail: widget.settings.laserTailMode);
        _mode = _Mode.laser;
      case Tool.shape:
        _mode = _Mode.shape;
        _ping();
      case Tool.selector:
        _startSelector(doc, pt);
      case Tool.text:
        _mode = _Mode.idle; // tap handled on up
      case Tool.pan:
        _mode = _Mode.pan;
      case Tool.image:
      case Tool.sticker:
      case Tool.audio:
      case Tool.translate:
      case Tool.ruler:
        _mode = _Mode.idle; // panel tools handled by the rail
        break;
    }
  }

  double _eraserRadiusPage() =>
      tl.eraserRadius / _screenPerPagePoint(_page);

  void _startSelector(Offset doc, Offset pt) {
    // dragging an existing selection?
    if (eng.hasSelection) {
      final sel = eng.selectionBbox.inflate(12 / vp.scale);
      if (sel.contains(doc)) {
        eng.beginSelectionGesture();
        _selAnchor = eng.selectionBbox.center;
        _mode = _Mode.selectMove;
        return;
      }
    }
    // element hit?
    final el = _elementAt(doc);
    if (el != null) {
      eng.clearSelection();
      eng.toggleSelectElement(el);
      eng.beginSelectionGesture();
      _selAnchor = el.bbox().center;
      _mode = _Mode.selectMove;
      return;
    }
    _lasso.clear();
    _lasso.add(doc);
    _mode = _Mode.lasso;
    _ping();
  }

  PageElement? _elementAt(Offset doc) {
    final pageIdx = _pageOf(doc);
    if (pageIdx < 0) return null;
    final pt = g.docToPoints(pageIdx, doc);
    final doc2 = g.pages[pageIdx];
    final d = eng.store.load(doc2.id);
    for (final el in d.elements.reversed) {
      if (el.hitTest(pt, slack: 4)) return el;
    }
    return null;
  }

  // ───────────────────────── moves ─────────────────────────

  void _onMove(PointerMoveEvent e) {
    final p = _pointers[e.pointer];
    if (p == null) return;
    final delta = e.localPosition - p.last;
    if ((e.localPosition - p.startPos).distance > 12) p.moved = true;
    p.last = e.localPosition;
    p.pressure = e.pressure;

    if (_effectiveTool == Tool.eraser ||
        (_barrelTool == Tool.eraser && _mode == _Mode.eraseStroke)) {
      eraserCursor.value = e.localPosition;
    }

    switch (_mode) {
      case _Mode.idle:
        break;
      case _Mode.draw:
        var doc = _docOf(e.localPosition);
        var pt = g.docToPoints(_page, doc);
        if (widget.ruler.active &&
            widget.ruler.distanceTo(doc) < 26 / vp.scale) {
          pt = g.docToPoints(_page, widget.ruler.project(doc));
        }
        _lastPt = pt;
        eng.extendStroke(pt, pressure: e.pressure.clamp(0.05, 1.0));
      case _Mode.shape:
        _lastPt = _pagePtOf(e.localPosition);
        _ping();
      case _Mode.eraseStroke:
        eng.eraseAt(_pagePtOf(e.localPosition), _eraserRadiusPage());
      case _Mode.eraseArea:
        _areaRect = Rect.fromPoints(
            _anchorPt, _pagePtOf(e.localPosition));
        _ping();
      case _Mode.lasso:
        _lasso.add(_docOf(e.localPosition));
        _ping();
      case _Mode.laser:
        widget.laser.extend(_docOf(e.localPosition));
      case _Mode.selectMove:
        final d = _docOf(e.localPosition);
        final dPrev = _docOf(e.localPosition - delta);
        eng.translateSelectionBy(d - dPrev);
      case _Mode.selectTransform:
        _updateSelectTransform();
      case _Mode.rulerBody:
        widget.ruler.translateBy(delta / vp.scale);
      case _Mode.rulerHandle:
        widget.ruler.rotateTo(_rulerHandle, _docOf(e.localPosition),
            handleTolDoc: 0);
      case _Mode.pan:
      case _Mode.touchPan:
        vp.panByScreen(delta);
      case _Mode.pinch:
        _updatePinch(delta);
    }
  }

  void _updatePinch(Offset delta) {
    final touches = _pointers.values
        .where((x) => x.kind == PointerDeviceKind.touch).toList();
    if (touches.length < 2 || _pinchFocalPrev == null) return;
    final a = touches[0].last, b = touches[1].last;
    final focal = (a + b) / 2;
    final dist = (a - b).distance;
    if (_pinchDistPrev > 0 && dist > 0) {
      vp.zoomAt(focal, dist / _pinchDistPrev);
    }
    vp.panByScreen(focal - _pinchFocalPrev!);
    _pinchFocalPrev = focal;
    _pinchDistPrev = dist;
  }

  void _startSelectTransform() {
    _cancelActive(cancelStroke: true);
    if (!eng.hasSelection) return;
    eng.beginSelectionGesture();
    _selAnchor = eng.selectionBbox.center;
    final touches = _pointers.values
        .where((x) => x.kind == PointerDeviceKind.touch).toList();
    if (touches.length >= 2) {
      _baseAngle = (touches[0].last - touches[1].last).direction;
      _pinchDistPrev = (touches[0].last - touches[1].last).distance;
      _pinchFocalPrev = (touches[0].last + touches[1].last) / 2;
    }
    _mode = _Mode.selectTransform;
  }

  void _updateSelectTransform() {
    final touches = _pointers.values
        .where((x) => x.kind == PointerDeviceKind.touch).toList();
    if (touches.length < 2 || _pinchFocalPrev == null) return;
    final a = touches[0].last, b = touches[1].last;
    final dist = (a - b).distance;
    final ang = (a - b).direction;
    var scale = _pinchDistPrev > 0 ? dist / _pinchDistPrev : 1.0;
    var rotation = ang - _baseAngle;
    // 15° magnets within 4°
    final step = math.pi / 12;
    final snapped = (rotation / step).roundToDouble() * step;
    if ((rotation - snapped).abs() < math.pi / 45) rotation = snapped;
    // scale snapping near 1
    if ((scale - 1).abs() < 0.04) scale = 1;
    final focalDoc = _docOf((a + b) / 2);
    final startDoc = _docOf(_pinchFocalPrev!);
    eng.applyGestureTransform(
      translate: focalDoc - startDoc,
      scale: scale,
      rotation: rotation,
      anchor: _selAnchor,
    );
  }

  // ───────────────────────── up / cancel ─────────────────────────

  void _onUp(PointerEvent e) {
    final p = _pointers.remove(e.pointer);
    _holdTimer?.cancel();
    if (p == null) return;
    if (p.stylus) {
      _stylusActive = (_stylusActive - 1).clamp(0, 100);
      if (_stylusActive == 0) _barrelTool = null;
    }

    switch (_mode) {
      case _Mode.draw:
        _finishStroke(recognize: widget.settings.shapeRecognition);
      case _Mode.shape:
        _commitShape();
      case _Mode.eraseStroke:
        eng.endErase();
      case _Mode.eraseArea:
        final r = _areaRect;
        if (r != null && r.width > 2 && r.height > 2) {
          eng.eraseArea(r);
        }
        _areaRect = null;
        _ping();
      case _Mode.lasso:
        _finishLasso(p);
      case _Mode.laser:
        widget.laser.end();
      case _Mode.selectMove:
      case _Mode.selectTransform:
        eng.commitSelectionGesture();
      case _Mode.rulerBody:
      case _Mode.rulerHandle:
        break;
      case _Mode.pan:
      case _Mode.touchPan:
        _maybeTap(p);
      case _Mode.pinch:
        _updatePinchRefs();
        if (_pointers.values.where((x) => x.kind == PointerDeviceKind.touch).length < 2) {
          _mode = _Mode.idle;
        }
        return;
      case _Mode.idle:
        _maybeTap(p);
    }

    if (_pointers.isEmpty) {
      _mode = _Mode.idle;
      eraserCursor.value = null;
    } else if (_mode == _Mode.touchPan &&
        _pointers.values.every((x) => !x.stylus)) {
      _mode = _Mode.idle;
    }
    _ping();
  }

  void _maybeTap(_Pointer p) {
    if (p.moved ||
        DateTime.now().difference(p.downAt) >
            const Duration(milliseconds: 280)) {
      return;
    }
    final tool = _effectiveTool;
    if (p.stylus && (tool == Tool.pen || tool == Tool.highlighter)) {
      return; // pen taps draw dots, not actions
    }
    final doc = _docOf(p.last);
    final pageIdx = _pageOf(doc);
    if (pageIdx < 0) return;
    final pt = g.docToPoints(pageIdx, doc);

    // double-tap on text element → edit
    final el = _elementAt(doc);
    if (el is TextEl && tool != Tool.text) {
      final now = DateTime.now();
      if (now.difference(_lastTipTap) < const Duration(milliseconds: 340)) {
        _lastTipTap = DateTime.fromMillisecondsSinceEpoch(0);
        widget.onEditText(el, pageIdx);
        return;
      }
      _lastTipTap = now;
      if (tool == Tool.selector) {
        eng.toggleSelectElement(el);
        return;
      }
    }

    switch (tool) {
      case Tool.text:
        widget.onPlaceText(pageIdx, pt);
      case Tool.selector:
        final d = eng.store.load(g.pages[pageIdx].id);
        final hitStroke = d.strokes.lastWhereOrNull(
            (s) => s.hitTest(pt, 6 / _screenPerPagePoint(pageIdx)));
        if (hitStroke != null) {
          eng.toggleSelectStroke(hitStroke);
          return;
        }
        if (el != null) {
          eng.clearSelection();
          eng.toggleSelectElement(el);
          return;
        }
        eng.clearSelection();
      default:
        break;
    }
  }

  void _finishStroke({required bool recognize}) {
    final stroke = eng.commitStroke();
    if (stroke == null) return;
    if (recognize &&
        stroke.kind != PenKind.highlighter &&
        widget.settings.shapeRecognition &&
        (tl.tool == Tool.pen)) {
      final pts = [for (final q in stroke.points) q.offset];
      final r = ShapeRecognizer.recognize(pts);
      if (r != null && r.confidence >= ShapeRecognizer.minConfidence) {
        final el = ShapeEl(
          id: 'e${DateTime.now().microsecondsSinceEpoch}',
          x: r.bbox.left, y: r.bbox.top,
          w: r.bbox.width, h: r.bbox.height,
          shape: r.type,
          strokeColorValue: stroke.colorValue,
          strokeWidth: (stroke.size * 1.15).clamp(1.2, 5),
          filled: false,
        );
        eng.replaceStrokeWithElement(stroke, el);
      }
    }
  }

  void _commitShape() {
    final a = _anchorPt, b = _lastPt;
    var rect = Rect.fromPoints(a, b);
    if (rect.width < 3 && rect.height < 3) return;
    var shape = tl.shape;
    // square snapping (near-equal sides → perfect square)
    if (shape != ShapeType.line && shape != ShapeType.arrow &&
        widget.settings.snapShapes) {
      final side = math.max(rect.width, rect.height);
      if ((rect.width - rect.height).abs() < side * 0.14) {
        final c = rect.center;
        rect = Rect.fromCenter(center: c, width: side, height: side);
      }
    }
    // line/arrow 15° angle snap
    if (shape.isLinear && widget.settings.snapShapes) {
      final ang = math.atan2(b.dy - a.dy, b.dx - a.dx);
      final step = math.pi / 12;
      final snapped = (ang / step).roundToDouble() * step;
      if ((ang - snapped).abs() < math.pi / 45) {
        final len = (b - a).distance;
        final nb = Offset(a.dx + math.cos(snapped) * len,
            a.dy + math.sin(snapped) * len);
        rect = Rect.fromPoints(a, nb);
      }
    }
    eng.addElement(ShapeEl(
      id: 'e${DateTime.now().microsecondsSinceEpoch}',
      x: rect.left, y: rect.top, w: rect.width, h: rect.height,
      shape: shape,
      strokeColorValue: tl.shapeStrokeColor.toARGB32(),
      fillColorValue: tl.shapeFillColor.toARGB32(),
      strokeWidth: tl.shapeStrokeWidth,
      filled: tl.shapeFilled,
    ));
    _ping();
  }

  void _finishLasso(_Pointer p) {
    if (_lasso.length >= 3 && p.moved) {
      eng.selectInLasso(_lasso);
    } else if (!p.moved) {
      _maybeTap(p);
    }
    _lasso.clear();
    _ping();
  }

  void _cancelActive({bool cancelStroke = false}) {
    if (cancelStroke) eng.cancelLive();
    _lasso.clear();
    _areaRect = null;
    _ping();
  }

  // ───────────────────────── hover / wheel ─────────────────────────

  void _onHover(PointerHoverEvent e) {
    final stylus = e.kind == PointerDeviceKind.stylus;
    if (stylus) {
      _stylusHoverUntil =
          DateTime.now().add(const Duration(milliseconds: 1200));
      if (e.buttons != 0) {
        final act = widget.settings.pen.hoverButton;
        if (act != PenAction.none && act.tool == null) _dispatch(act);
      }
    }
    if (_effectiveTool == Tool.eraser) {
      eraserCursor.value = e.localPosition;
    }
  }

  void _onSignal(PointerSignalEvent e) {
    if (e is PointerScrollEvent) {
      vp.panByScreen(e.scrollDelta);
    }
  }

  void _dispatch(PenAction action) {
    tl.applyAction(action, widget.host);
  }

  @override
  void dispose() {
    _holdTimer?.cancel();
    _fx.dispose();
    eraserCursor.dispose();
    super.dispose();
  }
}

extension<T> on Iterable<T> {
  T? lastWhereOrNull(bool Function(T) test) {
    T? result;
    for (final e in this) {
      if (test(e)) result = e;
    }
    return result;
  }
}

class _OverlayPainter extends CustomPainter {
  final _GestureRouterState router;
  _OverlayPainter({required this.router});

  @override
  void paint(Canvas canvas, Size size) {
    final r = router;
    final colors = Theme.of(r.context).colorScheme;
    final primary = colors.primary;

    // lasso
    if (r._lasso.length > 1) {
      final path = Path()
        ..moveTo(r.vp.docToScreen(r._lasso.first).dx,
            r.vp.docToScreen(r._lasso.first).dy);
      for (final d in r._lasso.skip(1)) {
        final s = r.vp.docToScreen(d);
        path.lineTo(s.dx, s.dy);
      }
      canvas.drawPath(path, Paint()
        ..color = primary.withValues(alpha: 0.85)
        ..strokeWidth = 1.6
        ..style = PaintingStyle.stroke);
      canvas.drawPath(path, Paint()
        ..color = primary.withValues(alpha: 0.10)
        ..style = PaintingStyle.fill);
    }

    // area eraser rect
    final area = r._areaRect;
    if (area != null) {
      final a = r.vp.docToScreen(r.g.pointsRectToDoc(r._page, area).topLeft);
      final b = r.vp.docToScreen(r.g.pointsRectToDoc(r._page, area).bottomRight);
      final rect = Rect.fromPoints(a, b);
      canvas.drawRect(rect, Paint()
        ..color = colors.error.withValues(alpha: 0.5)
        ..strokeWidth = 1.4
        ..style = PaintingStyle.stroke);
      canvas.drawRect(rect, Paint()
        ..color = colors.error.withValues(alpha: 0.08)
        ..style = PaintingStyle.fill);
    }

    // shape preview
    if (r._mode == _Mode.shape) {
      final a = r.vp.docToScreen(r.g.pointsToDoc(r._page, r._anchorPt));
      final b = r.vp.docToScreen(r.g.pointsToDoc(r._page, r._lastPt));
      canvas.drawRect(Rect.fromPoints(a, b), Paint()
        ..color = primary.withValues(alpha: 0.6)
        ..strokeWidth = 1.4
        ..style = PaintingStyle.stroke);
    }

    // eraser cursor
    final cur = r.eraserCursor.value;
    if (cur != null) {
      final radius = r.tl.eraserRadius;
      canvas.drawCircle(cur, radius, Paint()
        ..color = colors.error.withValues(alpha: 0.7)
        ..strokeWidth = 1.4
        ..style = PaintingStyle.stroke);
      canvas.drawCircle(cur, radius, Paint()
        ..color = colors.error.withValues(alpha: 0.08)
        ..style = PaintingStyle.fill);
    }

    // ruler chrome (screen space)
    if (r.widget.ruler.active) {
      final rulerPaint = RulerOverlayPainter(
        ruler: r.widget.ruler,
        docToScreen: r.vp.docLengthToScreen,
        toScreen: r.vp.docToScreen,
        color: primary,
      );
      rulerPaint.paint(canvas, size);
    }
  }

  @override
  bool shouldRepaint(covariant _OverlayPainter old) => true;
}
