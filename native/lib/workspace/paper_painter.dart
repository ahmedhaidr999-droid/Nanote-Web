import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../models/paper.dart';
import '../theme/nanote_theme.dart';

/// Paints one page's paper template (12 templates) in logical tile space.
/// The canvas is already scaled so 1 unit = 1 page point.
class PaperPainter extends CustomPainter {
  final PaperTemplate template;
  final bool dark;
  final Color? overrideBg;

  PaperPainter({required this.template, required this.dark, this.overrideBg});

  @override
  void paint(Canvas canvas, Size size) {
    final c = dark ? NanoteColors.dark : NanoteColors.light;
    final bg = overrideBg ?? (dark ? const Color(0xFF101A28) : Colors.white);
    canvas.drawRect(Offset.zero & size, Paint()..color = bg);

    final line = Paint()
      ..color = dark ? const Color(0x2FE8EEF7) : const Color(0x3616233A)
      ..strokeWidth = 0.8
      ..style = PaintingStyle.stroke;
    final lineStrong = Paint()
      ..color = dark ? const Color(0x4DE8EEF7) : const Color(0x5216233A)
      ..strokeWidth = 1.1
      ..style = PaintingStyle.stroke;
    final dot = Paint()
      ..color = dark ? const Color(0x59E8EEF7) : const Color(0x6616233A)
      ..style = PaintingStyle.fill;

    switch (template) {
      case PaperTemplate.plain:
        break;
      case PaperTemplate.ruled:
      case PaperTemplate.ruledMargin:
        _ruled(canvas, size, line, lineStrong,
            margin: template == PaperTemplate.ruledMargin);
      case PaperTemplate.graph:
        _grid(canvas, size, line, kGridPitch);
      case PaperTemplate.graphFine:
        _grid(canvas, size, line, kGridPitch / 2);
      case PaperTemplate.dots:
        _dots(canvas, size, dot, kGridPitch);
      case PaperTemplate.dotsFine:
        _dots(canvas, size, dot, kGridPitch / 2);
      case PaperTemplate.isometric:
        _iso(canvas, size, line);
      case PaperTemplate.hex:
        _hex(canvas, size, line);
      case PaperTemplate.cornell:
        _cornell(canvas, size, line, lineStrong);
      case PaperTemplate.music:
        _music(canvas, size, line, lineStrong);
      case PaperTemplate.checklist:
        _checklist(canvas, size, line, lineStrong);
    }
    // suppress unused warning for c
    // ignore: unnecessary_statements
    (c);
  }

  void _ruled(Canvas canvas, Size size, Paint line, Paint strong,
      {bool margin = false}) {
    const pitch = kGridPitch * 1.5;
    for (var y = pitch; y < size.height; y += pitch) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), line);
    }
    if (margin) {
      final mx = size.width * 0.14;
      canvas.drawLine(Offset(mx, 0), Offset(mx, size.height), strong);
    }
  }

  void _grid(Canvas canvas, Size size, Paint line, double pitch) {
    for (var x = pitch; x < size.width; x += pitch) {
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), line);
    }
    for (var y = pitch; y < size.height; y += pitch) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), line);
    }
  }

  void _dots(Canvas canvas, Size size, Paint dot, double pitch) {
    for (var x = pitch; x < size.width; x += pitch) {
      for (var y = pitch; y < size.height; y += pitch) {
        canvas.drawCircle(Offset(x, y), 1.3, dot);
      }
    }
  }

  void _iso(Canvas canvas, Size size, Paint line) {
    final pitch = kGridPitch.toDouble();
    final h = pitch * math.sqrt(3) / 2;
    for (var x = -size.height; x < size.width + size.height; x += pitch) {
      canvas.drawLine(Offset(x, 0), Offset(x + size.height * 0.577, size.height), line);
      canvas.drawLine(Offset(x, 0), Offset(x - size.height * 0.577, size.height), line);
    }
    for (var y = 0; y < size.height; y += h) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), line);
    }
  }

  void _hex(Canvas canvas, Size size, Paint line) {
    final r = kGridPitch * 0.62;
    final hStep = r * 1.5;
    final vStep = r * math.sqrt(3);
    var row = 0;
    for (var y = 0; y < size.height + vStep; y += vStep, row++) {
      final xOff = row.isEven ? 0.0 : hStep;
      for (var x = -r * 2 + xOff; x < size.width + r * 2; x += hStep * 2) {
        final cy = y + vStep / 2;
        final path = Path();
        for (var i = 0; i < 6; i++) {
          final ang = math.pi / 6 + i * math.pi / 3;
          final p = Offset(x + math.cos(ang) * r, cy + math.sin(ang) * r);
          i == 0 ? path.moveTo(p.dx, p.dy) : path.lineTo(p.dx, p.dy);
        }
        path.close();
        canvas.drawPath(path, line);
      }
    }
  }

  void _cornell(Canvas canvas, Size size, Paint line, Paint strong) {
    const pitch = kGridPitch * 1.5;
    final cueEnd = size.width * 0.3;
    final splitY = size.height * 0.28;
    canvas.drawLine(Offset(cueEnd, splitY), Offset(cueEnd, size.height), strong);
    canvas.drawLine(Offset(0, splitY), Offset(size.width, splitY), strong);
    for (var y = splitY + pitch; y < size.height; y += pitch) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), line);
    }
  }

  void _music(Canvas canvas, Size size, Paint line, Paint strong) {
    const gapY = kGridPitch * 3.6;
    const staffGap = kGridPitch * 0.5;
    for (var y = gapY * 0.6; y < size.height - staffGap * 5; y += gapY) {
      for (var i = 0; i < 5; i++) {
        final ly = y + i * staffGap;
        canvas.drawLine(Offset(0, ly), Offset(size.width, ly), i == 0 || i == 4 ? strong : line);
      }
    }
  }

  void _checklist(Canvas canvas, Size size, Paint line, Paint strong) {
    const pitch = kGridPitch * 2.0;
    for (var y = pitch * 0.75; y < size.height; y += pitch) {
      canvas.drawLine(Offset(kGridPitch * 0.8, y), Offset(size.width, y), line);
      final r = Rect.fromLTWH(kGridPitch * 0.15, y - kGridPitch * 0.45, 12, 12);
      canvas.drawRRect(
          RRect.fromRectAndRadius(r, const Radius.circular(3)), strong);
    }
  }

  @override
  bool shouldRepaint(PaperPainter old) =>
      old.template != template || old.dark != dark || old.overrideBg != overrideBg;
}
