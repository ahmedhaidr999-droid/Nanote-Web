import 'package:flutter/material.dart';
import 'package:perfect_freehand/perfect_freehand.dart';

import '../controllers/stroke_engine.dart';
import '../controllers/tool_controller.dart';
import '../controllers/viewport_controller.dart';
import '../models/stroke.dart';
import 'doc_geometry.dart';

/// الطبقة الوسطى الشفافة — رسّام الحبر فوق صفحة PDF مباشرة.
///
/// يقرأ الحالة "الحية" من المحرك لحظة الرسم (وليس نسخة مجمّدة عند البناء)
/// عبر مستمعات دقيقة: صفحة واحدة + مؤشر الممحاة + الأدوات — لذلك لا
/// يُعاد رسم المستند كله أبداً، فقط ما تغيّر فعلاً.
class InkPainter extends CustomPainter {
  InkPainter({
    required this.engine,
    required this.tools,
    required this.viewport,
    required this.geometry,
    required this.page,
  }) : super(
          repaint: Listenable.merge([
            engine.pageChanges(page),
            engine.cursorChanges,
            tools,
          ]),
        );

  final StrokeEngine engine;

  /// للحفاظ على تحديث دائرة الممحاة عند تغيير حجمها من الشريط.
  final ToolController tools;
  final ViewportController viewport;
  final DocGeometry geometry;
  final int page;

  final Paint _ink = Paint()
    ..isAntiAlias = true
    ..style = PaintingStyle.fill;

  final Paint _cursor = Paint()
    ..isAntiAlias = true
    ..style = PaintingStyle.stroke;

  @override
  void paint(Canvas canvas, Size size) {
    final k = geometry.pointScale(page); // بكسل منطقي لكل نقطة PDF
    if (k <= 0 || !k.isFinite) return;

    canvas.save();
    canvas.scale(k, k); // نرسم الآن مباشرة في فضاء نقاط الصفحة

    for (final s in engine.strokesOn(page)) {
      _drawStroke(canvas, s, committed: true);
    }

    final a = engine.activeStroke;
    if (a != null && engine.activePage == page) {
      _drawStroke(canvas, a, committed: false);
    }

    // دائرة الممحاة — تظهر فقط أثناء المسح الفعلي (لا مؤشرات Hover).
    final c = engine.eraserCursor;
    if (c != null && c.page == page) {
      _cursor
        ..color = Colors.black45
        ..strokeWidth = 1.2 / viewport.scale / k;
      canvas.drawCircle(c.pos, c.radius, _cursor);
    }

    canvas.restore();
  }

  void _drawStroke(Canvas canvas, Stroke s, {required bool committed}) {
    if (s.points.isEmpty) return;

    // نقرة واحدة = نقطة حبر
    if (s.points.length == 1) {
      _ink.color = s.style.color;
      canvas.drawCircle(
        Offset(s.points.first.x, s.points.first.y),
        s.style.size / 2,
        _ink,
      );
      return;
    }

    final Path path;
    if (committed && s.cachedOutline != null) {
      // الخط المثبَّت يُحسب مرة واحدة فقط — أداء ثابت مع آلاف الخطوط.
      path = s.cachedOutline!;
    } else {
      path = _outlineToPath(
        getStroke(s.points, options: s.style.toOptions(last: committed)),
      );
      if (committed) s.cachedOutline = path;
    }

    _ink.color = s.style.color;
    canvas.drawPath(path, _ink);
  }

  /// getStroke يعيد مضلّعاً مغلقاً حول مسار الخط → يُملأ بلون الحبر.
  Path _outlineToPath(List<Offset> outline) {
    if (outline.isEmpty) return Path();
    final path = Path()..moveTo(outline.first.dx, outline.first.dy);
    for (var i = 1; i < outline.length; i++) {
      path.lineTo(outline[i].dx, outline[i].dy);
    }
    return path..close();
  }

  @override
  bool shouldRepaint(covariant InkPainter oldDelegate) => false;
}
