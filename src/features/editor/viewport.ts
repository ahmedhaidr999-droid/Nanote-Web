'use client';
// Editor viewport — zoom/pan model (50%–800%), page layout math, transient
// repaint bus, ruler state. Kept outside React state for 60fps gestures.
//
// Modern-reader discipline (Xodo/GoodNotes/Notability semantics):
//   • whenever a page fits the viewport width it is HARD-CENTERED — no amount
//     of diagonal swiping can leave it drifted left/right;
//   • zoomed in, panning is free inside tight bounds with a small pad;
//   • page jumps (filmstrip / outline / add-page) glide with a distance-
//     adaptive eased animation instead of teleporting;
//   • a gesture guard lets the input surface own bounds math while a drag /
//     momentum / rubber-band settle is in flight (the global clamp stands down
//     so elastic overscroll is possible), then the clamp re-asserts.
import { useSyncExternalStore } from 'react';
import { INFINITE_MAX_ZOOM, INFINITE_MIN_ZOOM, MAX_ZOOM, MIN_ZOOM } from '@/lib/nanote/types';

export interface Vp { scale: number; tx: number; ty: number }

export const PAGE_GAP = 28;
export const VIEWPORT_PAD = 56;
/** content within this many px of the container counts as "fits" → centered */
export const FIT_SLACK = 24;

let state: Vp = { scale: 1, tx: 40, ty: 24 };
let raf = 0;
const listeners = new Set<() => void>();

/** container size, registered by the editor shell (used by scrollToPage etc.) */
let containerSize = { w: 800, h: 600 };

function notify() {
  if (raf) return;
  // While the app is hidden (Android background) rAFs pause — but background
  // flushes and session-restore need the ACTIVE PAGE to be current the
  // moment the process may be killed. Fan out synchronously when hidden;
  // batch to the next paint when visible (no paints happen while hidden, so
  // a scheduled rAF could linger and block every later notify).
  if (typeof document !== 'undefined' && document.hidden) {
    for (const l of listeners) l();
    return;
  }
  raf = requestAnimationFrame(() => {
    raf = 0;
    for (const l of listeners) l();
  });
}

export function getVp(): Vp { return state }

export function setVp(patch: Partial<Vp>) {
  state = { ...state, ...patch };
  lastVpChange = performance.now();
  scheduleIdleCheck();
  notify();
}

export function subscribeVp(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn) };
}

export function useVp(): Vp {
  return useSyncExternalStore(subscribeVp, getVp, getVp);
}

export const clampScale = (s: number) => Math.min(zoomMax, Math.max(zoomMin, s));

export function getViewportSize() { return containerSize }
export function setViewportSize(w: number, h: number) { containerSize = { w, h } }

// ---------------------------------------------------------------- contextual zoom range
// regular notebooks 50–800%; infinity paper gets a Concepts-style near-
// unbounded 8%–2400% range.
let zoomMin = MIN_ZOOM;
let zoomMax = MAX_ZOOM;
export function setZoomRange(min: number, max: number) {
  zoomMin = Math.min(min, max);
  zoomMax = Math.max(min, max);
  const s1 = Math.min(zoomMax, Math.max(zoomMin, state.scale));
  if (s1 !== state.scale) setVp({ scale: s1 });
}
export function setZoomRangeFor(infinite: boolean) {
  setZoomRange(infinite ? INFINITE_MIN_ZOOM : MIN_ZOOM, infinite ? INFINITE_MAX_ZOOM : MAX_ZOOM);
}

/** the visible slice of the world (page-windowed rendering + culling) */
export function visibleWorldRect(): { x0: number; y0: number; x1: number; y1: number } {
  const { scale, tx, ty } = state;
  const { w, h } = containerSize;
  return {
    x0: (0 - tx) / scale,
    y0: (0 - ty) / scale,
    x1: (w - tx) / scale,
    y1: (h - ty) / scale,
  };
}

/** zoom keeping the screen point (sx, sy) fixed */
export function zoomAt(sx: number, sy: number, factor: number) {
  const s0 = state.scale;
  const s1 = clampScale(s0 * factor);
  if (s1 === s0) return;
  const wx = (sx - state.tx) / s0;
  const wy = (sy - state.ty) / s0;
  setVp({ scale: s1, tx: sx - wx * s1, ty: sy - wy * s1 });
}

// ---------------------------------------------------------------- gesture guard
// While an input gesture (drag / momentum / overscroll settle) owns the
// viewport, the global clamp stands down — the gesture applies its own bounds
// math, including elastic overscroll beyond the clamp limits.
let gestureDepth = 0;

export function beginVpGesture() { gestureDepth++ }
/** release the guard (single owner ⇒ force-clear is safe and leak-proof) */
export function endVpGesture() { gestureDepth = 0 }
export function isVpGestureActive() { return gestureDepth > 0 }

// ---------------------------------------------------------------- smooth animations
// One shared rAF slot for every viewport animation (zoom, pan, jumps, settle).
// Starting one cancels any in flight; `vpAnimGen` lets foreign loops (touch
// momentum in InkSurface) detect that a new animation took over and abort.
let vpAnimRaf = 0;
let animGen = 0;

export function vpAnimGen() { return animGen }

const easeOutCubic = (k: number) => 1 - Math.pow(1 - k, 3);

export function cancelVpAnims() {
  if (vpAnimRaf) { cancelAnimationFrame(vpAnimRaf); vpAnimRaf = 0 }
}

/** Smoothly animate scale/tx/ty toward the given target (undefined keys held). */
export function animateVpTo(
  target: Partial<Vp>,
  dur = 240,
  ease: (k: number) => number = easeOutCubic,
  onDone?: () => void,
) {
  cancelVpAnims();
  animGen++;
  const from = { ...state };
  const keys = (['scale', 'tx', 'ty'] as const).filter((k) => target[k] !== undefined);
  const moving = keys.some((k) => Math.abs((target[k] ?? 0) - from[k]) > 0.01);
  if (!moving) { onDone?.(); return }
  const t0 = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / dur);
    const e = ease(k);
    const patch: Partial<Vp> = {};
    for (const key of keys) patch[key] = from[key] + ((target[key]! - from[key]) * e);
    setVp(patch);
    vpAnimRaf = k < 1 ? requestAnimationFrame(step) : 0;
    if (k >= 1) onDone?.();
  };
  vpAnimRaf = requestAnimationFrame(step);
}

/** Smoothly animate to an absolute zoom, keeping (sx, sy) pinned. */
export function animateZoomTo(sx: number, sy: number, targetScale: number, dur = 200) {
  cancelVpAnims();
  animGen++;
  const s0 = state.scale;
  const s1 = clampScale(targetScale);
  if (Math.abs(s1 - s0) < 0.0005) return;
  const t0 = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / dur);
    const eased = easeOutCubic(k); // decisive start, soft landing
    const s = s0 + (s1 - s0) * eased;
    zoomAt(sx, sy, s / state.scale);
    vpAnimRaf = k < 1 ? requestAnimationFrame(step) : 0;
  };
  vpAnimRaf = requestAnimationFrame(step);
}

/** legacy alias — InkSurface calls this on every pointerdown */
export function cancelZoomAnim() { cancelVpAnims() }
export function cancelPanAnim() { cancelVpAnims() }

export function panBy(dx: number, dy: number) {
  setVp({ tx: state.tx + dx, ty: state.ty + dy });
}

export function screenToWorld(sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - state.tx) / state.scale, y: (sy - state.ty) / state.scale };
}

export function worldToScreen(wx: number, wy: number): { x: number; y: number } {
  return { x: wx * state.scale + state.tx, y: wy * state.scale + state.ty };
}

// ---------------------------------------------------------------- clamping
/** axis bounds for the current zoom: centered when content fits, padded pan otherwise */
export function axisBounds(content: number, container: number, pad = VIEWPORT_PAD) {
  if (content <= container + FIT_SLACK) {
    const c = (container - content) / 2;
    return { lock: true, min: c, max: c };
  }
  return { lock: false, min: container - content - pad, max: pad };
}

/**
 * Clamp the viewport to the world. Whenever a page fits the width it is
 * re-centered EXACTLY — the "pages drift left/right while flipping" bug is
 * impossible by construction. Stands down while a gesture owns the viewport.
 *
 * Infinity paper: the content rect may extend into negative quadrants
 * (worldX0/worldY0 ≤ 0 — the sheet grows up/left via pads); panning roams
 * freely ~1.5 screens beyond the content on every side, and nothing ever
 * hard-locks (the endless sheet is never "fully visible").
 */
export function clampVpToWorld(containerW: number, containerH: number, worldW: number, worldH: number, infinite = false, worldX0 = 0, worldY0 = 0) {
  if (gestureDepth > 0) return;
  const { scale } = state;
  const roam = infinite ? Math.max(containerW, containerH) * 1.5 : 0;
  const bounds = (content: number, container: number, pad: number) => {
    if (!infinite && content <= container + FIT_SLACK) {
      const c = (container - content) / 2;
      return { min: c, max: c };
    }
    const min = Math.min(container - content - pad, pad) - roam;
    const max = Math.max(pad, container - content + pad * 4) + roam;
    return { min, max };
  };
  // content-local translation (the content origin may sit at negative world coords)
  const tx0 = state.tx + worldX0 * scale;
  const ty0 = state.ty + worldY0 * scale;
  const bx = bounds(worldW * scale, containerW, VIEWPORT_PAD);
  const by = bounds(worldH * scale, containerH, VIEWPORT_PAD);
  const tx = Math.min(bx.max, Math.max(bx.min, tx0)) - worldX0 * scale;
  const ty = Math.min(by.max, Math.max(by.min, ty0)) - worldY0 * scale;
  if (tx !== state.tx || ty !== state.ty) setVp({ tx, ty });
}

// ---------------------------------------------------------------- fit
export function fitScaleOf(containerW: number, worldW: number) {
  return clampScale(Math.min((containerW - 48) / worldW, 1.25));
}

export function fitWidth(containerW: number, worldW: number, worldX0 = 0, worldY0 = 0) {
  animGen++; // any in-flight touch momentum must stop when we re-fit
  const scale = fitScaleOf(containerW, worldW);
  setVp({ scale, tx: (containerW - worldW * scale) / 2 - worldX0 * scale, ty: 24 - worldY0 * scale });
}

/** animated "fit" (zoom-bar button) — glides to the fit position */
export function animatedFit(containerW: number, worldW: number, worldX0 = 0, worldY0 = 0) {
  const scale = fitScaleOf(containerW, worldW);
  animateVpTo({ scale, tx: (containerW - worldW * scale) / 2 - worldX0 * scale, ty: 24 - worldY0 * scale }, 260);
}

/** fit a world-space rect (content bounds) into the viewport, centered */
export function fitToBounds(b: { x0: number; y0: number; x1: number; y1: number }, containerW: number, containerH: number, maxScale = 1.5) {
  const bw = Math.max(1, b.x1 - b.x0);
  const bh = Math.max(1, b.y1 - b.y0);
  const scale = clampScale(Math.min((containerW - 96) / bw, (containerH - 96) / bh, maxScale));
  setVp({
    scale,
    tx: (containerW - bw * scale) / 2 - b.x0 * scale,
    ty: (containerH - bh * scale) / 2 - b.y0 * scale,
  });
}

export function resetVp(containerW: number, worldW: number) {
  fitWidth(containerW, worldW);
}

// ---------------------------------------------------------------- page layout
export interface PageLayout {
  id: string;
  y: number;      // world Y of the page's local origin (0,0)
  w: number;      // FULL padded box width (origWidth + padX)
  h: number;      // FULL padded box height (origHeight + padY)
  padX: number;   // how far the sheet extends LEFT of the origin (infinite)
  padY: number;   // how far the sheet extends ABOVE the origin (infinite)
}

export function layoutPages(pages: { id: string; height: number; width?: number | null; padX?: number | null; padY?: number | null }[], pageW: number): { layouts: PageLayout[]; worldH: number } {
  let y = 0;
  const layouts: PageLayout[] = pages.map((p) => {
    // per-page width + top/left pads (infinity paper grows in ALL directions
    // while you write: right/down via width/height, up/left via pads)
    const padX = p.padX ?? 0;
    const padY = p.padY ?? 0;
    const entry: PageLayout = { id: p.id, y, w: (p.width ?? pageW) + padX, h: p.height + padY, padX, padY };
    // the pad grows the sheet UPWARD — reserve the space so stacked boards
    // never overlap (consistent with height growth pushing later pages down)
    y += p.height + padY + PAGE_GAP;
    return entry;
  });
  return { layouts, worldH: Math.max(0, y - PAGE_GAP) };
}

/** widest page in the stack (viewport clamp / fit width) — padded widths */
export function worldWidthOf(layouts: PageLayout[], pageW: number): number {
  let w = pageW;
  for (const l of layouts) if (l.w - l.padX > w) w = l.w - l.padX;
  return w;
}

/**
 * Full world content rect (includes infinity-paper pads reaching into the
 * negative quadrants). x0/y0 are ≤ 0; x1/y1 ≥ 0. Drives viewport clamping,
 * fit-width and the minimap frame.
 */
export function worldBoundsOf(layouts: PageLayout[], pageW: number): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = 0, y0 = 0, x1 = pageW, y1 = 0;
  for (const l of layouts) {
    x0 = Math.min(x0, -l.padX);
    y0 = Math.min(y0, l.y - l.padY);
    x1 = Math.max(x1, l.w - l.padX);
    y1 = Math.max(y1, l.y - l.padY + l.h);
  }
  if (!layouts.length) y1 = 0;
  return { x0, y0, x1, y1 };
}

export function pageAtWorldY(layouts: PageLayout[], wy: number): PageLayout | null {
  for (const l of layouts) {
    const top = l.y - l.padY;
    if (wy >= top && wy <= top + l.h) return l;
  }
  return null;
}

/**
 * Glide the viewport to a page. `offset` is the fraction of the container
 * height where the page top should land (0.35 ≈ a comfortable reading spot).
 * Nearby pages get a short glide; far jumps swoosh past quickly.
 */
export function scrollToPage(layout: PageLayout, offset = 0.3) {
  const targetTy = containerSize.h * offset - (layout.y - layout.padY) * state.scale;
  const dist = Math.abs(targetTy - state.ty);
  const dur = Math.min(520, 150 + dist * 0.08);
  animateVpTo({ ty: targetTy }, dur);
}

// ---------------------------------------------------------------- repaint bus (transient visual state)
type RepaintCb = () => void;
const repaintCbs = new Set<RepaintCb>();

export function onRepaint(fn: RepaintCb) {
  repaintCbs.add(fn);
  return () => { repaintCbs.delete(fn) };
}

/** transient hidden element ids per page (eraser preview, etc.) */
const hiddenIds = new Map<string, Set<string>>();

export function getHiddenIds(pageId: string): Set<string> | undefined { return hiddenIds.get(pageId) }

export function setHiddenIds(pageId: string, ids: Set<string> | null) {
  const prev = hiddenIds.get(pageId) ?? null;
  // content-change gate: identical sets never trigger the (expensive) page
  // repaint — the eraser sweep calls this on every hit burst, and redundant
  // full-page re-rasters were the "app turns heavy" killer on Android.
  const same =
    ids && prev
      ? prev.size === ids.size && everyIn(prev, ids)
      : !ids === !prev;
  if (ids) hiddenIds.set(pageId, ids);
  else hiddenIds.delete(pageId);
  if (!same) requestRepaint();
}

function everyIn(a: Set<string>, b: Set<string>): boolean {
  for (const x of b) if (!a.has(x)) return false;
  return true;
}

// ---------------------------------------------------------------- live overlay painters + repaint channels
export type Painter = (ctx: CanvasRenderingContext2D, vp: Vp) => void;
const painters = new Set<Painter>();
const overlayCbs = new Set<() => void>();

export function addPainter(p: Painter) { painters.add(p); requestOverlayRepaint(); return () => { painters.delete(p); requestOverlayRepaint() } }
export function getPainters(): Iterable<Painter> { return painters }

export function onOverlayRepaint(fn: () => void) {
  overlayCbs.add(fn);
  return () => { overlayCbs.delete(fn) };
}

/** cheap repaint for the live overlay only (in-progress strokes, cursors) */
export function requestOverlayRepaint() {
  for (const fn of overlayCbs) fn();
}

/** repaint pages (eraser preview, selection drags) + overlay */
export function requestRepaint() {
  for (const fn of repaintCbs) fn();
  requestOverlayRepaint();
}

// ---------------------------------------------------------------- interaction tracking (zoom perf)
// While the user is actively pinching/panning/scrolling, pages must NOT
// re-raster — the existing bitmap simply CSS-scales. Re-rastering happens
// once, after the gesture settles (idle).
let lastVpChange = 0;
let interactionUntil = 0; // pointer-down / pinch window
let lastWheel = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const idleCbs = new Set<() => void>();

export function markInteraction() {
  interactionUntil = performance.now() + 120;
  scheduleIdleCheck();
}

export function markWheel() {
  lastWheel = performance.now();
  scheduleIdleCheck();
}

export function isInteracting(): boolean {
  return performance.now() < interactionUntil || performance.now() - lastWheel < 180;
}

/** fired once the viewport has been stable and untouched for ~280ms */
export function onVpIdle(fn: () => void): () => void {
  idleCbs.add(fn);
  return () => { idleCbs.delete(fn) };
}

function scheduleIdleCheck() {
  if (idleTimer) return;
  const check = () => {
    idleTimer = null;
    const now = performance.now();
    const stableFor = now - lastVpChange;
    const busy = now < interactionUntil || now - lastWheel < 220;
    if (stableFor >= 280 && !busy) {
      for (const cb of idleCbs) cb();
    } else {
      idleTimer = setTimeout(check, 120);
    }
  };
  idleTimer = setTimeout(check, 140);
}

// ---------------------------------------------------------------- ruler (world coords)
export interface RulerState { visible: boolean; cx: number; cy: number; angle: number; len: number }
export const ruler: RulerState = { visible: false, cx: 400, cy: 300, angle: 0, len: 420 };

export function rulerSegment(): { ax: number; ay: number; bx: number; by: number } {
  const dx = Math.cos(ruler.angle) * ruler.len / 2;
  const dy = Math.sin(ruler.angle) * ruler.len / 2;
  return { ax: ruler.cx - dx, ay: ruler.cy - dy, bx: ruler.cx + dx, by: ruler.cy + dy };
}

/** thickness of the ruler body in world units (screen ~44px, clamped) */
export function rulerThickness(): number {
  const s = state.scale;
  return Math.max(26 / s, Math.min(56 / s, 44));
}

/** the two edge segments (top & bottom faces) of the ruler strip */
export function rulerEdges(): { ax: number; ay: number; bx: number; by: number }[] {
  const { ax, ay, bx, by } = rulerSegment();
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  // unit normal
  const nx = -dy / len, ny = dx / len;
  const h = rulerThickness() / 2;
  return [
    { ax: ax + nx * h, ay: ay + ny * h, bx: bx + nx * h, by: by + ny * h },
    { ax: ax - nx * h, ay: ay - ny * h, bx: bx - nx * h, by: by - ny * h },
  ];
}

function projectOnSeg(wx: number, wy: number, seg: { ax: number; ay: number; bx: number; by: number }): { px: number; py: number; t: number; d: number } {
  const abx = seg.bx - seg.ax, aby = seg.by - seg.ay;
  const len2 = abx * abx + aby * aby;
  if (len2 === 0) return { px: seg.ax, py: seg.ay, t: 0, d: Math.hypot(wx - seg.ax, wy - seg.ay) };
  let t = ((wx - seg.ax) * abx + (wy - seg.ay) * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = seg.ax + abx * t, py = seg.ay + aby * t;
  return { px, py, t, d: Math.hypot(wx - px, wy - py) };
}

/**
 * Project a world point onto the ruler's nearest EDGE if within snap distance.
 * The ink rides the ruler face instead of passing underneath it, and points
 * that land inside the ruler strip are clamped out to the closer edge.
 */
export function snapToRuler(wx: number, wy: number, snapDist: number): { x: number; y: number } | null {
  if (!ruler.visible) return null;
  const edges = rulerEdges();
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (const e of edges) {
    const p = projectOnSeg(wx, wy, e);
    if (p.d < bestD) { bestD = p.d; best = { x: p.px, y: p.py } }
  }
  if (!best) return null;
  if (bestD <= snapDist) return best;
  // inside the strip (both edges' nearest points are farther than snapDist but
  // the point lies between them) → clamp to the closer edge so ink never
  // crosses under the ruler body
  const center = projectOnSeg(wx, wy, rulerSegment());
  if (center.d <= rulerThickness() / 2 + 2) return best;
  return null;
}
