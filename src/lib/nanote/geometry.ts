// Geometry helpers: bounding boxes, hit-testing, lasso point-in-polygon, element transforms.
import { PageElement, ShapeEl, ShapeType, StrokeEl, TextEl, ImageEl } from './types';

export interface BBox { x0: number; y0: number; x1: number; y1: number }

export function strokeBBox(s: StrokeEl, pad = 0): BBox {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of s.points) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  if (!s.points.length) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  const hw = s.width / 2 + pad;
  return { x0: x0 - hw, y0: y0 - hw, x1: x1 + hw, y1: y1 + hw };
}

export function elementBBox(el: PageElement, pad = 0): BBox {
  switch (el.kind) {
    case 'stroke': return strokeBBox(el, pad);
    case 'text': {
      // approximate: measured heights are resolved at render; use size-based estimate
      const lines = el.text.split('\n').length || 1;
      const h = lines * el.size * 1.35;
      return { x0: el.x - pad, y0: el.y - pad, x1: el.x + el.w + pad, y1: el.y + h + pad };
    }
    case 'shape': {
      const x0 = Math.min(el.x, el.x + el.w), x1 = Math.max(el.x, el.x + el.w);
      const y0 = Math.min(el.y, el.y + el.h), y1 = Math.max(el.y, el.y + el.h);
      return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
    }
    case 'image': {
      const x0 = Math.min(el.x, el.x + el.w), x1 = Math.max(el.x, el.x + el.w);
      const y0 = Math.min(el.y, el.y + el.h), y1 = Math.max(el.y, el.y + el.h);
      return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
    }
  }
}

export function unionBBox(boxes: BBox[]): BBox | null {
  if (!boxes.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0);
    x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1);
  }
  return { x0, y0, x1, y1 };
}

export const bboxW = (b: BBox) => b.x1 - b.x0;
export const bboxH = (b: BBox) => b.y1 - b.y0;

// ---------------------------------------------------------------- hit-testing
function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function distToStroke(s: StrokeEl, x: number, y: number): number {
  let best = Infinity;
  const pts = s.points;
  for (let i = 1; i < pts.length; i++) {
    const d = distToSegment(x, y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
    if (d < best) best = d;
  }
  if (pts.length === 1) best = Math.hypot(x - pts[0].x, y - pts[0].y);
  return best;
}

/** point-in-polygon (even-odd ray cast) */
export function pointInPolygon(x: number, y: number, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function sampleStrokePoints(s: StrokeEl, step = 12): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const pts = s.points;
  if (!pts.length) return out;
  let carried = 0;
  out.push({ x: pts[0].x, y: pts[0].y });
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    carried += d;
    if (carried >= step) { out.push({ x: b.x, y: b.y }); carried = 0 }
  }
  out.push({ x: pts[pts.length - 1].x, y: pts[pts.length - 1].y });
  return out;
}

/** Is an element mostly inside the lasso polygon (>=60% of samples)? */
export function elementInLasso(el: PageElement, poly: { x: number; y: number }[]): boolean {
  if (poly.length < 3) return false;
  if (el.kind === 'stroke') {
    const samples = sampleStrokePoints(el);
    let hits = 0;
    for (const s of samples) if (pointInPolygon(s.x, s.y, poly)) hits++;
    return samples.length > 0 && hits / samples.length >= 0.6;
  }
  const b = elementBBox(el, 4);
  const probes = [
    { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 },
    { x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x0, y: b.y1 }, { x: b.x1, y: b.y1 },
  ];
  let hits = 0;
  for (const pr of probes) if (pointInPolygon(pr.x, pr.y, poly)) hits++;
  return hits / probes.length >= 0.6;
}

export function strokeIntersectsCircle(s: StrokeEl, cx: number, cy: number, r: number): boolean {
  const b = strokeBBox(s, r);
  if (cx < b.x0 || cx > b.x1 || cy < b.y0 || cy > b.y1) return false;
  return distToStroke(s, cx, cy) <= r;
}

export function elementIntersectsCircle(el: PageElement, cx: number, cy: number, r: number): boolean {
  if (el.kind === 'stroke') return strokeIntersectsCircle(el, cx, cy, r);
  const b = elementBBox(el, r);
  return cx >= b.x0 && cx <= b.x1 && cy >= b.y0 && cy <= b.y1;
}

/** Area eraser: stroke passes through the eraser disc along its path. */
export function strokeErasedByArea(s: StrokeEl, path: { x: number; y: number }[], r: number): boolean {
  const b = strokeBBox(s, r);
  for (const q of path) {
    if (q.x < b.x0 || q.x > b.x1 || q.y < b.y0 || q.y > b.y1) continue;
    if (distToStroke(s, q.x, q.y) <= r) return true;
  }
  return false;
}

// ---------------------------------------------------------------- transforms
export interface Transform { dx?: number; dy?: number; sx?: number; sy?: number; ox?: number; oy?: number }

export function transformElement<T extends PageElement>(el: T, tr: Transform): T {
  const dx = tr.dx ?? 0, dy = tr.dy ?? 0;
  const sx = tr.sx ?? 1, sy = tr.sy ?? 1;
  const ox = tr.ox ?? 0, oy = tr.oy ?? 0;
  if (el.kind === 'stroke') {
    const points = el.points.map((p) => ({
      x: ox + (p.x - ox) * sx + dx,
      y: oy + (p.y - oy) * sy + dy,
      p: p.p, t: p.t,
    }));
    return { ...el, points, width: el.width * ((sx + sy) / 2) };
  }
  if (el.kind === 'text') {
    return {
      ...el,
      x: ox + (el.x - ox) * sx + dx,
      y: oy + (el.y - oy) * sy + dy,
      w: el.w * sx,
      size: el.size * ((sx + sy) / 2),
    };
  }
  if (el.kind === 'shape' || el.kind === 'image') {
    return {
      ...el,
      x: ox + (el.x - ox) * sx + dx,
      y: oy + (el.y - oy) * sy + dy,
      w: el.w * sx,
      h: el.h * sy,
    } as T;
  }
  return { ...el } as T;
}

export function moveElement<T extends PageElement>(el: T, dx: number, dy: number): T {
  return transformElement(el, { dx, dy });
}

// ---------------------------------------------------------------- shapes
export function shapePath(ctx: CanvasRenderingContext2D, shape: ShapeType, x: number, y: number, w: number, h: number) {
  ctx.beginPath();
  switch (shape) {
    case 'line':
      ctx.moveTo(x, y); ctx.lineTo(x + w, y + h);
      break;
    case 'arrow': {
      ctx.moveTo(x, y); ctx.lineTo(x + w, y + h);
      const ang = Math.atan2(h, w);
      const len = Math.hypot(w, h);
      const hl = Math.min(22, Math.max(8, len * 0.18));
      const bx = x + w, by = y + h;
      ctx.moveTo(bx, by);
      ctx.lineTo(bx - Math.cos(ang - Math.PI / 7) * hl, by - Math.sin(ang - Math.PI / 7) * hl);
      ctx.moveTo(bx, by);
      ctx.lineTo(bx - Math.cos(ang + Math.PI / 7) * hl, by - Math.sin(ang + Math.PI / 7) * hl);
      break;
    }
    case 'rect':
      ctx.rect(x, y, w, h);
      break;
    case 'rrect': {
      const r = Math.min(Math.abs(w), Math.abs(h)) * 0.18;
      ctx.roundRect(x, y, w, h, r);
      break;
    }
    case 'ellipse':
      ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w) / 2, Math.abs(h) / 2, 0, 0, Math.PI * 2);
      break;
    case 'triangle': {
      const x0 = Math.min(x, x + w), x1 = Math.max(x, x + w);
      const y0 = Math.min(y, y + h), y1 = Math.max(y, y + h);
      ctx.moveTo(x0 + (x1 - x0) / 2, y0);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x0, y1);
      ctx.closePath();
      break;
    }
    case 'star': {
      const cx = x + w / 2, cy = y + h / 2;
      const R = Math.min(Math.abs(w), Math.abs(h)) / 2;
      const r = R * 0.45;
      for (let i = 0; i < 10; i++) {
        const ang = -Math.PI / 2 + (i * Math.PI) / 5;
        const rad = i % 2 === 0 ? R : r;
        const px = cx + Math.cos(ang) * rad, py = cy + Math.sin(ang) * rad;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
  }
}

/** Snap a drag point to 0/45/90° increments around an anchor. */
export function snapAngle(ax: number, ay: number, bx: number, by: number, thresholdDeg = 6): { x: number; y: number } {
  const ang = Math.atan2(by - ay, bx - ax);
  const step = Math.PI / 4;
  const snapped = Math.round(ang / step) * step;
  const delta = Math.abs(ang - snapped);
  if (delta < (thresholdDeg * Math.PI) / 180) {
    const len = Math.hypot(bx - ax, by - ay);
    return { x: ax + Math.cos(snapped) * len, y: ay + Math.sin(snapped) * len };
  }
  return { x: bx, y: by };
}

export type { ShapeEl, TextEl, ImageEl };
