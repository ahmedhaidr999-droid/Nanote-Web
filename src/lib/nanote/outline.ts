// Nanote stroke outline engine — variable-width filled outlines
// (perfect-freehand-style: smoothed quadratic centerline, pressure→width mapping,
// tapered ends for the brush pen, round caps for pens, square caps for highlighter).
//
// computeOutline(points, opts) → flat array [x0,y0,x1,y1,...] describing the
// closed polygon to fill with a single nonzero-winding fill.

import { ToolId } from './types';
import { clamp } from './util';

export interface OP { x: number; y: number; p: number; v: number; ts?: number } // v = speed px/ms at input, ts = event timeStamp (ms) for exact commit

export interface OutlineOpts {
  tool: ToolId;
  width: number;
  gamma: number; // pressure curve exponent from settings
}

const smoothstep = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

function radiusFactor(tool: ToolId, p: number, gamma: number): number {
  switch (tool) {
    case 'fountain': return 0.22 + 0.78 * Math.pow(clamp(p, 0, 1), clamp(gamma, 0.3, 3));
    case 'ballpoint': return 0.52 + 0.48 * Math.pow(clamp(p, 0, 1), clamp(gamma, 0.3, 3));
    // brush: full pressure-curve support + a wider dynamic range — light
    // strokes go genuinely thin, hard presses fill out (the Settings pressure
    // curve shapes it exactly like the other pens)
    case 'brush': return 0.24 + 0.76 * Math.pow(clamp(p, 0, 1), clamp(gamma, 0.3, 3));
    case 'fineliner': return 0.86 + 0.14 * clamp(p, 0, 1);
    case 'highlighter': return 1;
    default: return 1;
  }
}

function circle(cx: number, cy: number, r: number): number[] {
  const out: number[] = [];
  const steps = Math.max(10, Math.ceil(r * 2));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    out.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  return out;
}

/**
 * Spline-sampled centerline with pressure carried.
 * We walk input points through quadratic midpoints (p[i-1]·p[i] mid → p[i] control → p[i]·p[i+1] mid).
 */
function spline(pts: OP[]): OP[] {
  const n = pts.length;
  if (n <= 2) return pts.slice();
  const out: OP[] = [pts[0]];
  for (let i = 1; i < n - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const x0 = (a.x + b.x) / 2, y0 = (a.y + b.y) / 2;
    const x1 = (b.x + c.x) / 2, y1 = (b.y + c.y) / 2;
    const segLen = Math.hypot(x1 - x0, y1 - y0);
    const steps = clamp(Math.ceil(segLen / 7), 2, 8);
    const v = clamp((a.v + b.v + c.v) / 3, 0, 5);
    for (let s = 0; s < steps; s++) {
      const t = s / steps, mt = 1 - t;
      out.push({
        x: mt * mt * x0 + 2 * mt * t * b.x + t * t * x1,
        y: mt * mt * y0 + 2 * mt * t * b.y + t * t * y1,
        p: a.p + (b.p - a.p) * (0.5 + t * 0.5),
        v,
      });
    }
  }
  out.push(pts[n - 1]);
  return out;
}

export function computeOutline(input: OP[], opts: OutlineOpts): number[] {
  const pts = input;
  const n = pts.length;
  if (n === 0) return [];
  const base = Math.max(0.35, opts.width / 2);
  const isHi = opts.tool === 'highlighter';
  const isBrush = opts.tool === 'brush';

  if (n === 1) {
    const q = pts[0];
    return circle(q.x, q.y, base * radiusFactor(opts.tool, q.p, opts.gamma));
  }

  const S = spline(pts);
  const m = S.length;

  // arc-length for end tapering
  const dStart: number[] = new Array(m);
  const dEnd: number[] = new Array(m);
  let total = 0;
  for (let i = 1; i < m; i++) total += Math.hypot(S[i].x - S[i - 1].x, S[i].y - S[i - 1].y);
  let acc = 0;
  for (let i = 0; i < m; i++) {
    if (i > 0) acc += Math.hypot(S[i].x - S[i - 1].x, S[i].y - S[i - 1].y);
    dStart[i] = acc;
    dEnd[i] = total - acc;
  }

  const taperLen = Math.min(total * 0.22, 70);
  const left: number[] = new Array(m * 2);
  const right: number[] = new Array(m * 2);
  const radii: number[] = new Array(m);

  for (let i = 0; i < m; i++) {
    let r = base * radiusFactor(opts.tool, S[i].p, opts.gamma);
    if (isBrush) {
      // tapered ends + velocity thinning
      const endTaper = taperLen > 0
        ? smoothstep(Math.min(dStart[i] / taperLen, dEnd[i] / taperLen, 1))
        : 1;
      const vFactor = clamp(1.18 - S[i].v * 0.22, 0.55, 1.18);
      r *= 0.35 + 0.65 * endTaper * vFactor;
      r = Math.max(r, 0.4);
    }
    radii[i] = r;
    // tangent
    const i0 = Math.max(0, i - 1), i1 = Math.min(m - 1, i + 1);
    let tx = S[i1].x - S[i0].x, ty = S[i1].y - S[i0].y;
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl; ty /= tl;
    const nx = -ty, ny = tx;
    left[i * 2] = S[i].x + nx * r; left[i * 2 + 1] = S[i].y + ny * r;
    right[i * 2] = S[i].x - nx * r; right[i * 2 + 1] = S[i].y - ny * r;
  }

  const out: number[] = [];
  // left side forward
  for (let i = 0; i < m; i++) out.push(left[i * 2], left[i * 2 + 1]);
  // end cap
  if (isHi) {
    out.push(S[m - 1].x + (S[m - 1].x - S[Math.max(0, m - 2)].x) * 0, S[m - 1].y); // square: straight to right side
  } else {
    capArc(out, S[m - 1], S[Math.max(0, m - 2)], radii[m - 1]);
  }
  // right side backward
  for (let i = m - 1; i >= 0; i--) out.push(right[i * 2], right[i * 2 + 1]);
  // start cap
  if (isHi) {
    // square
  } else {
    capArc(out, S[0], S[Math.min(m - 1, 1)], radii[0], true);
  }
  return out;
}

function capArc(out: number[], tip: OP, prev: OP, r: number, reverse = false) {
  if (r <= 0.05) { out.push(tip.x, tip.y); return }
  let tx = tip.x - prev.x, ty = tip.y - prev.y;
  const tl = Math.hypot(tx, ty);
  if (tl < 0.01) { tx = 1; ty = 0 } else { tx /= tl; ty /= tl }
  // start angle: normal direction on the side we're entering from
  const a0 = Math.atan2(ty, tx);
  const from = reverse ? a0 - Math.PI / 2 : a0 + Math.PI / 2;
  const to = from + (reverse ? -Math.PI : Math.PI);
  const steps = 7;
  for (let i = 0; i <= steps; i++) {
    const a = from + ((to - from) * i) / steps;
    out.push(tip.x + Math.cos(a) * r, tip.y + Math.sin(a) * r);
  }
}

/** Trace the closed outline into a canvas path (caller fills). */
export function pathOutline(ctx: CanvasRenderingContext2D, outline: number[]) {
  ctx.beginPath();
  for (let i = 0; i < outline.length; i += 2) {
    if (i === 0) ctx.moveTo(outline[i], outline[i + 1]);
    else ctx.lineTo(outline[i], outline[i + 1]);
  }
  ctx.closePath();
}
