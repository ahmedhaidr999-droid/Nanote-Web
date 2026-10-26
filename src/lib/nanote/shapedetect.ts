// Freehand shape recognition (Notewise-style draw & hold).
// Given the points of a stroke, decide whether it is a straight line, arrow,
// rectangle (square), ellipse (circle) or triangle drawn sloppily — and return
// the perfect element geometry to snap it to. InkSurface calls this while the
// pointer DWELLS at the end of a stroke (pen held still ~600ms): if confident,
// the live stroke morphs into the clean shape and commits on release.
//
// v2 — rebuilt after field reports that squares, rectangles, circles and
// arrows "never" recognized. The v1 had three killers:
//   1. the closed-stroke gate compared the start↔end gap against a size bound
//      derived from the SAME gap (`chord > 24`), so any properly closed loop
//      (gap ≈ 0) could never enter the rect/circle branch — the entire
//      closed-shape half of the recognizer was dead code;
//   2. corner detection fired per-sample at 55°, so hand jitter split one 90°
//      corner into two ~45° samples and rect detection saw 2..6 "corners";
//   3. the arrow test required the head to "leave in the body direction"
//      which a real V-head (drawn back from the tip) never does.
// v2 scores multiple shape hypotheses against the ink and picks the best fit:
//   • closure tolerance scales with the shape size (users stop a few px short);
//   • corners use windowed directions (±2 samples) so jitter can't split them;
//   • rect vs ellipse is decided by radius-vs-angle peaks (a rect has 4 corner
//     radius maxima, an ellipse 2) plus frame-fit error — not by corner count
//     alone;
//   • arrows accept V-heads and single-barb hooks drawn back from the tip.
// Handwriting protection: every hypothesis demands a small fit error relative
// to the shape size, and scribbles fit nothing well.
import { ShapeType } from './types';

export interface RecognizedShape {
  shape: ShapeType;
  /** for line/arrow: start point; for the rest: top-left of the tight frame */
  x: number;
  y: number;
  /** for line/arrow: (dx, dy) to the end; for the rest: (w, h) of the frame */
  w: number;
  h: number;
}

interface Pt { x: number; y: number }

/** resample a polyline to n equidistant points */
export function resample(pts: Pt[], n: number): Pt[] {
  if (pts.length < 2) return pts.slice();
  const out: Pt[] = [pts[0]];
  const total = pathLength(pts);
  if (total < 1) return [pts[0], pts[pts.length - 1]];
  const step = total / (n - 1);
  let carried = 0;
  for (let i = 1; i < pts.length; i++) {
    let ax = pts[i - 1].x, ay = pts[i - 1].y;
    const bx = pts[i].x, by = pts[i].y;
    let seg = Math.hypot(bx - ax, by - ay);
    while (carried + seg >= step && out.length < n) {
      const t = (step - carried) / seg;
      const nx = ax + (bx - ax) * t;
      const ny = ay + (by - ay) * t;
      out.push({ x: nx, y: ny });
      ax = nx; ay = ny;
      seg = Math.hypot(bx - ax, by - ay);
      carried = 0;
    }
    carried += seg;
  }
  while (out.length < n) out.push(pts[pts.length - 1]);
  return out;
}

export function pathLength(pts: Pt[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return s;
}

function bboxOf(pts: Pt[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1 };
}

/** max perpendicular distance of any point from the chord start→end */
function chordDeviation(pts: Pt[]): number {
  const a = pts[0], b = pts[pts.length - 1];
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return Infinity;
  let worst = 0;
  for (const p of pts) worst = Math.max(worst, Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len);
  return worst;
}

/** perpendicular distance from p to the infinite line a→b */
function distToLine(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

/** distance from p to segment a→b */
function distToSeg(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * corner indices via WINDOWED directions: the direction at i is measured over
 * a ±2-sample span, so one 90° corner stays one ~70-100° turn even with hand
 * jitter (v1 compared single steps and jitter split corners in half).
 * Non-max suppressed over ~n/12 samples. Returns corners sorted by position;
 * each entry keeps its turn angle so callers can rank strength.
 * `cyclic` wraps the scan around the stroke seam — a corner drawn exactly at
 * the start/end of a closed loop (users start squares ON a corner!) must be
 * seen too; the open-stroke path keeps the linear scan (no seam corner).
 */
function findCorners(rs: Pt[], deg: number, cyclic = false): { i: number; a: number }[] {
  const n = rs.length;
  const span = 2;
  const turns: { i: number; a: number }[] = [];
  const lo = cyclic ? 0 : span;
  const hi = cyclic ? n - 1 : n - 1 - span;
  for (let i = lo; i <= hi; i++) {
    const a = rs[(i - span + n) % n], b = rs[i % n], c = rs[(i + span) % n];
    const v1x = b.x - a.x, v1y = b.y - a.y;
    const v2x = c.x - b.x, v2y = c.y - b.y;
    const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
    if (l1 < 1e-6 || l2 < 1e-6) continue;
    const cos = (v1x * v2x + v1y * v2y) / (l1 * l2);
    const ang = Math.acos(Math.min(1, Math.max(-1, cos))) * 180 / Math.PI;
    if (ang > deg) turns.push({ i, a: ang });
  }
  const win = Math.max(3, Math.floor(n / 12));
  turns.sort((p, q) => q.a - p.a);
  const dist = (a: number, b: number) => cyclic
    ? Math.min(Math.abs(a - b), n - Math.abs(a - b))
    : Math.abs(a - b);
  const taken: { i: number; a: number }[] = [];
  for (const t of turns) {
    if (taken.every((k) => dist(k.i, t.i) > win)) taken.push(t);
  }
  return taken.sort((p, q) => p.i - q.i);
}

/** mean distance of every point to the axis-aligned rect frame (4 segments) */
function rectFrameError(rs: Pt[], bb: ReturnType<typeof bboxOf>): number {
  const corners: [Pt, Pt][] = [
    [{ x: bb.x0, y: bb.y0 }, { x: bb.x1, y: bb.y0 }],
    [{ x: bb.x1, y: bb.y0 }, { x: bb.x1, y: bb.y1 }],
    [{ x: bb.x1, y: bb.y1 }, { x: bb.x0, y: bb.y1 }],
    [{ x: bb.x0, y: bb.y1 }, { x: bb.x0, y: bb.y0 }],
  ];
  let sum = 0;
  for (const p of rs) {
    let best = Infinity;
    for (const [a, b] of corners) best = Math.min(best, distToSeg(p, a, b));
    sum += best;
  }
  return sum / rs.length;
}

/** mean distance of every point to the closed triangle a→b→c→a */
function triangleFrameError(rs: Pt[], a: Pt, b: Pt, c: Pt): number {
  let sum = 0;
  for (const p of rs) {
    sum += Math.min(
      distToSeg(p, a, b),
      distToSeg(p, b, c),
      distToSeg(p, c, a),
    );
  }
  return sum / rs.length;
}

interface RadialStats { cv: number; peaks: number; maxGapDeg: number }

/**
 * radius-vs-angle statistics around the centroid. An ellipse's radius has 2
 * maxima (the long axis); a rectangle's has 4 (the corners). `maxGapDeg` is
 * the largest angular jump between consecutive samples — an open "C" arc
 * leaves a big gap and must not close into a circle.
 */
function radialStats(rs: Pt[], cx: number, cy: number): RadialStats {
  const m = rs.length;
  const rads: number[] = new Array(m);
  const angs: number[] = new Array(m);
  let mean = 0;
  for (let i = 0; i < m; i++) {
    const dx = rs[i].x - cx, dy = rs[i].y - cy;
    rads[i] = Math.hypot(dx, dy);
    angs[i] = Math.atan2(dy, dx);
    mean += rads[i];
  }
  mean /= m || 1;
  let variance = 0;
  for (const r of rads) variance += (r - mean) ** 2;
  variance /= m || 1;
  const cv = Math.sqrt(variance) / (mean || 1);

  // smoothed radius maxima (window 3) that rise meaningfully above the mean
  const smooth = (arr: number[]) => arr.map((_, i) => {
    let s = 0, c = 0;
    for (let k = -2; k <= 2; k++) {
      const j = (i + k + arr.length) % arr.length;
      s += arr[j]; c++;
    }
    return s / c;
  });
  const sm = smooth(rads);
  let peaks = 0;
  for (let i = 0; i < m; i++) {
    const v = sm[i];
    if (v < mean * 1.06) continue;
    let isMax = true;
    for (let k = -3; k <= 3; k++) {
      if (k === 0) continue;
      if (sm[(i + k + m) % m] > v) { isMax = false; break }
    }
    if (isMax) {
      peaks++;
      // skip ahead so one wide plateau is not counted as several peaks
      i += 4;
    }
  }
  // largest angular gap (cyclic, between consecutive samples)
  let maxGap = 0;
  for (let i = 0; i < m; i++) {
    let d = angs[(i + 1) % m] - angs[i];
    if (d < -Math.PI) d += Math.PI * 2;
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < 0) d = -d;
    maxGap = Math.max(maxGap, d);
  }
  return { cv, peaks, maxGapDeg: (maxGap * 180) / Math.PI };
}

/** index into pts at the given fraction of total arc length */
function indexAtArc(pts: Pt[], frac: number): number {
  const total = pathLength(pts);
  let acc = 0;
  const target = total * frac;
  for (let i = 1; i < pts.length; i++) {
    acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (acc >= target) return i;
  }
  return pts.length - 1;
}

/**
 * Try to recognize a finished freehand stroke as a clean shape.
 * Returns null when the ink looks like intentional handwriting (low
 * confidence) — recognition must stay conservative.
 */
export function recognizeShape(raw: Pt[]): RecognizedShape | null {
  const n = raw.length;
  if (n < 10) return null;
  const total = pathLength(raw);
  if (total < 40) return null;

  const rs = resample(raw, 64);
  const a = rs[0], b = rs[rs.length - 1];
  const gap = Math.hypot(b.x - a.x, b.y - a.y);
  const bb = bboxOf(rs);
  const bw = bb.x1 - bb.x0, bh = bb.y1 - bb.y0;
  const diag = Math.hypot(bw, bh) || 1;
  const avgDim = (bw + bh) / 2 || 1;

  // closure: users stop a few px short of the starting corner — the tolerance
  // scales with the shape size (v1's gate could never pass a closed loop)
  const closeTol = Math.max(16, Math.min(0.3 * Math.min(bw, bh), 90));
  const closed = gap < closeTol;

  // ---------- closed strokes: rect / square / ellipse / circle / triangle
  if (closed) {
    const corners = findCorners(rs, 40, true);
    const cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2;
    const rad = radialStats(rs, cx, cy);

    // --- rectangle / square hypothesis: 3-5 corner clusters (jitter can hide
    // or split one) + points hugging the frame
    if (corners.length >= 3 && corners.length <= 5) {
      const fit = rectFrameError(rs, bb);
      if (fit < 0.085 * avgDim) {
        // a rect's radius profile peaks at its 4 corners; an ellipse peaks
        // twice — never call an ellipse a rect
        if (rad.peaks >= 3 || rad.cv > 0.22) {
          return { shape: 'rect', x: bb.x0, y: bb.y0, w: bw, h: bh };
        }
      }
    }

    // --- ellipse / circle hypothesis: smooth radius (≤2 peaks), low CV,
    // full angular coverage (a "C" arc has a huge angular gap)
    if (rad.peaks <= 2 && rad.cv < 0.24 && rad.maxGapDeg < 110) {
      return { shape: 'ellipse', x: bb.x0, y: bb.y0, w: bw, h: bh };
    }

    // --- triangle hypothesis: the 3 STRONGEST corners (a jitter artifact can
    // add a weak 4th) + tight fit to the triangle they form
    if (corners.length >= 3) {
      const top3 = [...corners].sort((p, q) => q.a - p.a).slice(0, 3).sort((p, q) => p.i - q.i);
      const t = [rs[top3[0].i], rs[top3[1].i], rs[top3[2].i]];
      const sides = [
        Math.hypot(t[1].x - t[0].x, t[1].y - t[0].y),
        Math.hypot(t[2].x - t[1].x, t[2].y - t[1].y),
        Math.hypot(t[0].x - t[2].x, t[0].y - t[2].y),
      ];
      const fit = triangleFrameError(rs, t[0], t[1], t[2]);
      if (fit < 0.075 * diag && Math.min(...sides) > 0.22 * diag) {
        const tb = bboxOf(t);
        return { shape: 'triangle', x: tb.x0, y: tb.y0, w: tb.x1 - tb.x0, h: tb.y1 - tb.y0 };
      }
    }

    // --- last chance rect: frame fits beautifully even if corners were missed
    // (very sloppy hand-rounded rectangles)
    const fitAny = rectFrameError(rs, bb);
    if (fitAny < 0.05 * avgDim && rad.peaks >= 3) {
      return { shape: 'rect', x: bb.x0, y: bb.y0, w: bw, h: bh };
    }
    return null;
  }

  // ---------- open strokes: line / arrow
  const chord = gap; // start↔end distance (shape is open)
  // main body = first ~70% of arc length
  const bodyEnd = indexAtArc(raw, 0.7);
  const body = raw.slice(0, Math.max(4, bodyEnd));
  const bodyLen = pathLength(body);
  const bodyChord = Math.hypot(body[body.length - 1].x - body[0].x, body[body.length - 1].y - body[0].y);
  const bodyDev = chordDeviation(body);
  const straightish = bodyLen > 28 && bodyChord / bodyLen > 0.83 && bodyDev < 0.13 * Math.max(bodyChord, 1);
  if (!straightish) return null;

  const bodyStart = body[0];
  const bodyTip = body[body.length - 1];
  // tail = everything after the body
  const tail = raw.slice(bodyEnd);
  const tailLen = pathLength(tail);
  if (tailLen < 8) {
    // pure line: whole stroke nearly straight
    const dev = chordDeviation(rs);
    if (dev < 0.1 * Math.max(chord, 1) && total / Math.max(1, chord) < 1.3) {
      return { shape: 'line', x: raw[0].x, y: raw[0].y, w: b.x - raw[0].x, h: b.y - raw[0].y };
    }
    return null;
  }

  // arrow: the tail must swing away from the body line (the head barbs), the
  // END must return close to the body line (barbs end beside the tip), and the
  // stroke's farthest reach along the body direction must be LATE in the
  // stroke (the head is at the end, not the start). Accepts V-heads (two
  // barbs drawn back from the tip), retraced V-heads and single-barb hooks.
  let tailDev = 0;
  for (const p of tail) tailDev = Math.max(tailDev, distToLine(p, bodyStart, bodyTip));
  const endDev = distToLine(raw[raw.length - 1], bodyStart, bodyTip);
  const bdx = bodyTip.x - bodyStart.x, bdy = bodyTip.y - bodyStart.y;
  const bl = Math.hypot(bdx, bdy) || 1;
  let maxProj = -Infinity, maxIdx = 0;
  raw.forEach((p, i) => {
    const pr = ((p.x - bodyStart.x) * bdx + (p.y - bodyStart.y) * bdy) / bl;
    if (pr > maxProj) { maxProj = pr; maxIdx = i }
  });
  const tipLate = maxIdx >= raw.length * 0.5;
  const headSized = tailLen > 0.08 * bodyLen && tailLen < 0.85 * bodyLen;
  if (tailDev > Math.max(6, 0.05 * bodyLen) && endDev < Math.max(20, 0.3 * bodyLen) && tipLate && headSized) {
    return { shape: 'arrow', x: raw[0].x, y: raw[0].y, w: bodyTip.x - raw[0].x, h: bodyTip.y - raw[0].y };
  }

  // line fallback (mild tail wobble, e.g. the pen skidding at the end)
  const dev = chordDeviation(rs);
  if (dev < 0.1 * Math.max(chord, 1) && total / Math.max(1, chord) < 1.3) {
    return { shape: 'line', x: raw[0].x, y: raw[0].y, w: b.x - raw[0].x, h: b.y - raw[0].y };
  }
  return null;
}
