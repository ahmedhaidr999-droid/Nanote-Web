import 'dart:math' as math;
import 'package:flutter/material.dart';

/// Pen physics families (5) — map to perfect_freehand profiles.
enum PenKind { pen, brush, pencil, marker, highlighter }

class PenProfile {
  final double thinning, smoothing, streamline, opacity;
  const PenProfile(this.thinning, this.smoothing, this.streamline, this.opacity);
}

const kPenProfiles = {
  PenKind.pen:        PenProfile(0.55, 0.52, 0.52, 1.0),
  PenKind.brush:      PenProfile(1.00, 0.62, 0.42, 1.0),
  PenKind.pencil:     PenProfile(0.30, 0.45, 0.58, 0.85),
  PenKind.marker:     PenProfile(0.00, 0.50, 0.50, 0.95),
  PenKind.highlighter: PenProfile(0.00, 0.40, 0.40, 0.45),
};

/// One sampled input point in PAGE-POINT space (device independent).
class StrokePoint {
  double x, y, p; // p = pressure 0..1
  StrokePoint(this.x, this.y, this.p);
  Offset get offset => Offset(x, y);

  Map<String, dynamic> toJson() => {'x': x, 'y': y, 'p': p};
  factory StrokePoint.fromJson(Map<String, dynamic> j) =>
      StrokePoint((j['x'] as num).toDouble(), (j['y'] as num).toDouble(),
          (j['p'] as num?)?.toDouble() ?? 0.5);
}

/// An ink stroke. Stored per page; coordinates in page points.
class Stroke {
  final String id;
  final PenKind kind;
  final int colorValue;
  final double size;
  final String? groupId; // selection group
  double? tStart, tEnd; // ms offsets when recorded with synced audio
  bool selected; // transient selection state
  List<StrokePoint> points;

  // transient caches (not persisted)
  List<List<Offset>>? outlineCache;
  Rect? _bboxCache;

  Stroke({
    required this.id,
    required this.kind,
    required this.colorValue,
    required this.size,
    required this.points,
    this.groupId,
    this.tStart,
    this.tEnd,
    this.selected = false,
  });

  Color get color => Color(colorValue);
  PenProfile get profile => kPenProfiles[kind] ?? kPenProfiles[PenKind.pen]!;

  Rect bbox() {
    final c = _bboxCache;
    if (c != null) return c;
    if (points.isEmpty) return Rect.zero;
    var l = points.first.x, t = points.first.y, r = l, b = t;
    for (final p in points) {
      if (p.x < l) l = p.x;
      if (p.x > r) r = p.x;
      if (p.y < t) t = p.y;
      if (p.y > b) b = p.y;
    }
    final pad = size / 2 + 2;
    return _bboxCache = Rect.fromLTRB(l - pad, t - pad, r + pad, b + pad);
  }

  bool hitTest(Offset pt, double radius) {
    final r = radius + size / 2;
    var prev = points.first.offset;
    for (final p in points) {
      if (_distToSeg(pt, prev, p.offset) <= r) return true;
      prev = p.offset;
    }
    return false;
  }

  static double _distToSeg(Offset p, Offset a, Offset b) {
    final ab = b - a;
    final len2 = ab.dx * ab.dx + ab.dy * ab.dy;
    if (len2 == 0) return (p - a).distance;
    var t = ((p - a).dx * ab.dx + (p - a).dy * ab.dy) / len2;
    t = t.clamp(0.0, 1.0);
    return (p - (a + ab * t)).distance;
  }

  bool intersectsRect(Rect r) => bbox().overlaps(r);

  bool insidePolygon(List<Offset> poly) {
    // bbox fast reject, then representative points inside test.
    if (!bbox().overlaps(_polyBbox(poly))) return false;
    var hits = 0;
    for (final p in points) {
      if (_pointInPoly(p.offset, poly)) hits++;
    }
    return hits > 0; // lasso: any part inside → selected (web behavior)
  }

  static Rect _polyBbox(List<Offset> poly) {
    var l = poly.first.dx, t = poly.first.dy, r = l, b = t;
    for (final p in poly) {
      l = math.min(l, p.dx); r = math.max(r, p.dx);
      t = math.min(t, p.dy); b = math.max(b, p.dy);
    }
    return Rect.fromLTRB(l, t, r, b);
  }

  static bool _pointInPoly(Offset pt, List<Offset> poly) =>
      pointInPoly(pt, poly);

  /// Ray-casting point-in-polygon (public — used by selection + elements).
  static bool pointInPoly(Offset pt, List<Offset> poly) {
    var inside = false;
    var j = poly.length - 1;
    for (var i = 0; i < poly.length; i++) {
      final pi = poly[i], pj = poly[j];
      if ((pi.dy > pt.dy) != (pj.dy > pt.dy) &&
          pt.dx < (pj.dx - pi.dx) * (pt.dy - pi.dy) / (pj.dy - pi.dy) + pi.dx) {
        inside = !inside;
      }
      j = i;
    }
    return inside;
  }

  // ── geometric transforms (selection gestures) ──
  void translateBy(Offset d) {
    _bboxCache = null; outlineCache = null;
    for (final p in points) {
      p.x += d.dx; p.y += d.dy;
    }
  }

  void scaleBy(double s, Offset anchor) {
    _bboxCache = null; outlineCache = null;
    for (final p in points) {
      p.x = anchor.dx + (p.x - anchor.dx) * s;
      p.y = anchor.dy + (p.y - anchor.dy) * s;
    }
  }

  void rotateBy(double rad, Offset center) {
    _bboxCache = null; outlineCache = null;
    final cos = math.cos(rad), sin = math.sin(rad);
    for (final p in points) {
      final dx = p.x - center.dx, dy = p.y - center.dy;
      p.x = center.dx + dx * cos - dy * sin;
      p.y = center.dy + dx * sin + dy * cos;
    }
  }

  Stroke deepCopy({String? newId}) => Stroke(
    id: newId ?? id,
    kind: kind, colorValue: colorValue, size: size,
    points: [for (final p in points) StrokePoint(p.x, p.y, p.p)],
    groupId: groupId, tStart: tStart, tEnd: tEnd, selected: selected,
  );

  Map<String, dynamic> toJson() => {
    'id': id, 'kind': kind.name, 'c': colorValue, 's': size,
    'pts': [for (final p in points) p.toJson()],
    if (groupId != null) 'g': groupId,
    if (tStart != null) 'ts': tStart,
    if (tEnd != null) 'te': tEnd,
  };

  factory Stroke.fromJson(Map<String, dynamic> j) => Stroke(
    id: j['id'] as String,
    kind: PenKind.values.firstWhere(
        (k) => k.name == j['kind'], orElse: () => PenKind.pen),
    colorValue: (j['c'] as num).toInt(),
    size: (j['s'] as num).toDouble(),
    points: [
      for (final p in (j['pts'] as List)) StrokePoint.fromJson(p as Map<String, dynamic>)
    ],
    groupId: j['g'] as String?,
    tStart: (j['ts'] as num?)?.toDouble(),
    tEnd: (j['te'] as num?)?.toDouble(),
  );
}
