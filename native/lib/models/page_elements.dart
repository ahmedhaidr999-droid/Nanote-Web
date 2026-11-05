import 'dart:math' as math;
import 'package:flutter/material.dart';

import 'paper.dart';

/// Base of page elements (text boxes, shapes, images/stickers).
/// Position/size in page points; rotation in radians clockwise.
abstract class PageElement {
  String id;
  double x, y, w, h, rotation;
  bool selected;
  PageElement({
    required this.id,
    required this.x, required this.y,
    required this.w, required this.h,
    this.rotation = 0,
    this.selected = false,
  });

  String get type;
  Map<String, dynamic> toJson();
  factory PageElement.fromJson(Map<String, dynamic> j) {
    final type = j['type'] as String;
    return switch (type) {
      'text' => TextEl.fromJson(j),
      'shape' => ShapeEl.fromJson(j),
      'image' => ImageEl.fromJson(j),
      _ => throw FormatException('unknown element type $type'),
    };
  }

  Rect localRect() => Rect.fromLTWH(x, y, w, h);

  /// Axis-aligned bbox of the rotated rect.
  Rect bbox() {
    if (rotation == 0) return localRect();
    final c = center, q = Quad(corners: corners);
    return q.bbox;
  }

  Offset get center => Offset(x + w / 2, y + h / 2);

  List<Offset> corners() {
    final c = center, hw = w / 2, hh = h / 2;
    final cos = math.cos(rotation), sin = math.sin(rotation);
    Offset rot(Offset p) => Offset(
      c.dx + p.dx * cos - p.dy * sin, c.dy + p.dx * sin + p.dy * cos);
    return [
      rot(Offset(-hw, -hh)), rot(Offset(hw, -hh)),
      rot(Offset(hw, hh)), rot(Offset(-hw, hh)),
    ];
  }

  /// Hit test: inverse-rotate the point into local frame.
  bool hitTest(Offset pt, {double slack = 6}) {
    final c = center;
    final cos = math.cos(-rotation), sin = math.sin(-rotation);
    final d = pt - c;
    final local = Offset(c.dx + d.dx * cos - d.dy * sin,
        c.dy + d.dx * sin + d.dy * cos);
    return local.dx >= x - slack && local.dx <= x + w + slack &&
        local.dy >= y - slack && local.dy <= y + h + slack;
  }

  void translateBy(Offset d) {
    x += d.dx; y += d.dy;
  }

  void scaleBy(double s, Offset anchor) {
    x = anchor.dx + (x - anchor.dx) * s;
    y = anchor.dy + (y - anchor.dy) * s;
    w *= s; h *= s;
  }

  void rotateBy(double rad, Offset pivot) {
    final c = center;
    final cos = math.cos(rad), sin = math.sin(rad);
    final dx = c.dx - pivot.dx, dy = c.dy - pivot.dy;
    final nc = Offset(pivot.dx + dx * cos - dy * sin,
        pivot.dy + dx * sin + dy * cos);
    x = nc.dx - w / 2; y = nc.dy - h / 2;
    rotation += rad;
  }

  PageElement deepCopy({String? newId});
}

/// Minimal quad used for rotated bboxes.
class Quad {
  final List<Offset> corners;
  Quad({required this.corners});
  Rect get bbox {
    var l = corners.first.dx, t = corners.first.dy;
    var r = l, b = t;
    for (final p in corners) {
      if (p.dx < l) l = p.dx; if (p.dx > r) r = p.dx;
      if (p.dy < t) t = p.dy; if (p.dy > b) b = p.dy;
    }
    return Rect.fromLTRB(l, t, r, b);
  }
}

class TextEl extends PageElement {
  String text;
  int colorValue;
  double fontSize;
  bool bold;
  int align; // 0 start, 1 center, 2 end
  TextEl({
    required super.id, required super.x, required super.y,
    required super.w, required super.h,
    required this.text, required this.colorValue,
    required this.fontSize, this.bold = false, this.align = 0,
    super.rotation, super.selected,
  });

  @override
  String get type => 'text';

  @override
  Map<String, dynamic> toJson() => {
    'type': type, 'id': id, 'x': x, 'y': y, 'w': w, 'h': h, 'r': rotation,
    'text': text, 'c': colorValue, 'fs': fontSize, 'b': bold, 'a': align,
  };

  factory TextEl.fromJson(Map<String, dynamic> j) => TextEl(
    id: j['id'], x: _d(j['x']), y: _d(j['y']), w: _d(j['w']), h: _d(j['h']),
    rotation: _d(j['r'] ?? 0), text: (j['text'] as String?) ?? '',
    colorValue: (j['c'] as num?)?.toInt() ?? 0xFF16233A,
    fontSize: _d(j['fs'] ?? 18), bold: j['b'] == true,
    align: (j['a'] as num?)?.toInt() ?? 0,
  );

  @override
  TextEl deepCopy({String? newId}) => TextEl(
    id: newId ?? id, x: x, y: y, w: w, h: h, rotation: rotation,
    text: text, colorValue: colorValue, fontSize: fontSize,
    bold: bold, align: align, selected: selected,
  );
}

class ShapeEl extends PageElement {
  ShapeType shape;
  int strokeColorValue;
  int? fillColorValue;
  double strokeWidth;
  bool filled;
  ShapeEl({
    required super.id, required super.x, required super.y,
    required super.w, required super.h,
    required this.shape, required this.strokeColorValue,
    this.fillColorValue, this.strokeWidth = 2.5, this.filled = false,
    super.rotation, super.selected,
  });

  @override
  String get type => 'shape';

  @override
  Map<String, dynamic> toJson() => {
    'type': type, 'id': id, 'x': x, 'y': y, 'w': w, 'h': h, 'r': rotation,
    'shape': shape.name, 'c': strokeColorValue,
    if (fillColorValue != null) 'f': fillColorValue,
    'sw': strokeWidth, 'fl': filled,
  };

  factory ShapeEl.fromJson(Map<String, dynamic> j) => ShapeEl(
    id: j['id'], x: _d(j['x']), y: _d(j['y']), w: _d(j['w']), h: _d(j['h']),
    rotation: _d(j['r'] ?? 0),
    shape: ShapeType.values.firstWhere(
        (s) => s.name == j['shape'], orElse: () => ShapeType.rect),
    strokeColorValue: (j['c'] as num?)?.toInt() ?? 0xFF1E6FF2,
    fillColorValue: (j['f'] as num?)?.toInt(),
    strokeWidth: _d(j['sw'] ?? 2.5), filled: j['fl'] == true,
  );

  @override
  ShapeEl deepCopy({String? newId}) => ShapeEl(
    id: newId ?? id, x: x, y: y, w: w, h: h, rotation: rotation,
    shape: shape, strokeColorValue: strokeColorValue,
    fillColorValue: fillColorValue, strokeWidth: strokeWidth,
    filled: filled, selected: selected,
  );
}

class ImageEl extends PageElement {
  /// File key in the store (user images / sticker PNGs), or null for emoji.
  String? fileKey;
  String? emoji; // built-in emoji sticker
  bool isSticker;
  ImageEl({
    required super.id, required super.x, required super.y,
    required super.w, required super.h,
    this.fileKey, this.emoji, this.isSticker = false,
    super.rotation, super.selected,
  });

  @override
  String get type => 'image';

  @override
  Map<String, dynamic> toJson() => {
    'type': type, 'id': id, 'x': x, 'y': y, 'w': w, 'h': h, 'r': rotation,
    if (fileKey != null) 'fk': fileKey,
    if (emoji != null) 'e': emoji,
    'st': isSticker,
  };

  factory ImageEl.fromJson(Map<String, dynamic> j) => ImageEl(
    id: j['id'], x: _d(j['x']), y: _d(j['y']), w: _d(j['w']), h: _d(j['h']),
    rotation: _d(j['r'] ?? 0), fileKey: j['fk'] as String?,
    emoji: j['e'] as String?, isSticker: j['st'] == true,
  );

  @override
  ImageEl deepCopy({String? newId}) => ImageEl(
    id: newId ?? id, x: x, y: y, w: w, h: h, rotation: rotation,
    fileKey: fileKey, emoji: emoji, isSticker: isSticker, selected: selected,
  );
}

double _d(Object? v) => (v as num?)?.toDouble() ?? 0;
