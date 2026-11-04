import 'package:flutter/foundation.dart';
import 'package:flutter/painting.dart';
import 'package:perfect_freehand/perfect_freehand.dart';

import '../models/stroke.dart';

/// عملية حبر قابلة للتراجع (Dart 3 sealed → switch استنفادي آمن).
sealed class InkOp {
  const InkOp();
}

final class AddInk extends InkOp {
  const AddInk(this.page, this.stroke);
  final int page;
  final Stroke stroke;
}

final class RemoveInk extends InkOp {
  const RemoveInk(this.page, this.strokes);
  final int page;
  final List<Stroke> strokes;
}

/// محرك الحبر: خطوط كل صفحة + الخط النشط + الممحاة المتجهية + تراجع/إعادة.
///
/// تصميم الإشعارات دقيق لصالح الأداء العالي (120fps):
///  - أثناء الرسم تُخاطَب "صفحة واحدة فقط" (pageChanges) وليس المستند
///    كله — إعادة رسم محدودة دائماً بغض النظر عن عدد الصفحات.
///  - مؤشر الممحاة له مستمع منفصل (cursorChanges) رخيص جداً.
///  - التراجع/الإعادة/الاستيراد تخاطب المحرك الرئيسي (الشريط + الحفظ).
class StrokeEngine extends ChangeNotifier {
  final Map<int, List<Stroke>> _pages = {};
  final List<InkOp> _undo = <InkOp>[];
  final List<InkOp> _redo = <InkOp>[];
  final Map<int, ChangeNotifier> _pageNotifiers = {};
  final ChangeNotifier _cursorNotifier = ChangeNotifier();

  int? _erasePage;
  List<Stroke>? _eraseRemoved;

  /// الخط الجاري رسمه الآن (null إذا لا شيء).
  Stroke? activeStroke;
  int? activePage;

  /// موضع مؤشر الممحاة الحالي — يُرسم كدائرة على صفحته فقط،
  /// ويظهر أثناء المسح الفعلي فقط (لا مؤشرات Hover إطلاقاً).
  ({int page, Offset pos, double radius})? eraserCursor;

  int _idSeq = 0;

  bool get canUndo => _undo.isNotEmpty;
  bool get canRedo => _redo.isNotEmpty;

  List<Stroke> strokesOn(int page) =>
      _pages.putIfAbsent(page, () => <Stroke>[]);

  Listenable pageChanges(int page) =>
      _pageNotifiers.putIfAbsent(page, () => ChangeNotifier());

  Listenable get cursorChanges => _cursorNotifier;

  // ───────────────────────── الرسم ─────────────────────────

  void beginStroke(int page, StrokeStyle style, Offset first, double pressure) {
    activePage = page;
    activeStroke = Stroke(
      id: '${DateTime.now().microsecondsSinceEpoch}_${_idSeq++}',
      style: style,
      points: [PointVector(first.dx, first.dy, pressure)],
    );
    _notifyPage(page);
  }

  void extendStroke(Offset point, double pressure) {
    final s = activeStroke;
    if (s == null) return;
    s.points.add(PointVector(point.dx, point.dy, pressure));
    s.cachedOutline = null;
    _notifyPage(activePage!);
  }

  void commitStroke() {
    final s = activeStroke;
    final p = activePage;
    activeStroke = null;
    activePage = null;
    if (s == null || p == null || s.points.isEmpty) return;
    strokesOn(p).add(s);
    _push(AddInk(p, s));
    _notifyPage(p);
  }

  void cancelStroke() {
    final p = activePage;
    activeStroke = null;
    activePage = null;
    if (p != null) _notifyPage(p);
  }

  // ──────────── الممحاة المتجهية (Stroke Eraser) ────────────
  // لمس أي جزء من خط → فحص تقاطع هندسي → حذف الخط "كاملاً"
  // (وليس مسحاً أبيض). كل مسحات إيماءة واحدة تُجمَّع في عملية
  // تراجع واحدة حتى يستعيد زر التراجع كل ما مُسح بضغطة واحدة.

  void openEraseGroup() {
    _erasePage = null;
    _eraseRemoved = null;
  }

  bool eraseAt(int page, Offset pointPts, double radiusPts) {
    final list = strokesOn(page);
    final hit = <Stroke>[];
    for (final s in list) {
      if (_strokeHits(s, pointPts, radiusPts)) hit.add(s);
    }
    if (hit.isEmpty) return false;
    list.removeWhere(hit.contains);

    if (_eraseRemoved != null && _erasePage == page) {
      _eraseRemoved!.addAll(hit);
    } else {
      closeEraseGroup();
      _erasePage = page;
      _eraseRemoved = [...hit];
    }
    _notifyPage(page);
    return true;
  }

  void closeEraseGroup() {
    final page = _erasePage;
    final removed = _eraseRemoved;
    _erasePage = null;
    _eraseRemoved = null;
    if (page != null && removed != null && removed.isNotEmpty) {
      _push(RemoveInk(page, removed));
    }
  }

  void setEraserCursor(int page, Offset pos, double radius) {
    eraserCursor = (page: page, pos: pos, radius: radius);
    _cursorNotifier.notifyListeners();
  }

  void clearEraserCursor() {
    eraserCursor = null;
    _cursorNotifier.notifyListeners();
  }

  /// التقاطع: المسافة من نقطة الممحاة إلى أي ضلع من أضلاع الخط
  /// ≤ (نصف قطر الممحاة + نصف سمك الخط).
  bool _strokeHits(Stroke s, Offset p, double radius) {
    final pts = s.points;
    if (pts.isEmpty) return false;
    final reach = radius + s.style.size / 2;

    if (pts.length == 1) {
      return (Offset(pts.first.x, pts.first.y) - p).distance <= reach;
    }
    for (var i = 0; i + 1 < pts.length; i++) {
      if (_segmentDistance(p, pts[i], pts[i + 1]) <= reach) return true;
    }
    return false;
  }

  double _segmentDistance(Offset p, PointVector a, PointVector b) {
    final ab = Offset(b.x - a.x, b.y - a.y);
    final len2 = ab.distanceSquared;
    if (len2 < 1e-9) return (Offset(a.x, a.y) - p).distance;
    final t =
        (((p.dx - a.x) * ab.dx + (p.dy - a.y) * ab.dy) / len2)
            .clamp(0.0, 1.0)
            .toDouble();
    return (Offset(a.x + ab.dx * t, a.y + ab.dy * t) - p).distance;
  }

  // ───────────────────────── تراجع / إعادة ─────────────────────────

  void undo() {
    if (_undo.isEmpty) return;
    final op = _undo.removeLast();
    _apply(op, forward: false);
    _redo.add(op);
    notifyListeners();
  }

  void redo() {
    if (_redo.isEmpty) return;
    final op = _redo.removeLast();
    _apply(op, forward: true);
    _undo.add(op);
    notifyListeners();
  }

  void _apply(InkOp op, {required bool forward}) {
    switch (op) {
      case AddInk(:final page, :final stroke):
        if (forward) {
          strokesOn(page).add(stroke);
        } else {
          strokesOn(page).remove(stroke);
        }
        _notifyPage(page);
      case RemoveInk(:final page, :final strokes):
        if (forward) {
          strokesOn(page).addAll(strokes);
        } else {
          strokesOn(page).removeWhere(strokes.contains);
        }
        _notifyPage(page);
    }
  }

  void _push(InkOp op) {
    _undo.add(op);
    _redo.clear();
    notifyListeners();
  }

  void _notifyPage(int page) => _pageNotifiers[page]?.notifyListeners();

  // ─────────────── الاستيراد/التصدير (للحفظ في Isar) ───────────────

  Map<int, List<Stroke>> snapshot() =>
      {for (final e in _pages.entries) e.key: List.of(e.value)};

  void importStrokes(Map<int, List<Stroke>> pages) {
    _pages
      ..clear()
      ..addAll(pages.map((k, v) => MapEntry(k, List.of(v))));
    _undo.clear();
    _redo.clear();
    for (final k in pages.keys) {
      _notifyPage(k);
    }
    notifyListeners();
  }

  @override
  void dispose() {
    for (final n in _pageNotifiers.values) {
      n.dispose();
    }
    _cursorNotifier.dispose();
    super.dispose();
  }
}
