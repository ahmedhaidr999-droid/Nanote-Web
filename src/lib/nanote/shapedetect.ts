// Freehand shape recognition (Notewise-style draw & hold).
// Given the points of a stroke, decide whether it is a straight line, arrow,
// rectangle, ellipse or triangle drawn sloppily — and return the perfect
// element geometry to snap it to. InkSurface calls this while the pointer
// DWELLS at the end of a stroke (pen held still ~600ms): if confident, the
// live stroke morphs into the clean shape and commits on release.
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

/** count corners (indices) with turning angle above `deg`, non-max suppressed */
function findCorners(rs: Pt[], deg: number): number[] {
  const n = rs.length;
  const turns: { i: number; a: number }[] = [];
  for (let i = 1; i < n - 1; i++) {
    const a = rs[i - 1], b = rs[i], c = rs[i + 1];
    const v1x = b.x - a.x, v1y = b.y - a.y;
    const v2x = c.x - b.x, v2y = c.y - b.y;
    const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
    if (l1 < 1e-6 || l2 < 1e-6) continue;
    const cos = (v1x * v2x + v1y * v2y) / (l1 * l2);
    const ang = Math.acos(Math.min(1, Math.max(-1, cos))) * 180 / Math.PI;
    if (ang > deg) turns.push({ i, a: ang });
  }
  // non-max suppression over a window of ~n/10 samples
  const win = Math.max(3, Math.floor(rs.length / 10));
  turns.sort((p, q) => q.a - p.a);
  const taken: number[] = [];
  for (const t of turns) {
    if (taken.every((k) => Math.abs(k - t.i) > win)) taken.push(t.i);
  }
  return taken.sort((p, q) => p - q);
}

/**
 * Try to recognize a finished freehand stroke as a clean shape.
 * Returns null when the ink looks like intentional handwriting (low
 * confidence) — recognition must stay conservative.
 */
export function recognizeShape(raw: Pt[]): RecognizedShape | null {
  const n = raw.length;
  if (n < 12) return null;
  const total = pathLength(raw);
  if (total < 48) return null;

  const rs = resample(raw, 64);
  const a = rs[0], b = rs[rs.length - 1];
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  const bb = bboxOf(rs);
  const diag = Math.hypot(bb.x1 - bb.x0, bb.y1 - bb.y0) || 1;
  const closed = Math.hypot(b.x - a.x, b.y - a.y) < Math.max(18, chord * 0.18) && chord > 24;

  // ---------- open strokes: line / arrow
  if (!closed) {
    // main body = first ~78% of arc length
    const bodyEnd = indexAtArc(raw, 0.78);
    const body = raw.slice(0, Math.max(4, bodyEnd));
    const bodyDev = chordDeviation(body);
    const bodyLen = pathLength(body);
    const bodyChord = Math.hypot(body[body.length - 1].x - body[0].x, body[body.length - 1].y - body[0].y);
    const straightish = bodyLen > 30 && bodyChord / bodyLen > 0.86 && bodyDev < diag * 0.16;
    if (straightish) {
      // arrowhead: the tail doubles back sharply near the end
      if (hasTailHook(raw)) {
        // arrow from body start to the current end point (head at the pen)
        return { shape: 'arrow', x: raw[0].x, y: raw[0].y, w: b.x - raw[0].x, h: b.y - raw[0].y };
      }
      const dev = chordDeviation(rs);
      if (dev < diag * 0.1 && total / Math.max(1, chord) > 0.9) {
        return { shape: 'line', x: raw[0].x, y: raw[0].y, w: b.x - raw[0].x, h: b.y - raw[0].y };
      }
    }
    return null;
  }

  // ---------- closed strokes: rect / triangle / ellipse
  const corners = findCorners(rs, 55);
  const cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2;
  // radial statistics
  let mean = 0;
  const rads: number[] = [];
  for (const p of rs) { const r = Math.hypot(p.x - cx, p.y - cy); rads.push(r); mean += r }
  mean /= rads.length;
  let variance = 0;
  for (const r of rads) variance += (r - mean) ** 2;
  variance /= rads.length;
  const radialCV = Math.sqrt(variance) / (mean || 1);

  if (corners.length === 4) {
    // validate: opposite sides parallel-ish
    const k = [corners[0], corners[1], corners[2], corners[3]];
    const seg = (i: number, j: number) => ({ x: rs[j].x - rs[i].x, y: rs[j].y - rs[i].y });
    const s0 = seg(k[0], k[1]), s1 = seg(k[1], k[2]), s2 = seg(k[2], k[3]), s3 = seg(k[3], k[0]);
    const cross = (u: { x: number; y: number }, v: { x: number; y: number }) => Math.abs(u.x * v.y - u.y * v.x);
    const m0 = Math.hypot(s0.x, s0.y) * Math.hypot(s2.x, s2.y) || 1;
    const m1 = Math.hypot(s1.x, s1.y) * Math.hypot(s3.x, s3.y) || 1;
    if (cross(s0, s2) / m0 < 0.34 && cross(s1, s3) / m1 < 0.34) {
      return { shape: 'rect', x: bb.x0, y: bb.y0, w: bb.x1 - bb.x0, h: bb.y1 - bb.y0 };
    }
    return null;
  }
  if (corners.length === 3) {
    const tri = [rs[corners[0]], rs[corners[1]], rs[corners[2]]];
    const tb = bboxOf(tri);
    return { shape: 'triangle', x: tb.x0, y: tb.y0, w: tb.x1 - tb.x0, h: tb.y1 - tb.y0 };
  }
  if (corners.length <= 2 && radialCV < 0.24) {
    return { shape: 'ellipse', x: bb.x0, y: bb.y0, w: bb.x1 - bb.x0, h: bb.y1 - bb.y0 };
  }
  return null;
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

/** does the final ~25% of the stroke contain a sharp direction reversal? */
function hasTailHook(pts: Pt[]): boolean {
  const endIdx = pts.length - 1;
  const startIdx = indexAtArc(pts, 0.72);
  const tail = pts.slice(Math.max(1, startIdx));
  if (tail.length < 4) return false;
  // direction of the body just before the tail
  const bodyDir = { x: tail[0].x - pts[Math.max(0, startIdx - 3)].x, y: tail[0].y - pts[Math.max(0, startIdx - 3)].y };
  const bl = Math.hypot(bodyDir.x, bodyDir.y) || 1;
  // the tail must (a) leave in roughly the body direction then (b) turn back > 100°
  let turned = false;
  let wentOut = false;
  for (let i = 1; i < tail.length - 1; i++) {
    const v1 = { x: tail[i].x - tail[i - 1].x, y: tail[i].y - tail[i - 1].y };
    const v2 = { x: tail[i + 1].x - tail[i].x, y: tail[i + 1].y - tail[i].y };
    const l1 = Math.hypot(v1.x, v1.y) || 1, l2 = Math.hypot(v2.x, v2.y) || 1;
    const cos1 = (v1.x * bodyDir.x + v1.y * bodyDir.y) / (l1 * bl);
    if (cos1 > 0.5) wentOut = true;
    const cos = (v1.x * v2.x + v1.y * v2.y) / (l1 * l2);
    const ang = Math.acos(Math.min(1, Math.max(-1, cos))) * 180 / Math.PI;
    if (ang > 95) turned = true;
  }
  return wentOut && turned;
}
