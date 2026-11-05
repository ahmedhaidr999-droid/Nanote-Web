import 'package:flutter/material.dart';
import 'package:perfect_freehand/perfect_freehand.dart';

import '../controllers/stroke_engine.dart';
import '../models/stroke.dart';
import '../persistence/page_store.dart';

/// Paints ink strokes of one page in PAGE-POINT space.
///  • perfect_freehand outlines (cached per stroke, invalidated on transforms)
///  • highlighter runs share one saveLayer (no alpha stacking between strokes)
///  • selection halo under selected strokes
///  • audio-replay ghosting (future strokes drawn at 10% alpha)
class InkPainter extends CustomPainter {
  final PageDoc doc;
  final Stroke? liveStroke;
  final double pointScale; // page-points per logical unit
  final int? replayCursorMs;
  final Color selectionColor;
  final bool dark;

  InkPainter({
    required this.doc,
    required this.liveStroke,
    required this.pointScale,
    required this.selectionColor,
    this.replayCursorMs,
    this.dark = false,
  });

  static List<Offset> outlineFor(Stroke s) {
    final cached = s.outlineCache;
    if (cached != null) return cached;
    final prof = s.profile;
    final pts = <PointVector>[
      for (final p in s.points)
        PointVector(p.x, p.y, p.p.clamp(0.0, 1.0)),
    ];
    final out = getStroke(
      pts,
      options: StrokeOptions(
        size: s.size,
        thinning: prof.thinning,
        smoothing: prof.smoothing,
        streamline: prof.streamline,
        simulatePressure: false,
      ),
    );
    return s.outlineCache = out;
  }

  static Path pathFor(List<Offset> outline) {
    final path = Path();
    if (outline.isEmpty) return path;
    path.moveTo(outline.first.dx, outline.first.dy);
    for (var i = 1; i < outline.length; i++) {
      path.lineTo(outline[i].dx, outline[i].dy);
    }
    path.close();
    return path;
  }

  @override
  void paint(Canvas canvas, Size size) {
    if (doc.strokes.isEmpty && liveStroke == null) return;
    canvas.save();
    canvas.scale(pointScale, pointScale);

    final replay = replayCursorMs;

    // 1) selection halos (under everything)
    final halo = Paint()
      ..color = selectionColor.withValues(alpha: 0.30)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 4.5
      ..strokeJoin = StrokeJoin.round;
    for (final s in doc.strokes.where((s) => s.selected)) {
      canvas.drawPath(pathFor(outlineFor(s)), halo);
    }

    // 2) highlighter runs — one saveLayer per consecutive same-color run.
    //    Inside the layer each stroke uses BlendMode.src → overlapping
    //    strokes MERGE instead of stacking opacity (web highlighter look).
    final run = <Stroke>[];
    Color? runColor;
    void flushRun() {
      if (run.isEmpty) return;
      Rect? bounds;
      for (final s in run) {
        bounds = bounds == null ? s.bbox() : bounds.expandToInclude(s.bbox());
      }
      canvas.saveLayer(bounds!.inflate(8), Paint());
      final p = Paint()
        ..style = PaintingStyle.fill
        ..blendMode = BlendMode.src;
      for (final s in run) {
        p.color = s.color.withValues(alpha: s.profile.opacity * _alphaFor(s, replay));
        canvas.drawPath(pathFor(outlineFor(s)), p);
      }
      canvas.restore();
      run.clear();
      runColor = null;
    }

    for (final s in doc.strokes) {
      final isHl = s.kind == PenKind.highlighter && !_dimmed(s, replay);
      if (isHl) {
        if (runColor != null && runColor != s.color) flushRun();
        runColor = s.color;
        run.add(s);
        continue;
      }
      flushRun();
      if (s.kind == PenKind.highlighter && _dimmed(s, replay)) {
        // dimmed replay ghost — draw plainly
        final p = Paint()
          ..color = s.color.withValues(alpha: s.profile.opacity * 0.10)
          ..style = PaintingStyle.fill;
        canvas.drawPath(pathFor(outlineFor(s)), p);
        continue;
      }
      final p = Paint()
        ..color = s.color.withValues(alpha: s.profile.opacity * _alphaFor(s, replay))
        ..style = PaintingStyle.fill;
      if (s.kind == PenKind.pencil) {
        p.maskFilter = const MaskFilter.blur(BlurStyle.normal, 0.35);
      }
      canvas.drawPath(pathFor(outlineFor(s)), p);
    }
    flushRun();

    // 3) live stroke (full opacity, uncached)
    final ls = liveStroke;
    if (ls != null) {
      final pts = <PointVector>[
        for (final p in ls.points) PointVector(p.x, p.y, p.p.clamp(0.0, 1.0)),
      ];
      final out = getStroke(
        pts,
        options: StrokeOptions(
          size: ls.size,
          thinning: ls.profile.thinning,
          smoothing: ls.profile.smoothing,
          streamline: ls.profile.streamline,
          simulatePressure: false,
        ),
      );
      final p = Paint()
        ..color = ls.color.withValues(alpha: ls.profile.opacity)
        ..style = PaintingStyle.fill;
      canvas.drawPath(pathFor(out), p);
    }

    canvas.restore();
  }

  static bool _dimmed(Stroke s, int? replay) =>
      replay != null && (s.tStart == null || s.tStart! > replay);

  static double _alphaFor(Stroke s, int? replay) {
    if (replay == null) return 1;
    if (s.tStart == null || s.tStart! > replay) return 0.10;
    return 1;
  }

  @override
  bool shouldRepaint(InkPainter old) =>
      old.doc != doc ||
      old.liveStroke != liveStroke ||
      old.replayCursorMs != replayCursorMs ||
      old.pointScale != pointScale ||
      old.dark != dark;
}
