import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../models/paper.dart';

/// Builds the Path for each of the 12 shape types inside [rect]
/// (line/arrow span the diagonal of the rect like the web tool).
Path shapePath(ShapeType type, Rect rect) {
  final path = Path();
  final c = rect.center;
  switch (type) {
    case ShapeType.rect:
      path.addRRect(RRect.fromRectAndRadius(rect, const Radius.circular(4)));
    case ShapeType.ellipse:
      path.addOval(rect);
    case ShapeType.line:
      path.moveTo(rect.left, rect.top);
      path.lineTo(rect.right, rect.bottom);
    case ShapeType.arrow:
      _arrow(path, rect);
    case ShapeType.triangle:
      path.moveTo(c.dx, rect.top);
      path.lineTo(rect.right, rect.bottom);
      path.lineTo(rect.left, rect.bottom);
      path.close();
    case ShapeType.diamond:
      path.moveTo(c.dx, rect.top);
      path.lineTo(rect.right, c.dy);
      path.lineTo(c.dx, rect.bottom);
      path.lineTo(rect.left, c.dy);
      path.close();
    case ShapeType.star5:
      _star(path, c, rect.width / 2, rect.height / 2, 5);
    case ShapeType.polygon:
      _regular(path, c, rect.width / 2, rect.height / 2, 6);
    case ShapeType.cloud:
      _cloud(path, rect);
    case ShapeType.callout:
      _callout(path, rect);
    case ShapeType.heart:
      _heart(path, rect);
    case ShapeType.cylinder:
      _cylinder(path, rect);
  }
  return path;
}

void _arrow(Path p, Rect r) {
  final a = Offset(r.left, r.top);
  final b = Offset(r.right, r.bottom);
  final dir = (b - a);
  final len = dir.distance;
  if (len < 1) {
    p.moveTo(a.dx, a.dy);
    p.lineTo(b.dx, b.dy);
    return;
  }
  final u = dir / len;
  final n = Offset(-u.dy, u.dx);
  final head = math.min(len * 0.32, 26.0);
  final wing = head * 0.62;
  p.moveTo(a.dx, a.dy);
  p.lineTo(b.dx - u.dx * head, b.dy - u.dy * head);
  // head wings
  p.moveTo((b - u * head + n * wing).dx, (b - u * head + n * wing).dy);
  p.lineTo(b.dx, b.dy);
  p.lineTo((b - u * head - n * wing).dx, (b - u * head - n * wing).dy);
}

void _star(Path p, Offset c, double rx, double ry, int points,
    [double inner = 0.42]) {
  for (var i = 0; i < points * 2; i++) {
    final ang = -math.pi / 2 + i * math.pi / points;
    final k = i.isEven ? 1.0 : inner;
    final pt = Offset(c.dx + math.cos(ang) * rx * k,
        c.dy + math.sin(ang) * ry * k);
    i == 0 ? p.moveTo(pt.dx, pt.dy) : p.lineTo(pt.dx, pt.dy);
  }
  p.close();
}

void _regular(Path p, Offset c, double rx, double ry, int sides) {
  for (var i = 0; i < sides; i++) {
    final ang = -math.pi / 2 + i * 2 * math.pi / sides;
    final pt = Offset(c.dx + math.cos(ang) * rx, c.dy + math.sin(ang) * ry);
    i == 0 ? p.moveTo(pt.dx, pt.dy) : p.lineTo(pt.dx, pt.dy);
  }
  p.close();
}

void _cloud(Path p, Rect r) {
  final w = r.width, h = r.height;
  final bumps = [
    Rect.fromCenter(center: Offset(r.left + w * 0.22, r.top + h * 0.38), width: w * 0.34, height: h * 0.5),
    Rect.fromCenter(center: Offset(r.left + w * 0.5, r.top + h * 0.26), width: w * 0.36, height: h * 0.55),
    Rect.fromCenter(center: Offset(r.left + w * 0.78, r.top + h * 0.4), width: w * 0.32, height: h * 0.48),
    Rect.fromCenter(center: Offset(r.left + w * 0.3, r.top + h * 0.72), width: w * 0.4, height: h * 0.44),
    Rect.fromCenter(center: Offset(r.left + w * 0.68, r.top + h * 0.74), width: w * 0.38, height: h * 0.42),
  ];
  for (final b in bumps) {
    p.addArc(b, math.pi * 0.85, math.pi * 1.3);
  }
  p.close();
}

void _callout(Path p, Rect r) {
  final body = Rect.fromLTWH(r.left, r.top, r.width, r.height * 0.74);
  p.addRRect(RRect.fromRectAndRadius(body, const Radius.circular(10)));
  p.moveTo(r.left + r.width * 0.24, body.bottom - 1);
  p.lineTo(r.left + r.width * 0.14, r.bottom);
  p.lineTo(r.left + r.width * 0.42, body.bottom - 1);
  p.close();
}

void _heart(Path p, Rect r) {
  final c = r.center;
  final w = r.width / 2, h = r.height / 2;
  p.moveTo(c.dx, r.bottom);
  p.cubicTo(c.dx - w * 1.4, c.dy + h * 0.35, c.dx - w * 1.05, r.top + h * 0.18, c.dx, c.dy - h * 0.12);
  p.cubicTo(c.dx + w * 1.05, r.top + h * 0.18, c.dx + w * 1.4, c.dy + h * 0.35, c.dx, r.bottom);
  p.close();
}

void _cylinder(Path p, Rect r) {
  final ry = r.height * 0.12;
  p.addOval(Rect.fromLTWH(r.left, r.top, r.width, ry * 2));
  p.moveTo(r.left, r.top + ry);
  p.lineTo(r.left, r.bottom - ry);
  p.arcTo(Rect.fromLTWH(r.left, r.bottom - ry * 2, r.width, ry * 2), math.pi, math.pi, false);
  p.lineTo(r.right, r.top + ry);
  p.close();
}
