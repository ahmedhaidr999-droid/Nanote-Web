import 'dart:math' as math;

import 'package:flutter/material.dart';

/// Virtual ruler: a segment in DOC space with two handles.
/// Drawing near the line snaps to the ruler; drag body to move, drag an
/// endpoint to rotate (with 15° magnets within 4°).
class RulerModel extends ChangeNotifier {
  bool active = false;
  Offset a, b;
  double _length = 320;

  RulerModel()
      : a = Offset(120, 300),
        b = Offset(440, 300);

  double get length => _length;

  void toggle() {
    active = !active;
    notifyListeners();
  }

  void showAt(Offset docCenter) {
    a = docCenter - Offset(_length / 2, 0);
    b = docCenter + Offset(_length / 2, 0);
    active = true;
    notifyListeners();
  }

  Offset get center => (a + b) / 2;

  double get angle => math.atan2(b.dy - a.dy, b.dx - a.dx);

  /// Distance from point to the ruler line.
  double distanceTo(Offset p) {
    final ab = b - a;
    final len2 = ab.dx * ab.dx + ab.dy * ab.dy;
    if (len2 == 0) return (p - a).distance;
    var t = ((p - a).dx * ab.dx + (p - a).dy * ab.dy) / len2;
    t = t.clamp(0.0, 1.0);
    return (p - (a + ab * t)).distance;
  }

  /// Snap a doc point onto the ruler (for drawing along it).
  Offset project(Offset p) {
    final ab = b - a;
    final len2 = ab.dx * ab.dx + ab.dy * ab.dy;
    if (len2 == 0) return a;
    var t = ((p - a).dx * ab.dx + (p - a).dy * ab.dy) / len2;
    t = t.clamp(-0.35, 1.35); // allow slight overshoot beyond the ends
    return a + ab * t;
  }

  /// Body hit (either side of the strip).
  bool hitBody(Offset docP, double tolerance) => distanceTo(docP) <= tolerance;

  /// Endpoint hit (handle circles, tolerance in DOC units).
  int hitHandle(Offset docP, double tolerance) {
    if ((docP - a).distance <= tolerance) return 0;
    if ((docP - b).distance <= tolerance) return 1;
    return -1;
  }

  void translateBy(Offset d) {
    a += d;
    b += d;
    notifyListeners();
  }

  /// Rotate handle [handleIdx] to point at [docP] (other end fixed).
  void rotateTo(int handleIdx, Offset docP, {required double handleTolDoc}) {
    final fixed = handleIdx == 0 ? b : a;
    var ang = math.atan2(docP.dy - fixed.dy, docP.dx - fixed.dx);
    // 15° magnets within 4°
    final step = math.pi / 12;
    final snapped = (ang / step).roundToDouble() * step;
    if ((ang - snapped).abs() <= math.pi / 45) ang = snapped;
    _length = ((docP - fixed).distance).clamp(120.0, 900.0);
    if (handleIdx == 0) {
      a = fixed - Offset(math.cos(ang), math.sin(ang)) * _length;
      b = fixed;
    } else {
      b = fixed + Offset(math.cos(ang), math.sin(ang)) * _length;
      a = fixed;
    }
    notifyListeners();
  }
}

/// Screen-space chrome for the ruler (strip, ticks, handles).
class RulerOverlayPainter extends CustomPainter {
  final RulerModel ruler;
  final double Function(double) docToScreen; // length converter
  final Offset Function(Offset) toScreen;
  final Color color;

  RulerOverlayPainter({
    required this.ruler,
    required this.docToScreen,
    required this.toScreen,
    required this.color,
  });

  @override
  void paint(Canvas canvas, Size size) {
    if (!ruler.active) return;
    final a = toScreen(ruler.a), b = toScreen(ruler.b);
    final ang = (b - a).direction;
    final stripHalf = docToScreen(14);

    canvas.save();
    canvas.translate(a.dx, a.dy);
    canvas.rotate(ang);
    final len = (b - a).distance;

    final body = Paint()
      ..color = const Color(0x66FFE24D).withValues(alpha: 0.35)
      ..style = PaintingStyle.fill;
    final border = Paint()
      ..color = const Color(0xCCF5A623)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.4;
    final r = RRect.fromRectAndRadius(
        Rect.fromLTWH(0, -stripHalf, len, stripHalf * 2),
        const Radius.circular(6));
    canvas.drawRRect(r, body);
    canvas.drawRRect(r, border);

    // tick marks every 20pt, longer every 100pt
    final tick = Paint()
      ..color = const Color(0xB3F5A623)
      ..strokeWidth = 1;
    for (var d = 0.0; d <= len; d += docToScreen(20)) {
      final long = (d / docToScreen(100)).roundToDouble() * docToScreen(100) == d;
      final h = docToScreen(long ? 8 : 4);
      canvas.drawLine(Offset(d, -stripHalf), Offset(d, -stripHalf + h), tick);
    }
    canvas.restore();

    // handles
    final knob = Paint()..color = const Color(0xFFF5A623);
    final knobBorder = Paint()
      ..color = Colors.white
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2;
    for (final p in [a, b]) {
      canvas.drawCircle(p, 9, knob);
      canvas.drawCircle(p, 9, knobBorder);
    }
  }

  @override
  bool shouldRepaint(RulerOverlayPainter old) => true;
}

const kLaserPalette = [
  Color(0xFFE5484D), Color(0xFF30A46C), Color(0xFF1E6FF2),
  Color(0xFFF5A623), Color(0xFFD6409F),
];

/// Laser trail painting in DOC space (workspace applies the doc transform).
class LaserOverlayPainter extends CustomPainter {
  final List<(Offset, double)> points; // (doc pos, alpha)
  final Color color;
  final double widthDoc;
  final double docScale; // screen px per doc unit

  LaserOverlayPainter({
    required this.points,
    required this.color,
    required this.widthDoc,
    required this.docScale,
  });

  @override
  void paint(Canvas canvas, Size size) {
    if (points.length < 2) {
      if (points.length == 1) {
        final (p, a) = points.first;
        canvas.drawCircle(p, widthDoc * 0.7, Paint()
          ..color = color.withValues(alpha: 0.55 * a));
      }
      return;
    }
    // glow stack: wide faint → thin bright
    for (final (mult, alphaMult) in [(2.6, 0.18), (1.6, 0.30), (1.0, 0.95)]) {
      final paint = Paint()
        ..color = color
        ..strokeWidth = widthDoc * mult
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round
        ..style = PaintingStyle.stroke
        ..blendMode = BlendMode.plus
        ..color = color.withValues(alpha: alphaMult);
      final path = Path()..moveTo(points.first.$1.dx, points.first.$1.dy);
      for (var i = 1; i < points.length; i++) {
        // per-segment alpha via separate draw calls is costly; average pairs
        path.lineTo(points[i].$1.dx, points[i].$1.dy);
      }
      canvas.drawPath(path, paint);
    }
    // head dot
    final (head, ha) = points.last;
    canvas.drawCircle(head, widthDoc * 0.8, Paint()
      ..color = color.withValues(alpha: 0.85 * ha)
      ..blendMode = BlendMode.plus);
  }

  @override
  bool shouldRepaint(covariant LaserOverlayPainter old) => true;
}
