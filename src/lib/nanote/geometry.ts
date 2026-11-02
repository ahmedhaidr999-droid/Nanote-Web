// Geometry helpers: bounding boxes, hit-testing, lasso point-in-polygon, element transforms.
import { GRID_PITCH, PageElement, ShapeEl, ShapeType, isLineShape, StrokeEl, TextEl, ImageEl } from './types';

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
    case 'shape': return shapeElBBox(el, pad);
    case 'image': {
      // rotation-aware AABB: a rotated image's bounding box is the rotated
      // rect's extent — hit-testing, culling and the selection frame must hug
      // the VISUAL box, not the unrotated w/h (rotated images otherwise
      // grabbed/culled wrong at their corners)
      const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
      const cos = Math.abs(Math.cos(el.rotation || 0)), sin = Math.abs(Math.sin(el.rotation || 0));
      const hw = Math.abs(el.w) / 2, hh = Math.abs(el.h) / 2;
      const ex = hw * cos + hh * sin, ey = hw * sin + hh * cos;
      return { x0: cx - ex - pad, y0: cy - ey - pad, x1: cx + ex + pad, y1: cy + ey + pad };
    }
  }
}

/** point → image-local coordinates (undo rotation about the image center) */
export function imageLocalPoint(el: ImageEl, x: number, y: number): { x: number; y: number } {
  const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
  if (!el.rotation) return { x: x - cx, y: y - cy };
  const cos = Math.cos(-el.rotation), sin = Math.sin(-el.rotation);
  const dx = x - cx, dy = y - cy;
  return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
}

/** does a world point lie inside a (possibly rotated) image element? */
export function pointInImage(el: ImageEl, x: number, y: number, slack = 0): boolean {
  const p = imageLocalPoint(el, x, y);
  const hw = Math.abs(el.w) / 2 + slack, hh = Math.abs(el.h) / 2 + slack;
  return p.x >= -hw && p.x <= hw && p.y >= -hh && p.y <= hh;
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

/**
 * fraction of a box element's area covered by the lasso polygon.
 * 16×16 grid sampling: a fine enough resolution that a true 55% sweep
 * measures as 56% (the old 8×8 grid quantized it down to exactly 50%,
 * which the strict >50% rule then rejected).
 */
function boxCoverageInPoly(b: BBox, poly: { x: number; y: number }[], n = 16): number {
  let inside = 0;
  const total = n * n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = b.x0 + ((i + 0.5) / n) * (b.x1 - b.x0);
      const y = b.y0 + ((j + 0.5) / n) * (b.y1 - b.y0);
      if (pointInPolygon(x, y, poly)) inside++;
    }
  }
  return inside / total;
}

/**
 * Is an element mostly inside the lasso polygon?
 * Images: >50% of the (sampled) area covered — a lasso that sweeps
 * over more than half the image grabs the whole thing (user-requested
 * threshold, Notewise-style). Strokes keep ≥60% of their samples.
 */
export function elementInLasso(el: PageElement, poly: { x: number; y: number }[]): boolean {
  if (poly.length < 3) return false;
  if (el.kind === 'stroke') {
    const samples = sampleStrokePoints(el);
    let hits = 0;
    for (const s of samples) if (pointInPolygon(s.x, s.y, poly)) hits++;
    return samples.length > 0 && hits / samples.length >= 0.6;
  }
  if (el.kind === 'image') {
    const b = elementBBox(el, 4);
    return boxCoverageInPoly(b, poly) > 0.5;
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

/**
 * Top-most element whose visual bounds contain the point (for long-press
 * "grab & move"). Elements are examined in descending z; strokes hit within
 * half their width (plus a slack for fat fingers).
 */
export function elementAtPoint(
  els: PageElement[],
  x: number,
  y: number,
  slack = 10,
): PageElement | null {
  const sorted = [...els].sort((a, b) => b.z - a.z);
  for (const el of sorted) {
    if (el.kind === 'stroke') {
      if (distToStroke(el, x, y) <= el.width / 2 + slack) return el;
    } else if (el.kind === 'image') {
      if (pointInImage(el, x, y, slack)) return el;
    } else {
      const b = el.kind === 'text' ? measuredTextBox(el) : elementBBox(el, 2);
      if (x >= b.x0 - slack && x <= b.x1 + slack && y >= b.y0 - slack && y <= b.y1 + slack) return el;
    }
  }
  return null;
}

export function strokeIntersectsCircle(s: StrokeEl, cx: number, cy: number, r: number): boolean {
  const b = strokeBBox(s, r);
  if (cx < b.x0 || cx > b.x1 || cy < b.y0 || cy > b.y1) return false;
  return distToStroke(s, cx, cy) <= r;
}

export function elementIntersectsCircle(el: PageElement, cx: number, cy: number, r: number): boolean {
  if (el.kind === 'stroke') return strokeIntersectsCircle(el, cx, cy, r);
  if (el.kind === 'image' && el.rotation) {
    // rotated image: test in the image's local frame (the AABB would grab
    // empty corners of the rotated box)
    const p = imageLocalPoint(el, cx, cy);
    const hw = Math.abs(el.w) / 2, hh = Math.abs(el.h) / 2;
    const dx = Math.max(0, Math.abs(p.x) - hw), dy = Math.max(0, Math.abs(p.y) - hh);
    return dx * dx + dy * dy <= r * r;
  }
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

/** shared offscreen context for measuring text bounds */
let measureCtx: CanvasRenderingContext2D | null = null;
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (!measureCtx) {
    try {
      const c = document.createElement('canvas');
      c.width = 8; c.height = 8;
      measureCtx = c.getContext('2d');
    } catch { measureCtx = null }
  }
  return measureCtx;
}

const TEXT_FONT_STACKS: Record<string, string> = {
  sans: 'system-ui, sans-serif',
  arabic: "'Noto Sans Arabic', Tahoma, sans-serif",
  serif: 'Georgia, serif',
  mono: 'monospace',
  rounded: "'Trebuchet MS', sans-serif",
  typewriter: "'Courier New', monospace",
};

/** measured (not estimated) bounds of a text element */
export function measuredTextBox(el: TextEl): BBox {
  const ctx = getMeasureCtx();
  const lines = el.text.split('\n');
  if (!ctx || !el.text.trim()) {
    const h = (lines.length || 1) * el.size * 1.35;
    return { x0: el.x, y0: el.y, x1: el.x + el.w, y1: el.y + h };
  }
  const stack = TEXT_FONT_STACKS[el.fontId] ?? 'system-ui, sans-serif';
  ctx.font = `${el.italic ? 'italic ' : ''}${el.bold ? '700' : '400'} ${el.size}px ${stack}`;
  let w = 0;
  for (const ln of lines) w = Math.max(w, ctx.measureText(ln || ' ').width);
  const h = lines.length * el.size * 1.35;
  return { x0: el.x, y0: el.y, x1: el.x + Math.min(Math.max(w, el.size * 0.4), Math.max(el.w, w)), y1: el.y + h };
}

/** accurate bbox for any element — text measured, not estimated */
export function elementBBoxAccurate(el: PageElement, pad = 0): BBox {
  if (el.kind === 'text') {
    const b = measuredTextBox(el);
    return { x0: b.x0 - pad, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad };
  }
  return elementBBox(el, pad);
}

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
    // uniform scale keeps text readable and its box true to the glyphs
    const u = (Math.abs(sx) + Math.abs(sy)) / 2;
    return {
      ...el,
      x: ox + (el.x - ox) * sx + dx,
      y: oy + (el.y - oy) * sy + dy,
      w: el.w * u,
      size: el.size * u,
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

// ---------------------------------------------------------------- image corner resize
/**
 * Corner-anchored image resize that is EXACT under rotation and stays inside
 * sane bounds — the fix for "resizing moves the image randomly":
 *   • the OPPOSITE corner stays glued to the screen while you drag (the old
 *     AABB-scaling moved the image's center whenever it was rotated, so it
 *     visibly swam off);
 *   • the pointer vector is measured in the IMAGE's rotated frame, so the
 *     dragged corner follows the finger precisely at any rotation;
 *   • aspect ratio is LOCKED by default (the visible content never re-crops
 *     itself mid-drag — cover-fit stays stable); `free` (Shift) unlocks;
 *   • size clamps: sides never collapse below `minSide` world units and
 *     never explode beyond `maxSide` (the "default resize bounds").
 */
export function resizeImageCorner(
  el: ImageEl,
  corner: 'nw' | 'ne' | 'sw' | 'se',
  p: { x: number; y: number },       // world pointer
  opts: { free?: boolean; minSide?: number; maxSide?: number } = {},
): ImageEl {
  const min = opts.minSide ?? 12;
  const max = opts.maxSide ?? 4096;
  const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
  const w0 = Math.max(1, Math.abs(el.w)), h0 = Math.max(1, Math.abs(el.h));
  // signs: which way the dragged corner points from the center, in local axes
  const sx = corner === 'nw' || corner === 'sw' ? -1 : 1;
  const sy = corner === 'nw' || corner === 'ne' ? -1 : 1;
  // opposite corner = the anchor, fixed in world space
  const cos = Math.cos(el.rotation || 0), sin = Math.sin(el.rotation || 0);
  const ax = cx - (sx * w0 / 2) * cos + (sy * h0 / 2) * sin;
  const ay = cy - (sx * w0 / 2) * sin - (sy * h0 / 2) * cos;
  // pointer vector from the anchor, rotated into the image's local frame
  const vx = p.x - ax, vy = p.y - ay;
  const lx = vx * cos + vy * sin;   // R(-θ)·v
  const ly = -vx * sin + vy * cos;
  // The dragged corner sits at local (sx·w'/2, sy·h'/2) from the anchor.
  // Project the pointer onto the drag DIRECTION and clamp at 0: once the
  // pointer crosses the anchored corner, |lx| would start GROWING again on
  // the far side — the image flipped over and exploded to its max size in a
  // couple of frames ("suddenly grows fast and disappears"). Clamping the
  // directional projection means the shrink bottoms out smoothly at `min`
  // and can never flip or run away.
  const dxDir = Math.max(0, lx * sx);
  const dyDir = Math.max(0, ly * sy);
  let w1 = dxDir, h1 = dyDir;
  if (!opts.free) {
    // aspect lock: follow the dominant axis, clamped to the bounds
    const sw = Math.min(max / w0, Math.max(min / w0, w1 / w0));
    const sh = Math.min(max / h0, Math.max(min / h0, h1 / h0));
    const s = dxDir / w0 > dyDir / h0 ? sw : sh;
    w1 = w0 * s; h1 = h0 * s;
  } else {
    w1 = Math.min(max, Math.max(min, w1));
    h1 = Math.min(max, Math.max(min, h1));
  }
  // new center: anchor + local offset (sx·w'/2, sy·h'/2) rotated back to world
  const ox = sx * w1 / 2, oy = sy * h1 / 2;
  const ncx = ax + ox * cos - oy * sin;
  const ncy = ay + ox * sin + oy * cos;
  return { ...el, x: ncx - w1 / 2, y: ncy - h1 / 2, w: w1, h: h1 };
}

// ---------------------------------------------------------------- shapes
/** minimal spec every shape consumer passes to shapePath — matches the
 *  geometry subset of ShapeEl (works for live previews too). */
export interface ShapeSpecLike {
  shape: ShapeType;
  x: number; y: number; w: number; h: number;
  sides?: number;
  pts?: { x: number; y: number }[];
  closed?: boolean;
}

/** local (unrotated) extents of a shape — arc bulges past its frame, the rest
 *  stay inside the frame box (a safe superset for hit-testing/culling). */
export function shapeLocalBBox(s: ShapeSpecLike): BBox {
  if (isLineShape(s.shape)) {
    return { x0: Math.min(s.x, s.x + s.w), y0: Math.min(s.y, s.y + s.h), x1: Math.max(s.x, s.x + s.w), y1: Math.max(s.y, s.y + s.h) };
  }
  if (s.shape === 'arc') {
    // half-ellipse inscribed in the frame: chord on the midline, apex on the
    // bulge side (h ≥ 0 bulges up, h < 0 bulges down)
    const rx = Math.abs(s.w) / 2, ry = Math.abs(s.h) / 2;
    const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
    const apexY = s.h >= 0 ? cy - ry : cy + ry;
    return { x0: cx - rx, y0: Math.min(cy, apexY), x1: cx + rx, y1: Math.max(cy, apexY) };
  }
  return { x0: Math.min(s.x, s.x + s.w), y0: Math.min(s.y, s.y + s.h), x1: Math.max(s.x, s.x + s.w), y1: Math.max(s.y, s.y + s.h) };
}

/** rotation-aware AABB of a shape element (rotated corners → union) */
function shapeElBBox(el: ShapeEl, pad: number): BBox {
  const b = shapeLocalBBox(el);
  const rot = el.rotation || 0;
  if (!rot) return { x0: b.x0 - pad, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad };
  const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const pts = [
    { x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 },
  ].map((p) => ({
    x: cx + (p.x - cx) * cos - (p.y - cy) * sin,
    y: cy + (p.x - cx) * sin + (p.y - cy) * cos,
  }));
  return {
    x0: Math.min(...pts.map((p) => p.x)) - pad,
    y0: Math.min(...pts.map((p) => p.y)) - pad,
    x1: Math.max(...pts.map((p) => p.x)) + pad,
    y1: Math.max(...pts.map((p) => p.y)) + pad,
  };
}

/** draw any supported shape into a 2D context (local coordinates — apply
 *  rotation about the element center in the caller when needed). */
export function shapePath(ctx: CanvasRenderingContext2D, s: ShapeSpecLike) {
  const { shape } = s;
  ctx.beginPath();
  switch (shape) {
    case 'line':
      ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + s.w, s.y + s.h);
      break;
    case 'arrow':
      arrowHeadPath(ctx, s.x, s.y, s.x + s.w, s.y + s.h);
      ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + s.w, s.y + s.h);
      break;
    case 'darrow': {
      arrowHeadPath(ctx, s.x, s.y, s.x + s.w, s.y + s.h);
      // head at the START: tip (x,y), barbs reaching INTO the body (toward the end)
      arrowHeadPath(ctx, s.x + s.w, s.y + s.h, s.x, s.y);
      ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + s.w, s.y + s.h);
      break;
    }
    case 'arc': {
      // half-ellipse inscribed in the frame; chord on the midline. h ≥ 0 →
      // bulge up (hill), h < 0 → bulge down (valley)
      const rx = Math.abs(s.w) / 2, ry = Math.abs(s.h) / 2;
      if (rx < 0.5 || ry < 0.5) {
        ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + s.w, s.y + s.h);
        break;
      }
      const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
      if (s.h >= 0) ctx.ellipse(cx, cy, rx, ry, 0, Math.PI, Math.PI * 2);
      else ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI);
      break;
    }
    case 'rect':
      ctx.rect(s.x, s.y, s.w, s.h);
      break;
    case 'rrect': {
      const r = Math.min(Math.abs(s.w), Math.abs(s.h)) * 0.18;
      ctx.roundRect(s.x, s.y, s.w, s.h, r);
      break;
    }
    case 'ellipse':
      ctx.ellipse(s.x + s.w / 2, s.y + s.h / 2, Math.abs(s.w) / 2, Math.abs(s.h) / 2, 0, 0, Math.PI * 2);
      break;
    case 'triangle': {
      const x0 = Math.min(s.x, s.x + s.w), x1 = Math.max(s.x, s.x + s.w);
      const y0 = Math.min(s.y, s.y + s.h), y1 = Math.max(s.y, s.y + s.h);
      ctx.moveTo(x0 + (x1 - x0) / 2, y0);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x0, y1);
      ctx.closePath();
      break;
    }
    case 'star': {
      const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
      const R = Math.min(Math.abs(s.w), Math.abs(s.h)) / 2;
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
    case 'hexagon': {
      // flat-top regular hexagon inscribed in the frame
      const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
      const R = Math.min(Math.abs(s.w) / 2, Math.abs(s.h) / Math.sqrt(3));
      for (let i = 0; i < 6; i++) {
        const ang = (i * Math.PI) / 3;
        const px = cx + Math.cos(ang) * R, py = cy + Math.sin(ang) * R;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
    case 'polygon': {
      // regular n-gon, first vertex at the top
      const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
      const R = Math.min(Math.abs(s.w), Math.abs(s.h)) / 2;
      const n = Math.max(3, Math.min(12, Math.round(s.sides ?? 5)));
      for (let i = 0; i < n; i++) {
        const ang = -Math.PI / 2 + (i * Math.PI * 2) / n;
        const px = cx + Math.cos(ang) * R, py = cy + Math.sin(ang) * R;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
    case 'freeform': {
      const pts = s.pts ?? [];
      if (pts.length < 2) break;
      for (let i = 0; i < pts.length; i++) {
        const px = s.x + pts[i].x * s.w;
        const py = s.y + pts[i].y * s.h;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      if (s.closed !== false) ctx.closePath();
      break;
    }
  }
}

/** V arrowhead at the tip (tx,ty) whose body direction runs a→b */
function arrowHeadPath(ctx: CanvasRenderingContext2D, ax: number, ay: number, tx: number, ty: number) {
  const ang = Math.atan2(ty - ay, tx - ax);
  const len = Math.hypot(tx - ax, ty - ay);
  const hl = Math.min(22, Math.max(8, len * 0.18));
  ctx.moveTo(tx, ty);
  ctx.lineTo(tx - Math.cos(ang - Math.PI / 7) * hl, ty - Math.sin(ang - Math.PI / 7) * hl);
  ctx.moveTo(tx, ty);
  ctx.lineTo(tx - Math.cos(ang + Math.PI / 7) * hl, ty - Math.sin(ang + Math.PI / 7) * hl);
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

// ---------------------------------------------------------------- snapping
/** snap one scalar to the paper grid */
export function snapToGrid(v: number, pitch = GRID_PITCH): number {
  return Math.round(v / pitch) * pitch;
}

/** alignment candidate lines gathered from existing elements (for smart
 *  snapping while drawing/moving): x- and y-positions of edges + centers. */
export interface SnapLines { xs: number[]; ys: number[] }

export function collectSnapLines(els: PageElement[], pageId?: string, excludeIds?: Set<string>): SnapLines {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const el of els) {
    if (excludeIds?.has(el.id)) continue;
    const b = elementBBoxAccurate(el, 0);
    xs.push(b.x0, b.x1, (b.x0 + b.x1) / 2);
    ys.push(b.y0, b.y1, (b.y0 + b.y1) / 2);
  }
  void pageId;
  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  return { xs, ys };
}

export interface SmartSnap { bx: number; by: number; guides: { axis: 'x' | 'y'; at: number }[] }

/** nearest snap line within `tol` of the point, per axis (binary search). */
export function smartSnapPoint(lines: SnapLines, bx: number, by: number, tol: number): SmartSnap {
  const guides: { axis: 'x' | 'y'; at: number }[] = [];
  let sx = bx, sy = by;
  const nearest = (arr: number[], v: number): number | null => {
    if (!arr.length) return null;
    let lo = 0, hi = arr.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] < v) lo = mid + 1; else hi = mid;
    }
    let best = arr[lo];
    if (lo > 0 && Math.abs(arr[lo - 1] - v) < Math.abs(best - v)) best = arr[lo - 1];
    return Math.abs(best - v) <= tol ? best : null;
  };
  const nx = nearest(lines.xs, bx);
  if (nx != null) { sx = nx; guides.push({ axis: 'x', at: nx }) }
  const ny = nearest(lines.ys, by);
  if (ny != null) { sy = ny; guides.push({ axis: 'y', at: ny }) }
  return { bx: sx, by: sy, guides };
}

// ---------------------------------------------------------------- grouping
/** expand a selection id list to include every element that shares a group
 *  with any selected element (groups move & select as one). */
export function expandIdsByGroup(els: PageElement[], ids: string[]): string[] {
  const sel = new Set(ids);
  const groups = new Set<string>();
  for (const el of els) {
    const gid = (el as { groupId?: string }).groupId;
    if (gid && sel.has(el.id)) groups.add(gid);
  }
  if (!groups.size) return ids.slice();
  const out = new Set(ids);
  for (const el of els) {
    const gid = (el as { groupId?: string }).groupId;
    if (gid && groups.has(gid)) out.add(el.id);
  }
  return [...out];
}

// ---------------------------------------------------------------- polyline simplification
/** Ramer–Douglas–Peucker point simplification (iterative, epsilon in the same
 *  units as the points). Used by shape recognition to extract polygon vertices. */
export function rdpSimplify(pts: { x: number; y: number }[], eps: number): { x: number; y: number }[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop()!;
    if (i1 - i0 < 2) continue;
    const a = pts[i0], b = pts[i1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    let worst = -1, worstD = 0;
    for (let i = i0 + 1; i < i1; i++) {
      const d = len < 1e-9
        ? Math.hypot(pts[i].x - a.x, pts[i].y - a.y)
        : Math.abs((pts[i].x - a.x) * dy - (pts[i].y - a.y) * dx) / len;
      if (d > worstD) { worstD = d; worst = i }
    }
    if (worst >= 0 && worstD > eps) {
      keep[worst] = 1;
      stack.push([i0, worst], [worst, i1]);
    }
  }
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push({ x: pts[i].x, y: pts[i].y });
  return out;
}

export type { ShapeEl, TextEl, ImageEl };
