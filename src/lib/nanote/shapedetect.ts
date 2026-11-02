// Freehand shape recognition (Notewise-style draw & hold, plus an instant
// pen-lift mode). Given the points of a stroke, decide whether it is a
// geometric shape drawn sloppily — and return the perfect element geometry to
// snap it to, WITH a confidence score (0..1) so callers can gate conversions
// and never mangle handwriting.
//
// v3 — adds confidence scoring for every hypothesis, polygon recognition via
// Ramer–Douglas–Peucker simplification (the vertices become an editable
// freeform vector), double-headed arrows, and "parallel lines" diagrams
// (U/∩/Z/N-shaped strokes → two clean parallel line elements). Recognized
// shapes keep their original position, size and orientation.
//
// Handwriting protection: every hypothesis demands a small fit error relative
// to the shape size AND a minimum confidence (0.55); scribbles fit nothing
// well and are left as ink.
import { ShapeType } from './types';
import { rdpSimplify } from './geometry';

export interface ShapeSpec {
  shape: ShapeType;
  x: number; y: number; w: number; h: number;
  /** polygon side count (regular n-gon) */
  sides?: number;
  /** freeform: vertices normalized to the (x,y,w,h) box, fractions 0..1 */
  pts?: { x: number; y: number }[];
  /** freeform: close the path */
  closed?: boolean;
}

export interface RecogResult {
  /** 0..1 — callers reject anything below their threshold */
  conf: number;
  /** one or more shapes (parallel-lines diagrams produce two line elements) */
  specs: ShapeSpec[];
}

interface Pt { x: number; y: number }

const MIN_CONF = 0.55;

/** remove interior vertices that sit (within `tol`) on the chord between their
 *  neighbors — RDP alone keeps extra points when a long segment is seen
 *  through a coarse chord first (a U-shape's bottom splits in three). */
function dropRedundant(poly: Pt[], tol: number): Pt[] {
  const out = poly.slice();
  let changed = true;
  while (out.length > 2 && changed) {
    changed = false;
    let worstI = -1, worstD = Infinity;
    for (let i = 1; i < out.length - 1; i++) {
      const d = distToLine(out[i], out[i - 1], out[i + 1]);
      if (d < worstD) { worstD = d; worstI = i }
    }
    if (worstI > 0 && worstD < tol) { out.splice(worstI, 1); changed = true }
  }
  return out;
}

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
 * jitter. Non-max suppressed over ~n/12 samples. `cyclic` wraps the scan
 * around the stroke seam — a corner drawn exactly at the start/end of a
 * closed loop must be seen too.
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

/** mean distance of every point to a polyline's segments */
function polyFrameError(rs: Pt[], poly: Pt[], closed: boolean): number {
  let sum = 0;
  const n = poly.length;
  const segs = closed ? n : n - 1;
  for (const p of rs) {
    let best = Infinity;
    for (let i = 0; i < segs; i++) {
      best = Math.min(best, distToSeg(p, poly[i], poly[(i + 1) % n]));
    }
    sum += best;
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
      i += 4;
    }
  }
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

/** map a fit error to a 0..1 confidence: 0 error → 1, error at the family's
 *  tolerance → 0. Clamped; never negative. */
const confFrom = (err: number, tol: number): number => Math.max(0, Math.min(1, 1 - err / Math.max(tol, 1e-6)));

// ---------------------------------------------------------------- hypotheses

interface Hypothesis { conf: number; spec: ShapeSpec; pri?: number }

/** closed → rect / ellipse / triangle / polygon */
function closedHypotheses(rs: Pt[], raw: Pt[], bb: ReturnType<typeof bboxOf>): Hypothesis[] {
  const out: Hypothesis[] = [];
  const corners = findCorners(rs, 40, true);
  const cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2;
  const rad = radialStats(rs, cx, cy);
  const bw = bb.x1 - bb.x0, bh = bb.y1 - bb.y0;
  const diag = Math.hypot(bw, bh) || 1;
  const avgDim = (bw + bh) / 2 || 1;

  // --- rectangle / square
  if (corners.length >= 3 && corners.length <= 5) {
    const fit = rectFrameError(rs, bb);
    if (fit < 0.085 * avgDim && (rad.peaks >= 3 || rad.cv > 0.22)) {
      out.push({ conf: confFrom(fit, 0.085 * avgDim), spec: { shape: 'rect', x: bb.x0, y: bb.y0, w: bw, h: bh } });
    }
  }

  // --- ellipse / circle
  if (rad.peaks <= 2 && rad.cv < 0.24 && rad.maxGapDeg < 110) {
    let conf = confFrom(rad.cv, 0.24) * 0.7 + confFrom(rad.maxGapDeg, 110) * 0.3;
    // equal sides & low cv → a hand-drawn circle: full confidence
    if (Math.abs(bw - bh) < 0.18 * Math.max(bw, bh) && rad.cv < 0.12) conf = Math.max(conf, 0.9);
    out.push({ conf, spec: { shape: 'ellipse', x: bb.x0, y: bb.y0, w: bw, h: bh } });
  }

  // --- triangle
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
      out.push({ conf: confFrom(fit, 0.075 * diag), spec: { shape: 'triangle', x: tb.x0, y: tb.y0, w: tb.x1 - tb.x0, h: tb.y1 - tb.y0 } });
    }
  }

  // --- generic polygon (5..10 vertices via RDP): keep the hand-drawn vertex
  //     positions as an editable freeform vector. Discounted vs the regular
  //     shapes (rect/ellipse/triangle) so a sloppy rectangle never becomes a
  //     freeform when a clean rect explains it just as well.
  {
    const eps = 0.032 * diag;
    let poly = rdpSimplify(rs, eps);
    // merge near-duplicate endpoints of the closed loop
    if (poly.length > 3) {
      const a = poly[0], b = poly[poly.length - 1];
      if (Math.hypot(b.x - a.x, b.y - a.y) < 0.06 * diag) poly = poly.slice(0, -1);
    }
    poly = dropRedundant(poly, eps * 0.8);
    if (poly.length >= 5 && poly.length <= 10) {
      const fit = polyFrameError(rs, poly, true);
      const tol = 0.06 * diag;
      if (fit < tol) {
        const pb = bboxOf(poly);
        const pw = Math.max(1, pb.x1 - pb.x0), ph = Math.max(1, pb.y1 - pb.y0);
        out.push({
          conf: 0.85 * confFrom(fit, tol),
          spec: {
            shape: 'freeform', x: pb.x0, y: pb.y0, w: pw, h: ph, closed: true,
            pts: poly.map((p) => ({ x: (p.x - pb.x0) / pw, y: (p.y - pb.y0) / ph })),
          },
        });
      }
    }
  }

  // --- last-chance rect (sloppy rounded rectangles with missed corners)
  const fitAny = rectFrameError(rs, bb);
  if (fitAny < 0.05 * avgDim && rad.peaks >= 3) {
    out.push({ conf: confFrom(fitAny, 0.05 * avgDim), spec: { shape: 'rect', x: bb.x0, y: bb.y0, w: bw, h: bh } });
  }
  return out;
}

/** open → line / arrow / double arrow / parallel lines */
function openHypotheses(rs: Pt[], raw: Pt[], bb: ReturnType<typeof bboxOf>): { conf: number; specs: ShapeSpec[] }[] {
  const out: { conf: number; specs: ShapeSpec[] }[] = [];
  const a = rs[0], b = rs[rs.length - 1];
  const gap = Math.hypot(b.x - a.x, b.y - a.y);
  const total = pathLength(raw);
  const diag = Math.hypot(bb.x1 - bb.x0, bb.y1 - bb.y0) || 1;

  // --- parallel-lines diagram: RDP → 4 vertices (after redundant-vertex
  //     elimination), first ∥ last segment, both long (U / ∩ / Z / N shaped
  //     strokes become two clean parallel lines)
  {
    const eps = 0.045 * diag;
    let poly = rdpSimplify(rs, eps);
    poly = dropRedundant(poly, eps * 0.8);
    if (poly.length === 4) {
      const [p0, p1, p2, p3] = poly;
      const l1 = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      const l3 = Math.hypot(p3.x - p2.x, p3.y - p2.y);
      const ang1 = Math.atan2(p1.y - p0.y, p1.x - p0.x);
      const ang3 = Math.atan2(p3.y - p2.y, p3.x - p2.x);
      let dAng = Math.abs(ang1 - ang3);
      if (dAng > Math.PI) dAng = Math.PI * 2 - dAng;
      if (dAng > Math.PI / 2) dAng = Math.PI - dAng; // anti-parallel = parallel lines
      const maxSeg = Math.max(l1, l3);
      const connector = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      if (
        l1 > 0.3 * diag && l3 > 0.3 * diag &&
        dAng < (14 * Math.PI) / 180 &&
        connector < 1.35 * maxSeg &&
        gap > 0.25 * diag // a closed loop is a shape, not parallel lines
      ) {
        // each line's straightness against the RAW points
        const mid1 = rs[Math.floor(rs.length * 0.25)];
        const mid3 = rs[Math.floor(rs.length * 0.75)];
        const dev1 = distToLine(mid1, p0, p1);
        const dev3 = distToLine(mid3, p2, p3);
        const tol = 0.05 * diag;
        if (dev1 < tol && dev3 < tol) {
          // parallelism confidence fades to zero at 25° (the hard gate stays 14°)
          const conf = confFrom(dAng, (25 * Math.PI) / 180) * 0.5
            + confFrom(dev1 + dev3, 2 * tol) * 0.5;
          out.push({
            conf,
            specs: [
              { shape: 'line', x: p0.x, y: p0.y, w: p1.x - p0.x, h: p1.y - p0.y },
              { shape: 'line', x: p2.x, y: p2.y, w: p3.x - p2.x, h: p3.y - p2.y },
            ],
          });
        }
      }
    }
  }

  // --- straight line / arrow / double arrow: analyze body + heads
  const bodyEnd = indexAtArc(raw, 0.7);
  const body = raw.slice(0, Math.max(4, bodyEnd));
  const bodyLen = pathLength(body);
  const bodyChord = Math.hypot(body[body.length - 1].x - body[0].x, body[body.length - 1].y - body[0].y);
  const bodyDev = chordDeviation(body);
  const straightish = bodyLen > 28 && bodyChord / bodyLen > 0.83 && bodyDev < 0.13 * Math.max(bodyChord, 1);
  if (!straightish) return out;

  const bodyStart = body[0];
  const bodyTip = body[body.length - 1];
  const tail = raw.slice(bodyEnd);
  const tailLen = pathLength(tail);

  // head at the START too? (double arrow) — the first ~15% of arc must swing
  // away from the body line and come back to it
  const headStartEnd = indexAtArc(raw, 0.16);
  const headStart = raw.slice(0, Math.max(3, headStartEnd));
  const headStartLen = pathLength(headStart);
  let startDev = 0;
  for (const p of headStart) startDev = Math.max(startDev, distToLine(p, bodyStart, bodyTip));
  const startEndDev = distToLine(raw[0], bodyStart, bodyTip);

  if (tailLen < 8) {
    // pure line (whole stroke nearly straight)
    const dev = chordDeviation(rs);
    if (dev < 0.1 * Math.max(gap, 1) && total / Math.max(1, gap) < 1.3) {
      out.push({
        conf: Math.max(confFrom(dev, 0.1 * Math.max(gap, 1)), confFrom(total / Math.max(1, gap) - 1, 0.3)),
        specs: [{ shape: 'line', x: raw[0].x, y: raw[0].y, w: b.x - raw[0].x, h: b.y - raw[0].y }],
      });
    }
    return out;
  }

  // --- arrow: tail swings away (head barbs), ends near the body line, tip late
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
    out.push({
      conf: 0.62 + 0.38 * confFrom(Math.max(0, tailDev / Math.max(6, 0.05 * bodyLen) - 1), 1),
      specs: [{ shape: 'arrow', x: raw[0].x, y: raw[0].y, w: bodyTip.x - raw[0].x, h: bodyTip.y - raw[0].y }],
    });
  }

  // --- double arrow: barbs at BOTH ends of a straight body
  if (
    headStartLen > 0.06 * bodyLen && headStartLen < 0.6 * bodyLen &&
    startDev > Math.max(5, 0.045 * bodyLen) && startEndDev < Math.max(18, 0.28 * bodyLen) &&
    tailDev > Math.max(5, 0.045 * bodyLen) && endDev < Math.max(18, 0.28 * bodyLen)
  ) {
    // both extremes of the projection must sit INSIDE the body span (heads at
    // the ends, not overshooting past them)
    let minProj = Infinity;
    raw.forEach((p) => {
      const pr = ((p.x - bodyStart.x) * bdx + (p.y - bodyStart.y) * bdy) / bl;
      minProj = Math.min(minProj, pr);
    });
    if (minProj > -0.35 * bl && maxProj < 1.35 * bl) {
      out.push({
        conf: 0.68,
        specs: [{ shape: 'darrow', x: raw[0].x, y: raw[0].y, w: bodyTip.x - raw[0].x, h: bodyTip.y - raw[0].y }],
      });
    }
  }

  // line fallback (mild tail wobble)
  const dev = chordDeviation(rs);
  if (dev < 0.1 * Math.max(gap, 1) && total / Math.max(1, gap) < 1.3) {
    out.push({
      conf: Math.max(confFrom(dev, 0.1 * Math.max(gap, 1)), confFrom(total / Math.max(1, gap) - 1, 0.3)),
      specs: [{ shape: 'line', x: raw[0].x, y: raw[0].y, w: b.x - raw[0].x, h: b.y - raw[0].y }],
    });
  }
  return out;
}

/**
 * Try to recognize a finished freehand stroke as clean shape(s).
 * Returns null when the ink looks like intentional handwriting (no hypothesis
 * reaches the confidence floor) — recognition must stay conservative.
 */
export function recognizeShape(rawPts: Pt[]): RecogResult | null {
  const raw: Pt[] = rawPts;
  const n = raw.length;
  // sparse fast mouse drags carry few raw points — the resampler interpolates
  // along the path, so the gate only needs to reject dots
  if (n < 6) return null;
  const total = pathLength(raw);
  if (total < 40) return null;

  const rs = resample(raw, 64);
  const a = rs[0], b = rs[rs.length - 1];
  const gap = Math.hypot(b.x - a.x, b.y - a.y);
  const bb = bboxOf(rs);
  const bw = bb.x1 - bb.x0, bh = bb.y1 - bb.y0;

  // closure: users stop a few px short of the starting corner — tolerance
  // scales with the shape size
  const closeTol = Math.max(16, Math.min(0.3 * Math.min(bw, bh), 90));
  const closed = gap < closeTol;

  let best: { conf: number; specs: ShapeSpec[] } | null = null;
  const consider = (conf: number, specs: ShapeSpec[]) => {
    if (conf < MIN_CONF) return;
    if (!best || conf > best.conf) best = { conf, specs };
  };

  if (closed) {
    for (const h of closedHypotheses(rs, raw, bb)) consider(h.conf, [h.spec]);
  } else {
    for (const h of openHypotheses(rs, raw, bb)) consider(h.conf, h.specs);
  }
  return best as { conf: number; specs: ShapeSpec[] } | null;
}
