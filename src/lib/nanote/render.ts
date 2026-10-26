// Nanote render engine — draws a full page (paper, template, background image,
// elements with highlighter-behind-ink ordering, audio-sync highlighting/replay)
// onto any 2D context. Shared by the live editor canvas, thumbnails, PNG and PDF export.
import { computeOutline, pathOutline } from './outline';
import { drawTemplate } from './templates';
import { shapePath, elementBBox } from './geometry';
import { ImageEl, PageDoc, PageElement, PageRow, StrokeEl, TextEl, ShapeEl, TEXT_FONTS } from './types';
import { isDarkHex, withAlpha } from './util';

export interface RenderOpts {
  gamma: number;                    // pressure curve from settings
  resolveImage?: (imageId: string) => CanvasImageSource | null; // pre-loaded bitmaps/canvases
  imageNatural?: (imageId: string) => { w: number; h: number } | null;
  audio?: { recId: string; tMs: number; mode: 'off' | 'highlight' | 'replay' };
  hideIds?: Set<string>;
  paperDark?: boolean;              // dark paper → highlighter blends differently
  highlighterOpacity?: number;      // 0..100 (%) — same-color overlaps never stack
  /** infinity paper: render a slice of the endless sheet instead of the page
   *  box; coordinates are page-local and may be negative. The background
   *  pattern is drawn seamlessly across the slice. */
  win?: { x0: number; y0: number; x1: number; y1: number };
  /** true when the notebook is an infinity paper (seamless pattern, no edges) */
  infinite?: boolean;
  /** vector-quality PDF background (re-rendered from the stored original at
   *  the CURRENT zoom — keeps text razor-sharp at high magnification,
   *  Notewise-style) drawn instead of the stored raster PNG when present.
   *  x/y/w/h place the source in PAGE-LOCAL units — full renders cover the
   *  whole page box; windowed (zoomed-in) renders carry their own slice. */
  backgroundOverride?: { source: CanvasImageSource; x: number; y: number; w: number; h: number } | null;
}

const isStroke = (e: { kind: string }): e is StrokeEl => e.kind === 'stroke';

/** speed per point (px/ms) recovered from stored timestamps */
function withSpeed(s: StrokeEl): { x: number; y: number; p: number; v: number }[] {
  const pts = s.points;
  const out: { x: number; y: number; p: number; v: number }[] = [];
  for (let i = 0; i < pts.length; i++) {
    const q = pts[i];
    if (i === 0) { out.push({ x: q.x, y: q.y, p: q.p, v: 0.4 }); continue }
    const prev = pts[i - 1];
    const d = Math.hypot(q.x - prev.x, q.y - prev.y);
    const dt = Math.max(1, q.t - prev.t);
    out.push({ x: q.x, y: q.y, p: q.p, v: Math.min(5, d / dt) });
  }
  return out;
}

// ---------------------------------------------------------------- outline cache (LRU)
interface CacheEntry { outline: number[]; sig: string }
const outlineCache = new Map<string, CacheEntry>();
const OUTLINE_CACHE_MAX = 3000;

function getOutline(stroke: StrokeEl, gamma: number): number[] {
  const sig = `${stroke.points.length}:${stroke.width}:${gamma}:${stroke.tool}:${stroke.points.length ? stroke.points[stroke.points.length - 1].x.toFixed(1) : ''}`;
  const key = `${stroke.id}`;
  const hit = outlineCache.get(key);
  if (hit && hit.sig === sig) return hit.outline;
  const outline = computeOutline(withSpeed(stroke), { tool: stroke.tool, width: stroke.width, gamma });
  if (outlineCache.size >= OUTLINE_CACHE_MAX) {
    const first = outlineCache.keys().next().value;
    if (first) outlineCache.delete(first);
  }
  outlineCache.set(key, { outline, sig });
  return outline;
}

export function invalidateOutline(strokeId?: string) {
  if (strokeId) outlineCache.delete(strokeId);
  else outlineCache.clear();
  bboxCache = new WeakMap();
}

// ---------------------------------------------------------------- element culling
// cached bounding boxes (elements are immutable — replaced, never mutated),
// used to skip elements outside the rendered slice: thousands of strokes stay
// fast because only what is on screen gets drawn.
let bboxCache = new WeakMap<PageElement, { x0: number; y0: number; x1: number; y1: number }>();

function cachedBBox(el: PageElement): { x0: number; y0: number; x1: number; y1: number } {
  let b = bboxCache.get(el);
  if (!b) {
    b = elementBBox(el);
    bboxCache.set(el, b);
  }
  return b;
}

/** does this element intersect the slice? (margin covers stroke width) */
function elInWin(el: PageElement, win: { x0: number; y0: number; x1: number; y1: number }): boolean {
  const m = el.kind === 'stroke' ? Math.min(40, (el as StrokeEl).width) : 4;
  const b = cachedBBox(el);
  return b.x1 + m >= win.x0 && b.x0 - m <= win.x1 && b.y1 + m >= win.y0 && b.y0 - m <= win.y1;
}

// ---------------------------------------------------------------- stroke / element drawing
export function drawStroke(ctx: CanvasRenderingContext2D, stroke: StrokeEl, opts: RenderOpts) {
  const outline = getOutline(stroke, opts.gamma);
  if (!outline.length) return;
  const isHi = stroke.tool === 'highlighter';
  ctx.save();
  if (isHi) {
    ctx.globalAlpha = hiAlphaOf(opts);
    ctx.globalCompositeOperation = opts.paperDark ? 'source-over' : 'multiply';
  }
  ctx.fillStyle = stroke.color;
  pathOutline(ctx, outline);
  ctx.fill();
  ctx.restore();
}

/** highlighter alpha (0..1) from the settings percentage (clamped, never invisible-proof) */
export function hiAlphaOf(opts: RenderOpts): number {
  return Math.min(1, Math.max(0.03, (opts.highlighterOpacity ?? 40) / 100));
}

function fontStackOf(el: TextEl): string {
  const def = TEXT_FONTS.find((f) => f.id === el.fontId) ?? TEXT_FONTS[0];
  return def.css;
}

export function measureTextEl(ctx: CanvasRenderingContext2D, el: TextEl): { lines: string[]; lineHeight: number; width: number } {
  const style = `${el.italic ? 'italic ' : ''}${el.bold ? '700' : '400'} ${el.size}px ${fontStackOf(el)}`;
  ctx.font = style;
  const lines = el.text.split('\n');
  let width = 0;
  for (const ln of lines) width = Math.max(width, ctx.measureText(ln).width);
  return { lines, lineHeight: el.size * 1.35, width };
}

export function drawText(ctx: CanvasRenderingContext2D, el: TextEl) {
  if (!el.text) return;
  const { lines, lineHeight } = measureTextEl(ctx, el);
  ctx.save();
  ctx.font = `${el.italic ? 'italic ' : ''}${el.bold ? '700' : '400'} ${el.size}px ${fontStackOf(el)}`;
  ctx.fillStyle = el.color;
  ctx.textBaseline = 'alphabetic';
  ctx.direction = /[\u0590-\u08FF]/.test(el.text) ? 'rtl' : 'ltr';
  const alignX = el.align === 'center' ? el.x + el.w / 2 : el.align === 'end' ? el.x + el.w : el.x;
  ctx.textAlign = el.align === 'center' ? 'center' : el.align === 'end' ? (ctx.direction === 'rtl' ? 'left' : 'right') : ctx.direction === 'rtl' ? 'right' : 'left';
  lines.forEach((ln, i) => {
    const y = el.y + el.size + i * lineHeight;
    ctx.fillText(ln, alignX, y);
    if (el.underline && ln.trim()) {
      const w = ctx.measureText(ln).width;
      const ux = el.align === 'center' ? alignX - w / 2 : el.align === 'end' ? alignX - w : ctx.direction === 'rtl' ? alignX - w : alignX;
      ctx.fillRect(ux, y + 2, w, Math.max(1, el.size * 0.06));
    }
  });
  ctx.restore();
}

export function drawShape(ctx: CanvasRenderingContext2D, el: ShapeEl) {
  ctx.save();
  shapePath(ctx, el.shape, el.x, el.y, el.w, el.h);
  if (el.fill != null) {
    ctx.fillStyle = el.fill;
    ctx.fill();
  }
  if (el.strokeWidth > 0 && (el.fill == null || el.stroke.toLowerCase() !== el.fill.toLowerCase())) {
    ctx.strokeStyle = el.stroke;
    ctx.lineWidth = el.strokeWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  }
  ctx.restore();
}

export function drawImageEl(ctx: CanvasRenderingContext2D, el: ImageEl, opts: RenderOpts) {
  const src = opts.resolveImage?.(el.imageId);
  if (!src) return;
  const nat = opts.imageNatural?.(el.imageId) ?? { w: el.w, h: el.h };
  ctx.save();
  const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
  ctx.translate(cx, cy);
  if (el.rotation) ctx.rotate(el.rotation);
  if (el.flipH || el.flipV) ctx.scale(el.flipH ? -1 : 1, el.flipV ? -1 : 1);
  // source window: the crop tool stores a normalized rect into the natural
  // bitmap — draw exactly that region (cover-fit into the element box, which
  // after a crop has the region's aspect ratio, so it fits exactly)
  let sw = nat.w, sh = nat.h, sx = 0, sy = 0;
  if (el.crop && el.crop.w > 0 && el.crop.h > 0) {
    sx = Math.max(0, Math.min(nat.w - 1, el.crop.x * nat.w));
    sy = Math.max(0, Math.min(nat.h - 1, el.crop.y * nat.h));
    sw = Math.max(1, Math.min(nat.w - sx, el.crop.w * nat.w));
    sh = Math.max(1, Math.min(nat.h - sy, el.crop.h * nat.h));
  }
  // cover-fit the (cropped) source into the element box
  const s = Math.max(Math.abs(el.w) / sw, Math.abs(el.h) / sh);
  const dw = sw * s, dh = sh * s;
  // rounded corners: clip the drawn box (page-space radius, clamped to half min side)
  const r = el.cornerRadius ?? 0;
  if (r > 0) {
    const maxR = Math.min(Math.abs(el.w), Math.abs(el.h)) / 2;
    const rr = Math.min(r, maxR);
    ctx.beginPath();
    // clip ellipse-ish capsule when the radius reaches the half-min side
    if (rr >= maxR) {
      ctx.ellipse(0, 0, Math.abs(el.w) / 2, Math.abs(el.h) / 2, 0, 0, Math.PI * 2);
    } else {
      ctx.roundRect(-Math.abs(el.w) / 2, -Math.abs(el.h) / 2, Math.abs(el.w), Math.abs(el.h), rr);
    }
    ctx.clip();
  }
  try {
    ctx.drawImage(src, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh);
  } catch { /* bad image */ }
  ctx.restore();
}

// ---------------------------------------------------------------- audio sync helpers
function syncEntryFor(doc: PageDoc, strokeId: string) { return doc.sync?.[strokeId] ?? null }

function strokeVisible(doc: PageDoc, stroke: StrokeEl, opts: RenderOpts): boolean {
  const audio = opts.audio;
  if (!audio || audio.mode === 'off') return true;
  const entry = syncEntryFor(doc, stroke.id);
  if (!entry || entry.recId !== audio.recId) return audio.mode !== 'replay';
  if (audio.mode === 'replay') return entry.tStart <= audio.tMs + 60;
  return true; // highlight keeps all visible
}

function strokeHighlighted(doc: PageDoc, stroke: StrokeEl, opts: RenderOpts): boolean {
  const audio = opts.audio;
  if (!audio || audio.mode !== 'highlight') return false;
  const entry = syncEntryFor(doc, stroke.id);
  if (!entry || entry.recId !== audio.recId) return false;
  return audio.tMs >= entry.tStart - 120 && audio.tMs <= entry.tEnd + 120;
}

// ---------------------------------------------------------------- main
export function renderPage(
  ctx: CanvasRenderingContext2D,
  page: PageRow,
  doc: PageDoc | null,
  w: number,
  h: number,
  opts: RenderOpts,
) {
  // infinity paper renders a slice of the endless sheet; fixed pages render
  // their full box (win defaults to exactly that).
  const win = opts.win ?? { x0: 0, y0: 0, x1: w, y1: h };
  const infinite = opts.infinite ?? false;

  // 1) paper — fills the whole slice (negative local coords included)
  ctx.fillStyle = page.backgroundHex || '#FFFFFF';
  ctx.fillRect(win.x0, win.y0, win.x1 - win.x0, win.y1 - win.y0);

  // 2) PDF/background image beneath everything — the vector override (rendered
  //    from the original PDF at the current zoom) wins when available
  //    (fixed pages only — infinite sheets have no PDF background)
  if (opts.backgroundOverride && !infinite) {
    try {
      const bo = opts.backgroundOverride;
      ctx.drawImage(bo.source, bo.x, bo.y, bo.w, bo.h);
    } catch { /* ignore */ }
  } else if (page.backgroundImageId && opts.resolveImage && !infinite) {
    const src = opts.resolveImage(page.backgroundImageId);
    if (src) {
      const nat = opts.imageNatural?.(page.backgroundImageId) ?? { w, h };
      const s = Math.max(w / nat.w, h / nat.h);
      try { ctx.drawImage(src, (w - nat.w * s) / 2, (h - nat.h * s) / 2, nat.w * s, nat.h * s) } catch { /* ignore */ }
    }
  }

  // 3) custom template image
  if (page.customTemplateImageId && opts.resolveImage && !infinite) {
    const src = opts.resolveImage(page.customTemplateImageId);
    if (src) {
      try { ctx.drawImage(src, 0, 0, w, h) } catch { /* ignore */ }
    }
  }

  // 4) paper template lines — seamless across the slice, anchored to the
  //    absolute local grid so panning never breaks the pattern
  drawTemplate(ctx, page.template, win.x1, win.y1, page.backgroundHex || '#FFFFFF', win.x0, win.y0, infinite);

  if (!doc) return;

  const optsWithPaper: RenderOpts = { ...opts, paperDark: isDarkHex(page.backgroundHex || '#FFFFFF') };

  const hide = opts.hideIds;
  const els = doc.elements.filter((e) => !hide?.has(e.id) && elInWin(e, win));

  // 5) highlighter strokes first (draws BEHIND ink) — grouped by color and
  // filled as ONE merged path per color: overlapping passes of the same color
  // never stack/darken, and the opacity slider controls the exact tint.
  const hiStrokes = els.filter((e): e is StrokeEl => isStroke(e) && e.tool === 'highlighter');
  const rest = els.filter((e) => !(isStroke(e) && (e as StrokeEl).tool === 'highlighter'));
  hiStrokes.sort((a, b) => a.z - b.z);
  rest.sort((a, b) => a.z - b.z);

  const hiVisible = hiStrokes.filter((s) => strokeVisible(doc, s, optsWithPaper));
  if (hiVisible.length) {
    const byColor = new Map<string, { paths: Path2D[]; glow: boolean }>();
    for (const s of hiVisible) {
      const outline = getOutline(s, optsWithPaper.gamma);
      if (!outline.length) continue;
      const g = byColor.get(s.color) ?? { paths: [], glow: false };
      const p = new Path2D();
      for (let i = 0; i < outline.length; i += 2) {
        if (i === 0) p.moveTo(outline[i], outline[i + 1]);
        else p.lineTo(outline[i], outline[i + 1]);
      }
      p.closePath();
      g.paths.push(p);
      if (strokeHighlighted(doc, s, optsWithPaper)) g.glow = true;
      byColor.set(s.color, g);
    }
    for (const [color, g] of byColor) {
      ctx.save();
      ctx.globalAlpha = hiAlphaOf(optsWithPaper);
      ctx.globalCompositeOperation = optsWithPaper.paperDark ? 'source-over' : 'multiply';
      ctx.fillStyle = color;
      const merged = new Path2D();
      for (const p of g.paths) merged.addPath(p);
      ctx.fill(merged, 'nonzero');
      ctx.restore();
    }
  }

  for (const el of rest) {
    if (isStroke(el) && !strokeVisible(doc, el, optsWithPaper)) continue;
    if (isStroke(el) && strokeHighlighted(doc, el, optsWithPaper)) {
      strokeGlow(ctx, el, optsWithPaper); // soft glow underlay for the synced stroke
    }
    switch (el.kind) {
      case 'stroke':
        drawStroke(ctx, el, optsWithPaper);
        break;
      case 'text':
        drawText(ctx, el);
        break;
      case 'shape':
        drawShape(ctx, el);
        break;
      case 'image':
        drawImageEl(ctx, el, optsWithPaper);
        break;
    }
  }
}

/** active (currently-being-drawn or just-played-back) stroke glow used by replay */
export function strokeGlow(ctx: CanvasRenderingContext2D, stroke: StrokeEl, opts: RenderOpts) {
  const outline = getOutline(stroke, opts.gamma);
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = 14;
  pathOutline(ctx, outline);
  ctx.stroke();
  ctx.restore();
}
