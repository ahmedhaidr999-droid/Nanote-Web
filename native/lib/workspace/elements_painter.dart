import 'package:flutter/material.dart';

import '../models/page_elements.dart';
import '../models/stroke.dart' show TextEl;
import '../services/image_cache.dart';
import '../theme/nanote_theme.dart';
import 'shape_path.dart';

/// Paints page elements (text / shapes / images & stickers) in PAGE-POINT
/// space, plus selection chrome (rotated dashed box + handles + rotate knob).
class ElementsPainter extends CustomPainter {
  final List<PageElement> elements;
  final AppImageCache images;
  final double pointScale;
  final double screenScale; // viewport.scale — for constant-size handles
  final Color selectionColor;
  final bool dark;

  ElementsPainter({
    required this.elements,
    required this.images,
    required this.pointScale,
    required this.screenScale,
    required this.selectionColor,
    this.dark = false,
  });

  static final _arabicRe = RegExp(r'[\u0600-\u06FF]');

  @override
  void paint(Canvas canvas, Size size) {
    if (elements.isEmpty) return;
    canvas.save();
    canvas.scale(pointScale, pointScale);
    final handlePx = 9 / (pointScale * screenScale);
    final dashPx = 5 / (pointScale * screenScale);
    final c = dark ? NanoteColors.dark : NanoteColors.light;

    for (final el in elements) {
      canvas.save();
      final center = el.center;
      canvas.translate(center.dx, center.dy);
      if (el.rotation != 0) canvas.rotate(el.rotation);
      canvas.translate(-center.dx, -center.dy);

      switch (el) {
        case TextEl(:final text, :final colorValue, :final fontSize,
            :final bold, :final align, :final w):
          final tp = TextPainter(
            text: TextSpan(
              text: text.isEmpty ? ' ' : text,
              style: TextStyle(
                color: Color(colorValue),
                fontSize: fontSize,
                fontWeight: bold ? FontWeight.w700 : FontWeight.w500,
                height: 1.32,
              ),
            ),
            textAlign: align == 1 ? TextAlign.center
                : align == 2 ? TextAlign.end : TextAlign.start,
            textDirection: _arabicRe.hasMatch(text)
                ? TextDirection.rtl : TextDirection.ltr,
          )..layout(maxWidth: w <= 0 ? 200 : w);
          tp.paint(canvas, Offset(el.x, el.y));
        case ShapeEl():
          final rect = Rect.fromLTWH(el.x, el.y, el.w, el.h);
          final path = shapePath(el.shape, rect.deflate(1.5));
          final stroke = Paint()
            ..color = Color(el.strokeColorValue)
            ..style = PaintingStyle.stroke
            ..strokeWidth = el.strokeWidth
            ..strokeJoin = StrokeJoin.round
            ..strokeCap = StrokeCap.round;
          if (el.filled) {
            final fill = Paint()
              ..color = Color(el.fillColorValue ?? el.strokeColorValue)
                .withValues(alpha: 0.30)
              ..style = PaintingStyle.fill;
            canvas.drawPath(path, fill);
          }
          canvas.drawPath(path, stroke);
        case ImageEl():
          _paintImage(canvas, el, c);
      }
      canvas.restore();

      if (el.selected) {
        _drawSelectionChrome(canvas, el, selectionColor, c, handlePx, dashPx);
      }
    }
    canvas.restore();
  }

  void _paintImage(Canvas canvas, ImageEl el, NanoteColors c) {
    final rect = Rect.fromLTWH(el.x, el.y, el.w, el.h);
    if (el.emoji != null) {
      final tp = TextPainter(
        text: TextSpan(
            text: el.emoji!,
            style: TextStyle(
                fontSize: el.h * 0.86,
                fontFamily: 'sans-serif')),
        textDirection: TextDirection.ltr,
      )..layout();
      tp.paint(canvas, rect.topLeft);
      return;
    }
    final key = el.fileKey;
    if (key != null) {
      final img = images.get(key);
      if (img != null) {
        final src = Rect.fromLTWH(
            0, 0, img.width.toDouble(), img.height.toDouble());
        canvas.drawImageRect(img, src, rect, Paint()
          ..filterQuality = FilterQuality.medium);
        return;
      }
      images.load(key);
    }
    // placeholder while decoding / missing
    canvas.drawRRect(
      RRect.fromRectAndRadius(rect, const Radius.circular(6)),
      Paint()..color = c.surfaceAlt,
    );
    final tp = TextPainter(
      text: TextSpan(text: '🖼️', style: TextStyle(fontSize: rect.height * 0.4)),
      textDirection: TextDirection.ltr,
    )..layout();
    tp.paint(canvas, rect.center - tp.size.center(Offset.zero));
  }

  static void _drawSelectionChrome(Canvas canvas, PageElement el,
      Color selection, NanoteColors c, double handlePx, double dashPx) {
    final rect = Rect.fromLTWH(el.x, el.y, el.w, el.h);
    final center = el.center;
    canvas.save();
    canvas.translate(center.dx, center.dy);
    canvas.rotate(el.rotation);
    canvas.translate(-center.dx, -center.dy);

    final border = Paint()
      ..color = selection
      ..style = PaintingStyle.stroke
      ..strokeWidth = handlePx * 0.4;
    // dashed border
    _dashedRect(canvas, rect.inflate(handlePx * 0.6), border, dashPx);

    final knob = Paint()..color = selection;
    final knobBorder = Paint()
      ..color = c.surface
      ..style = PaintingStyle.stroke
      ..strokeWidth = handlePx * 0.22;
    for (final p in [
      rect.topLeft, rect.topRight, rect.bottomRight, rect.bottomLeft,
    ]) {
      canvas.drawCircle(p, handlePx, knob);
      canvas.drawCircle(p, handlePx, knobBorder);
    }
    // rotate knob above top-center
    final rp = Offset(rect.center.dx, rect.top - handlePx * 3.2);
    canvas.drawLine(rect.topCenter, rp, border);
    canvas.drawCircle(rp, handlePx * 0.8, knob);
    canvas.drawCircle(rp, handlePx * 0.8, knobBorder);

    canvas.restore();
  }

  static void _dashedRect(Canvas canvas, Rect r, Paint p, double dash) {
    void dashedLine(Offset a, Offset b) {
      final d = b - a;
      final len = d.distance;
      if (len == 0) return;
      final u = d / len;
      var t = 0.0;
      var on = true;
      while (t < len) {
        final seg = (t + dash > len) ? len - t : dash;
        if (on) {
          canvas.drawLine(a + u * t, a + u * (t + seg), p);
        }
        t += dash;
        on = !on;
      }
    }

    dashedLine(r.topLeft, r.topRight);
    dashedLine(r.topRight, r.bottomRight);
    dashedLine(r.bottomRight, r.bottomLeft);
    dashedLine(r.bottomLeft, r.topLeft);
  }

  @override
  bool shouldRepaint(ElementsPainter old) =>
      old.elements != elements ||
      old.pointScale != pointScale ||
      old.screenScale != screenScale ||
      old.dark != dark;
}
