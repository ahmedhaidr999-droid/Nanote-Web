import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../models/paper.dart';
import '../models/page_elements.dart';

class RecognizedShape {
  final ShapeType type;
  final Rect bbox; // axis-aligned bbox in page points
  final double rotation; // radians (line/arrow direction etc.)
  final double confidence; // 0..1
  const RecognizedShape(this.type, this.bbox, this.rotation, this.confidence);
}

/// Geometric scribble → vector shape (same idea as web recognition v3):
/// RDP-simplify, close-test, corner-count via turn angles, then fit
/// line / triangle / rectangle / polygon / ellipse. Confidence-gated ≥ 0.45.
class ShapeRecognizer {
  static const double minConfidence = 0.45;
  static const int minPoints = 6;

  static RecognizedShape? recognize(List<Offset> pts) {
    if (pts.length < minPoints) return null;

    // resample uniform-ish (speed independence)
    var p = _thin(pts);
    if (p.length < minPoints) return null;

    final bb0 = _bboxOf(p);
    final diag = math.sqrt(bb0.width * bb0.width + bb0.height * bb0.height);
    if (diag < 24) return null; // too tiny to judge

    final simplified = _rdp(p, 2.4);
    final n = simplified.length;

    final closed = (simplified.first - simplified.last).distance <
        math.max(12.0, diag * 0.18);

    if (!closed) {
      // open → line/arrow if straight enough
      final straightness = _straightness(simplified);
      if (straightness > 0.90) {
        final a = simplified.first, b = simplified.last;
        return RecognizedShape(
          ShapeType.line,
          Rect.fromPoints(a, b).inflate(2),
          math.atan2(b.dy - a.dy, b.dx - a.dx),
          straightness,
        );
      }
      return null;
    }

    // closed: count corners
    final corners = _cornerCount(simplified, diag);
    final smoothness = 1.0 - (corners.count / math.max(1, n - 2));

    if (corners.count <= 1 && smoothness > 0.82) {
      // ellipse
      final bb = _bboxOf(p);
      final conf = _ellipseFit(p, bb);
      if (conf >= minConfidence) {
        return RecognizedShape(ShapeType.ellipse, bb.inflate(2), 0, conf);
      }
    }

    if (corners.count >= 3 && corners.count <= 8) {
      final bb = _bboxOf(p);
      switch (corners.count) {
        case 3:
          return RecognizedShape(ShapeType.triangle, bb.inflate(2),
              _dominantAngle(corners.points), 0.62 + 0.3 * smoothness);
        case 4:
          // rectangle if the 4 corners align with the fitted rect
          final rectConf = _rectFit(corners.points, bb);
          if (rectConf >= minConfidence) {
            return RecognizedShape(ShapeType.rect, bb.inflate(2), 0, rectConf);
          }
          return null;
        default:
          return RecognizedShape(
              ShapeType.polygon, bb.inflate(2), 0, 0.5 + 0.2 * smoothness);
      }
    }
    return null;
  }

  static List<Offset> _thin(List<Offset> pts) {
    final out = <Offset>[pts.first];
    for (final p in pts) {
      if ((p - out.last).distance >= 1.8) out.add(p);
    }
    if (out.length < 2) out.add(pts.last);
    return out;
  }

  static Rect _bboxOf(List<Offset> pts) {
    var l = pts.first.dx, t = pts.first.dy, r = l, b = t;
    for (final p in pts) {
      if (p.dx < l) l = p.dx;
      if (p.dx > r) r = p.dx;
      if (p.dy < t) t = p.dy;
      if (p.dy > b) b = p.dy;
    }
    return Rect.fromLTRB(l, t, r, b);
  }

  /// Ramer–Douglas–Peucker.
  static List<Offset> _rdp(List<Offset> pts, double eps) {
    if (pts.length < 3) return List.of(pts);
    final first = pts.first, last = pts.last;
    var idx = -1;
    var dist = 0.0;
    for (var i = 1; i < pts.length - 1; i++) {
      final d = _distToSeg(pts[i], first, last);
      if (d > dist) {
        dist = d;
        idx = i;
      }
    }
    if (dist > eps) {
      final left = _rdp(pts.sublist(0, idx + 1), eps);
      final right = _rdp(pts.sublist(idx), eps);
      return [...left.sublist(0, left.length - 1), ...right];
    }
    return [first, last];
  }

  static double _distToSeg(Offset p, Offset a, Offset b) {
    final ab = b - a;
    final len2 = ab.dx * ab.dx + ab.dy * ab.dy;
    if (len2 == 0) return (p - a).distance;
    var t = ((p - a).dx * ab.dx + (p - a).dy * ab.dy) / len2;
    t = t.clamp(0.0, 1.0);
    return (p - (a + ab * t)).distance;
  }

  static double _straightness(List<Offset> pts) {
    final span = (pts.first - pts.last).distance;
    if (span == 0) return 0;
    var len = 0.0;
    for (var i = 1; i < pts.length; i++) {
      len += (pts[i] - pts[i - 1]).distance;
    }
    return (span / len).clamp(0.0, 1.0);
  }

  static ({int count, List<Offset> points}) _cornerCount(
      List<Offset> pts, double diag) {
    final cosThresh = math.cos(math.pi / 5); // 36° turn = corner
    final distThresh = math.max(10.0, diag * 0.06);
    final corners = <Offset>[];
    final n = pts.length;
    for (var i = 1; i < n - 1; i++) {
      final prev = pts[i - 1], cur = pts[i], next = pts[i + 1];
      final v1 = cur - prev, v2 = next - cur;
      final l1 = v1.distance, l2 = v2.distance;
      if (l1 < distThresh * 0.35 || l2 < distThresh * 0.35) continue;
      final dot = (v1.dx * v2.dx + v1.dy * v2.dy) / (l1 * l2);
      if (dot < cosThresh) {
        // avoid double counting the same corner
        if (corners.isEmpty ||
            (cur - corners.last).distance > distThresh) {
          corners.add(cur);
        }
      }
    }
    return (count: corners.length, points: corners);
  }

  static double _dominantAngle(List<Offset> corners) {
    if (corners.length < 2) return 0;
    return math.atan2(corners[1].dy - corners[0].dy,
        corners[1].dx - corners[0].dx);
  }

  static double _rectFit(List<Offset> corners, Rect bb) {
    if (corners.length != 4) return 0;
    // How close each corner is to its expected rect corner (0..1 avg).
    final expect = [
      bb.topLeft, bb.topRight, bb.bottomRight, bb.bottomLeft,
    ];
    // order corners circularly by angle around center
    final c = bb.center;
    final sorted = [...corners]..sort((a, b) =>
        math.atan2(a.dy - c.dy, a.dx - c.dx)
            .compareTo(math.atan2(b.dy - c.dy, b.dx - c.dx)));
    var sum = 0.0;
    for (var i = 0; i < 4; i++) {
      sum += 1 - (sorted[i] - expect[i]).distance /
          math.max(1.0, math.sqrt(bb.width * bb.width + bb.height * bb.height) / 2);
    }
    final compactness = bb.width > 0 && bb.height > 0
        ? math.min(1, (2 * (bb.width + bb.height) / _perimeterOf(sorted)))
        : 0.0;
    return (sum / 4) * 0.6 + compactness.clamp(0.0, 1.0) * 0.4;
  }

  static double _perimeterOf(List<Offset> poly) {
    var len = 0.0;
    for (var i = 0; i < poly.length; i++) {
      len += (poly[i] - poly[(i + 1) % poly.length]).distance;
    }
    return len;
  }

  static double _ellipseFit(List<Offset> pts, Rect bb) {
    final c = bb.center;
    final rx = math.max(1.0, bb.width / 2), ry = math.max(1.0, bb.height / 2);
    var err = 0.0;
    for (final p in pts) {
      final v = Offset((p.dx - c.dx) / rx, (p.dy - c.dy) / ry).distance - 1;
      err += v * v;
    }
    final rmse = math.sqrt(err / pts.length);
    return (1 - rmse).clamp(0.0, 1.0);
  }
}

/// Build a ShapeEl from a recognition result (used by the gesture router).
ShapeEl shapeFromRecognition(RecognizedShape r, ShapeEl style) {
  return ShapeEl(
    id: style.id,
    x: r.bbox.left, y: r.bbox.top,
    w: r.bbox.width, h: r.bbox.height,
    rotation: r.type == ShapeType.line ? 0 : r.rotation,
    shape: r.type,
    strokeColorValue: style.strokeColorValue,
    fillColorValue: style.fillColorValue,
    strokeWidth: style.strokeWidth, filled: style.filled,
  );
}
