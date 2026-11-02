'use client';
// PageCanvas — one page rasterized to a canvas.
// PERFORMANCE MODEL (the fix for heavy/laggy pinch-zoom navigation):
//   • This component NEVER re-renders in React while the viewport moves — it
//     does not subscribe to vp state at all. The world container applies the
//     zoom/pan transform (CSS/GPU) and the existing bitmap simply scales.
//   • Re-rasterization happens ONLY after the gesture settles (vp idle for
//     ~280ms via onVpIdle), and only one page per animation frame for the
//     full-page path (global queue) — so zooming stays smooth and the settle
//     pass never stutters the UI.
//   • Rendered bitmaps are persisted in the device's Cache Storage
//     (rastercache.ts) keyed by doc version + bucket — re-opening a notebook
//     paints instantly without re-rendering PDF backgrounds and ink.
//
// Sharp-text zoom (Notewise-style): pages imported from a PDF whose ORIGINAL
// file is stored get their background re-rendered VECTOR from that original
// at the current raster scale (pdf.js) — text stays crisp at high zoom
// instead of upscaling the ~2x import snapshot. In WINDOWED (zoomed-in) mode
// the vector render is a SLICE of the page (pdf.js render transform), so
// razor-sharp text never requires a full-page bitmap at extreme rasters.
//
// HIGH-RESOLUTION INK (the fix for pixelated strokes when zoomed in):
//   • Windowed rendering renders at the DEVICE-EXACT raster — raster = scale ·
//     devicePixelRatio — so every ink unit lands on a real device pixel: crisp
//     strokes, text and shapes at ANY zoom (8%–2400% on infinity paper, 800%
//     on fixed pages), never an upscaled bitmap.
//   • INFINITY PAPER renders a WINDOW around the viewport (paper + seamless
//     background + only the on-screen elements — culling in render.ts). The
//     bitmap size is viewport-bound (~2.6 screens) at every zoom, so device
//     resolution is affordable; the margins shrink automatically when the
//     bitmap budget (per-side + total area) would be exceeded.
//   • FIXED PAGES zoomed in beyond what a full-page bitmap can afford switch
//     to the SAME windowed slice (clamped to the page box): ink stays
//     pixel-perfect at 800% instead of upscaling a capped bitmap. Zoomed out
//     they keep the classic full-page render + raster cache, byte-identical.
//     In windowed mode the page edge is drawn INTO the bitmap at a constant
//     1-device-pixel width and a pointer-events-none frame div carries the
//     page shadow.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/lib/nanote/store';
import { renderPage } from '@/lib/nanote/render';
import { preloadPageImages, resolveImage, imageNatural } from '@/lib/nanote/images';
import { renderPdfPageVector } from '@/lib/nanote/pdftext';
import { getCachedRaster, putCachedRaster } from '@/lib/nanote/rastercache';
import { bitmapAreaBudget, bitmapSideCap, degradeBitmapBudget } from '@/lib/nanote/canvasbudget';
import { PageRow } from '@/lib/nanote/types';
import { clamp } from '@/lib/nanote/util';
import { getHiddenIds, onRepaint, onVpIdle, getVp, getViewportSize, visibleWorldRect } from './viewport';
import type { PageLayout } from './viewport';

/** per-side bitmap cap (Chromium handles 16k; keep headroom for tiling) */
const MAX_BITMAP_DIM = bitmapSideCap();
/**
 * total pixel budget for a window bitmap — ADAPTIVE (canvasbudget.ts): sized
 * from device RAM, verified by an allocation probe, halved in embedded split
 * panes. The old fixed 16.6M-px ceiling blanked canvases on low-memory
 * Android WebViews at max zoom (the "screen turns black" report).
 */
function maxBitmapArea(): number {
  return bitmapAreaBudget();
}
/** full-page render cap: the cacheable "bucket" path tops out here */
const FULL_RASTER_MAX = 5;
/** zoom-out degenerate guard only — the budgets above are the real limits */
const RASTER_MIN = 0.02;

// one page re-raster per animation frame, globally (full-page path only)
const rasterQueue: (() => void)[] = [];
let queueRunning = false;
function pumpQueue() {
  if (queueRunning) return;
  queueRunning = true;
  const step = () => {
    const fn = rasterQueue.shift();
    if (!fn) { queueRunning = false; return }
    try { fn() } catch { /* keep the queue alive */ }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function dprOf(): number {
  return typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
}

/** raster bucket for a FULL-page render (coarse, capped, cacheable) */
function bucketFor(scale: number, pageW: number, pageH: number): number {
  const raw = Math.min(Math.max(0.5, scale * dprOf()), FULL_RASTER_MAX);
  // memory guard for very tall pages
  const byPixels = Math.sqrt(maxBitmapArea() / Math.max(1, pageW * pageH));
  return Math.min(raw, Math.max(0.5, byPixels));
}

/**
 * Device-exact raster for WINDOWED rendering (infinity paper + zoomed-in
 * fixed pages): raster = scale·dpr so the bitmap matches the screen 1:1.
 * Clamped only by the bitmap budget (per-side + area) — never a fixed cap.
 */
function windowRaster(scale: number, ww: number, wh: number): number {
  let r = scale * dprOf();
  if (ww > 1 && wh > 1) {
    r = Math.min(r, MAX_BITMAP_DIM / Math.max(ww, wh));
    r = Math.min(r, Math.sqrt(maxBitmapArea() / (ww * wh)));
  }
  // NOTE: no raising floor — at 8% zoom the correct raster IS 0.08·dpr and
  // the bitmap stays viewport-sized; forcing it higher would exceed the
  // pixel budget.
  return clamp(r, RASTER_MIN, 40);
}

export interface Win { x0: number; y0: number; x1: number; y1: number }

/** the full padded page box in page-local coordinates */
function fullWin(l: PageLayout): Win {
  return { x0: -l.padX, y0: -l.padY, x1: l.w - l.padX, y1: l.h - l.padY };
}

function winIsFull(w: Win, l: PageLayout): boolean {
  const f = fullWin(l);
  return w.x0 <= f.x0 + 0.5 && w.y0 <= f.y0 + 0.5 && w.x1 >= f.x1 - 0.5 && w.y1 >= f.y1 - 0.5;
}

/**
 * Margins (local units) around the visible rect for a windowed render, sized
 * so the bitmap at device-exact raster fits the budget: prefer ~`mf` of the
 * viewport on every side, shrink proportionally when the area budget binds.
 */
function budgetedMargins(visW: number, visH: number, cw: number, ch: number, scale: number, mf: number) {
  const dpr = dprOf();
  const budgetSide = MAX_BITMAP_DIM / (scale * dpr);
  const budgetArea = maxBitmapArea() / (scale * dpr) ** 2;
  let mx = Math.max(240, cw * mf) / scale;
  let my = Math.max(240, ch * mf) / scale;
  mx = Math.min(mx, Math.max(0, (budgetSide - visW) / 2));
  my = Math.min(my, Math.max(0, (budgetSide - visH) / 2));
  let wx = visW + 2 * mx, wy = visH + 2 * my;
  if (wx * wy > budgetArea && wx * wy > 0) {
    const k = Math.sqrt(budgetArea / (wx * wy));
    wx = Math.max(visW, wx * k);
    wy = Math.max(visH, wy * k);
    mx = (wx - visW) / 2;
    my = (wy - visH) / 2;
  }
  return { mx, my };
}

/**
 * Infinity paper: the render window ≈ the visible viewport expanded by ~80%
 * (high zooms: ~50%) on every side (so panning keeps showing rendered paper),
 * rounded to a coarse grid to avoid churn. Unclamped — the sheet has no edges.
 *
 * CRITICAL ROUNDING RULE (the max-zoom black-screen fix): the LOW edges round
 * DOWN and the HIGH edges round UP, so the grid-quantized window is always a
 * SUPERSET of viewport+margin. The old `floor` on BOTH edges could collapse
 * the window to a single grid cell (or an empty span) when the visible rect
 * at 2400% zoom (~50×30 local units) is smaller than the 128-unit grid — the
 * canvas then covered a 174×110 px sliver of a 1280×744 viewport and the rest
 * of the screen showed the app background (black in dark mode).
 */
function viewportWin(l: PageLayout): Win {
  const vis = visibleWorldRect();
  const { w: cw, h: ch } = getViewportSize();
  const visW = Math.max(1, vis.x1 - vis.x0);
  const visH = Math.max(1, vis.y1 - vis.y0);
  // extreme zooms keep tighter margins — the bitmap stays device-exact but
  // smaller, so re-renders after each zoom-settle stay fast and memory-light
  const s = getVp().scale;
  const mf = s > 8 ? 0.5 : s > 4 ? 0.65 : 0.8;
  const { mx, my } = budgetedMargins(visW, visH, cw, ch, s, mf);
  const G = 128; // grid rounding — keeps re-renders sparse
  const down = (v: number) => Math.floor(v / G) * G;
  const up = (v: number) => Math.ceil(v / G) * G;
  return {
    x0: down(vis.x0 - mx),
    y0: down(vis.y0 - l.y - my),
    x1: up(vis.x1 + mx),
    y1: up(vis.y1 - l.y + my),
  };
}

/**
 * Fixed page: full-page render while a full bitmap can afford the current
 * zoom (bucket ≤ affordable), else the SAME windowed slice as infinity paper
 * — clamped to the page box so the page edges stay exact. Hysteresis on the
 * mode flip (±4%) prevents flapping at the threshold.
 */
function fixedWin(l: PageLayout, currentlyWindowed: boolean): Win {
  const full = fullWin(l);
  const pageW = l.w, pageH = l.h;
  const affordable = Math.min(
    FULL_RASTER_MAX,
    MAX_BITMAP_DIM / Math.max(pageW, pageH, 1),
    Math.sqrt(maxBitmapArea() / Math.max(1, pageW * pageH)),
  );
  const need = getVp().scale * dprOf();
  if (currentlyWindowed ? need < affordable * 0.96 : need <= affordable * 1.0) return full;
  const vis = visibleWorldRect();
  const { w: cw, h: ch } = getViewportSize();
  const visW = Math.max(1, vis.x1 - vis.x0);
  const visH = Math.max(1, vis.y1 - vis.y0);
  const { mx, my } = budgetedMargins(visW, visH, cw, ch, getVp().scale, 0.7);
  const cx = (vis.x0 + vis.x1) / 2;
  const cy = (vis.y0 + vis.y1) / 2 - l.y;
  const w: Win = {
    x0: clamp(cx - (visW / 2 + mx), full.x0, full.x1),
    y0: clamp(cy - (visH / 2 + my), full.y0, full.y1),
    x1: clamp(cx + visW / 2 + mx, full.x0, full.x1),
    y1: clamp(cy + visH / 2 + my, full.y0, full.y1),
  };
  // the slice swallowed the whole page → full-page render after all
  if (w.x1 - w.x0 >= pageW * 0.985 && w.y1 - w.y0 >= pageH * 0.985) return full;
  return w;
}

function winChanged(a: Win, b: Win): boolean {
  // relative threshold: at low zoom the window spans tens of thousands of
  // local units and a fixed 64-unit trigger would re-render on every ~5px of
  // panning; 6% of the window keeps re-renders sparse at every zoom. The
  // absolute FLOOR is 12 units (not 64): at max zoom the window span is
  // ~100 units and margins ~25 — a 64-unit floor meant the viewport could pan
  // clean off the rendered bitmap (black strip) long before a re-render was
  // even considered. 12 units keeps ≥ half the margin in hand at any zoom.
  const sx = Math.max(12, (b.x1 - b.x0) * 0.06);
  const sy = Math.max(12, (b.y1 - b.y0) * 0.06);
  return Math.abs(a.x0 - b.x0) > sx || Math.abs(a.y0 - b.y0) > sy || Math.abs(a.x1 - b.x1) > sx || Math.abs(a.y1 - b.y1) > sy;
}

interface VectorEntry {
  pageId: string;
  raster: number;
  win: Win;                 // the page-local slice the canvas covers
  canvas: HTMLCanvasElement;
}
const vectorLru: VectorEntry[] = [];
const VECTOR_LRU_MAX = 2;
const vectorInflight = new Set<string>();

function sameWin(a: Win, b: Win): boolean {
  return Math.abs(a.x0 - b.x0) < 1.5 && Math.abs(a.y0 - b.y0) < 1.5 && Math.abs(a.x1 - b.x1) < 1.5 && Math.abs(a.y1 - b.y1) < 1.5;
}

function getVectorCanvas(pageId: string, raster: number, win: Win): VectorEntry | null {
  const hit = vectorLru.find((v) => v.pageId === pageId && Math.abs(v.raster - raster) < 0.06 && sameWin(v.win, win));
  if (!hit) return null;
  // refresh LRU position
  vectorLru.splice(vectorLru.indexOf(hit), 1);
  vectorLru.push(hit);
  return hit;
}

function putVectorCanvas(pageId: string, raster: number, win: Win, canvas: HTMLCanvasElement): void {
  vectorLru.push({ pageId, raster, win, canvas });
  while (vectorLru.length > VECTOR_LRU_MAX) vectorLru.shift();
}

export function PageCanvas({
  page,
  layout,
  infinite,
}: {
  page: PageRow;
  layout: PageLayout;
  infinite: boolean;
}) {
  const doc = useApp((s) => s.editor.docs[page.id]);
  const docVersion = useApp((s) => s.editor.docVersions[page.id] ?? 0);
  const gamma = useApp((s) => s.settings.pressureCurve);
  const hiOpacity = useApp((s) => s.settings.highlighterOpacity);
  const audio = useApp((s) => s.editor.audio);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rasterRef = useRef(1);
  const tokenRef = useRef(0);
  // true once THIS component instance has painted at least once. Mount paints
  // (blank canvas) may go through the global raster queue; every later paint
  // must stay synchronous-in-commit — a windowed recenter swaps the canvas box
  // and its bitmap in one commit, and queueing that reintroduced the visible
  // "strokes jump after zoom" glitch.
  const hasPaintedRef = useRef(false);
  const idleScheduledRef = useRef(0);
  // vector background state: null = use the stored PNG snapshot
  const [vectorTick, setVectorTick] = useState(0);
  const [rasterTick, setRasterTick] = useState(0);

  const pageW = layout.w;   // full padded width
  const pageH = layout.h;   // full padded height

  // render window: fixed pages = full box (or a slice when zoomed in past the
  // full-bitmap budget); infinity paper = a slice following the viewport
  const [win, setWin] = useState<Win>(() =>
    infinite ? viewportWin(layout) : fixedWin(layout, false),
  );
  // CRITICAL: winRef must be current BEFORE any layout effect runs. It used
  // to sync in a passive useEffect — which fires AFTER the paint layout
  // effect — so a windowed recenter painted the OLD window's bitmap into the
  // NEW css box: the sheet visibly stretched/shifted after every zoom settle
  // (the "zooming moves my writing" drift). Syncing during render closes the
  // gap: the layout effect (and anything the raster queue runs later) always
  // sees the latest window.
  const winRef = useRef(win);
  winRef.current = win;
  const windowed = infinite || !winIsFull(win, layout);
  // page box for renderPage's w/h (background fit) — full padded dims.
  // Synced during render (see winRef above) so paintFromDoc never reads a
  // stale page box after the sheet grows.
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const audioMode: 'off' | 'highlight' | 'replay' =
    !audio.playing || !audio.recId ? 'off' : audio.replay ? 'replay' : audio.sync ? 'highlight' : 'off';
  const audioOpts = useMemo(
    () => (audioMode !== 'off' ? { audio: { recId: audio.recId as string, tMs: audio.tMs, mode: audioMode as 'highlight' | 'replay' } } : {}),
    [audioMode, audio.recId, audio.tMs],
  );
  const audioOptsRef = useRef<Record<string, unknown>>({});
  useEffect(() => {
    audioOptsRef.current = audioMode === 'off' ? {} : audioOpts;
  }, [audioOpts, audioMode]);

  // lazy-load doc + referenced images
  useEffect(() => {
    void useApp.getState().ensureDoc(page.id);
  }, [page.id]);

  // ------------------------------------------------------------- painting
  const paintFromDoc = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const l = layoutRef.current;
    const w = winRef.current;
    const ww = Math.max(2, w.x1 - w.x0);
    const wh = Math.max(2, w.y1 - w.y0);
    // raster: windowed renders are DEVICE-EXACT (scale·dpr, budget-capped);
    // full-page renders use the coarse cacheable bucket
    let raster: number;
    if (infinite || !winIsFull(w, l)) {
      raster = windowRaster(getVp().scale, ww, wh);
    } else {
      raster = bucketFor(getVp().scale, l.w, l.h);
    }
    rasterRef.current = raster;
    const bw = Math.max(2, Math.round(ww * raster));
    const bh = Math.max(2, Math.round(wh * raster));
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const hidden = getHiddenIds(page.id);
    try {
      ctx.setTransform(raster, 0, 0, raster, -w.x0 * raster, -w.y0 * raster);
      const vector = !infinite && page.backgroundImageId != null
        ? getVectorCanvas(page.id, Math.round(raster * 10) / 10, w)
        : null;
      renderPage(ctx, page, doc ?? null, l.w, l.h, {
        gamma,
        highlighterOpacity: hiOpacity,
        resolveImage,
        imageNatural,
        hideIds: hidden,
        win: w,
        infinite,
        ...(vector ? { backgroundOverride: { source: vector.canvas, x: vector.win.x0, y: vector.win.y0, w: vector.win.x1 - vector.win.x0, h: vector.win.y1 - vector.win.y0 } } : {}),
        ...audioOptsRef.current,
      });
      // SELF-HEAL CHECK: on over-constrained devices a canvas at the budget
      // can allocate but rasterize nothing (blank backing store) — verify a
      // pixel actually changed; if not, degrade the budget and retry this
      // paint once at the smaller size (the "max zoom black screen" guard).
      if (bw > 2048 && bh > 2048) {
        const probe = ctx.getImageData(Math.min(4, bw - 1), Math.min(4, bh - 1), 1, 1).data;
        const paperHex = (page.backgroundHex || '#FFFFFF').replace('#', '');
        const expect0 = probe.length ? probe[0] : 0;
        const expectR = paperHex.length >= 6 ? parseInt(paperHex.slice(0, 2), 16) : 255;
        if (probe[3] === 0 || (expect0 === 0 && expectR > 40)) {
          // transparent corner = the backing store never rasterized
          degradeBitmapBudget();
          const r2 = Math.min(raster, Math.sqrt(maxBitmapArea() / (ww * wh)));
          if (r2 < raster) {
            rasterRef.current = r2;
            canvas.width = Math.max(2, Math.round(ww * r2));
            canvas.height = Math.max(2, Math.round(wh * r2));
            const ctx2 = canvas.getContext('2d');
            if (ctx2) {
              ctx2.setTransform(r2, 0, 0, r2, -w.x0 * r2, -w.y0 * r2);
              const vector2 = !infinite && page.backgroundImageId != null
                ? getVectorCanvas(page.id, Math.round(r2 * 10) / 10, w)
                : null;
              renderPage(ctx2, page, doc ?? null, l.w, l.h, {
                gamma,
                highlighterOpacity: hiOpacity,
                resolveImage,
                imageNatural,
                hideIds: getHiddenIds(page.id),
                win: w,
                infinite,
                ...(vector2 ? { backgroundOverride: { source: vector2.canvas, x: vector2.win.x0, y: vector2.win.y0, w: vector2.win.x1 - vector2.win.x0, h: vector2.win.y1 - vector2.win.y0 } } : {}),
                ...audioOptsRef.current,
              });
            }
          }
        }
      }
    } catch {
      // allocation/ raster threw (out of memory at this size) — degrade the
      // session budget so the next window render asks for a smaller bitmap
      degradeBitmapBudget();
    }
    // fixed pages: draw the page edge INTO the bitmap at a constant ~1 device
    // pixel — stays a hairline at any zoom (the old CSS outline scaled with
    // the world transform and turned into a thick band at 800%)
    if (!infinite && !winIsFull(w, l)) {
      const lw = Math.max(0.3, 1.1 / getVp().scale);
      ctx.strokeStyle = 'rgba(22,35,58,0.14)';
      ctx.lineWidth = lw;
      ctx.strokeRect(-l.padX + lw / 2, -l.padY + lw / 2, l.w - lw, l.h - lw);
    }
    // persist for instant re-opens — but NEVER while transient element hides
    // are active (selection/move previews): that render is incomplete.
    // Windowed renders move with the viewport — caching them is pointless
    // (culling makes fresh renders cheap) — so only full fixed pages cache.
    //
    // IMAGES-COMPLETE GATE: while any referenced image (PDF background,
    // custom template, photo/sticker elements) is still decoding,
    // resolveImage() returns null and the render is MISSING those bitmaps.
    // Caching such an incomplete raster poisoned the cache key forever after
    // — every later lookup hit the blank bitmap and the page showed empty
    // ("opened my PDF and page 1 is white"). Incomplete renders stay
    // uncached; the image-load repaint caches the complete one under the
    // same key, replacing nothing (it was never stored).
    const imagesComplete =
      (!page.backgroundImageId || !!resolveImage(page.backgroundImageId)) &&
      (!page.customTemplateImageId || !!resolveImage(page.customTemplateImageId)) &&
      (!doc || doc.elements.every((e) => e.kind !== 'image' || !!resolveImage(e.imageId)));
    if (!infinite && winIsFull(w, l) && (!hidden || hidden.size === 0) && imagesComplete) {
      void putCachedRaster(
        { pageId: page.id, docVersion, raster, pageW, pageH, gamma, hiOpacity },
        canvas,
      );
    }
    hasPaintedRef.current = true;
  }, [page, doc, docVersion, gamma, hiOpacity, pageW, pageH, infinite]);

  /** draw a cached bitmap (instant path — full-page renders only) */
  const paintFromBitmap = useCallback((bmp: ImageBitmap, raster = rasterRef.current) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = Math.max(2, Math.round(pageW * raster));
    const h = Math.max(2, Math.round(pageH * raster));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0);
    hasPaintedRef.current = true;
  }, [pageW, pageH]);

  const requestPaint = useCallback(async (tryCache = true, viaQueue = false) => {
    const token = ++tokenRef.current;
    const hidden = getHiddenIds(page.id);
    const cacheable = tryCache && !infinite && !windowed && (!hidden || hidden.size === 0);
    if (cacheable) {
      // Look up the bucket the CURRENT zoom actually wants. The old key used
      // rasterRef.current — which is 1 on a fresh mount — so a page rendered
      // at 1.3× last session, then culled and remounted while flipping,
      // MISSED the cache and re-rendered the full page synchronously on
      // every single flip. Try the desired bucket first, then the base
      // bucket as a soft fallback, and only render fresh on a double miss.
      const want = Math.min(
        bucketFor(getVp().scale, pageW, pageH),
        MAX_BITMAP_DIM / Math.max(2, pageW),
        Math.sqrt(maxBitmapArea() / Math.max(4, pageW * pageH)),
      );
      const base = { pageId: page.id, docVersion, pageW, pageH, gamma, hiOpacity };
      let got: { bmp: ImageBitmap; raster: number } | null = null;
      const first = await getCachedRaster({ ...base, raster: want });
      if (first) got = { bmp: first, raster: want };
      else {
        const baseBucket = bucketFor(1, pageW, pageH);
        if (Math.abs(want - baseBucket) > 0.01) {
          const second = await getCachedRaster({ ...base, raster: baseBucket });
          if (second) got = { bmp: second, raster: baseBucket };
        }
      }
      if (token !== tokenRef.current) return; // superseded
      if (got && canvasRef.current) {
        rasterRef.current = got.raster;
        paintFromBitmap(got.bmp, got.raster);
        return;
      }
    }
    if (token !== tokenRef.current) return;
    // First paint of a freshly mounted page (canvas still blank): render
    // through the GLOBAL queue (one page per animation frame). Opening a
    // notebook mounts 2–3 pages at once; rendering them synchronously in the
    // same commit froze the first 100–300ms of the session. Pages that
    // already show content paint immediately — a windowed recenter must swap
    // box+bitmap atomically in one commit.
    if (viaQueue && !hasPaintedRef.current) {
      rasterQueue.push(() => {
        if (token === tokenRef.current) paintFromDoc();
      });
      pumpQueue();
      return;
    }
    paintFromDoc();
  }, [page.id, docVersion, gamma, hiOpacity, pageW, pageH, infinite, windowed, paintFromBitmap, paintFromDoc]);

  // referenced images load async → repaint when they arrive
  useEffect(() => {
    void preloadPageImages(page, doc ?? null).then(() => { void requestPaint(true, true) });
  }, [page, doc, requestPaint]);

  // content changes → full paint (doc/image load, undo/redo, bucket change,
  // vector bg arrival, highlighter opacity, audio sync). `win` IS a dep: the
  // zoom-settle pass moves the render window and the fresh slice must paint.
  // LAYOUT EFFECT, CRITICAL: the canvas box (left/top/width/height) and its
  // BITMAP must update in the SAME commit — before the browser paints. A
  // plain useEffect runs AFTER the paint, so one frame showed the OLD window
  // bitmap stretched into the NEW box = the ink visibly JUMPED positions right
  // after each zoom (the "zooming moves my writing" bug).
  useLayoutEffect(() => {
    void requestPaint(true, true);
  }, [requestPaint, rasterTick, vectorTick, win]);

  // transient repaints (eraser preview, selection drags hiding originals)
  // — direct doc paint, never the cache (the render is intentionally partial).
  // PERF: only the page whose hidden set actually changed re-renders — an
  // erase sweep on page 3 must not re-raster pages 1 and 2 too. The sentinel
  // (undefined) after a paintFromDoc identity change guarantees one paint
  // whenever the doc/content changed, so nothing ever ends up stale.
  const lastHiddenSigRef = useRef<string | null | undefined>(undefined);
  useLayoutEffect(() => {
    lastHiddenSigRef.current = undefined; // content may have changed — repaint once
    return onRepaint(() => {
      const hidden = getHiddenIds(page.id) ?? null;
      const sig = hidden ? `${hidden.size}:${[...hidden].join(',')}` : null;
      if (sig === lastHiddenSigRef.current) return; // nothing new for THIS page
      lastHiddenSigRef.current = sig;
      tokenRef.current++;
      paintFromDoc();
    });
  }, [page.id, paintFromDoc]);

  // ------------------------------------------------------------- zoom-aware raster
  // Only after the viewport has been idle for ~280ms do we consider
  // re-rasterizing. Never during the gesture itself.
  //   • windowed renders (infinity paper + zoomed-in fixed pages): re-center
  //     the window AND re-render at device-exact raster when the zoom moved
  //     ≥6% (culling makes these cheap — crispness wins). The window is also
  //     re-centered whenever the CURRENT bitmap no longer comfortably covers
  //     the viewport (edge-coverage check — the max-zoom black-strip guard);
  //   • full-page renders: coarse ≥1.3× bucket changes only (expensive).
  useEffect(() => {
    /** does the current window still cover the visible rect with headroom? */
    const winStillCovers = (cur: Win, desired: Win): boolean => {
      const hx = (desired.x1 - desired.x0) * 0.04;
      const hy = (desired.y1 - desired.y0) * 0.04;
      return (
        cur.x0 <= desired.x0 + hx && cur.x1 >= desired.x1 - hx &&
        cur.y0 <= desired.y0 + hy && cur.y1 >= desired.y1 - hy
      );
    };
    const maybeReRaster = () => {
      idleScheduledRef.current = 0;
      if (infinite) {
        const desired = viewportWin(layout);
        const raster = windowRaster(getVp().scale, desired.x1 - desired.x0, desired.y1 - desired.y0);
        const ratio = raster / rasterRef.current;
        if (winChanged(desired, winRef.current) || ratio > 1.06 || ratio < 1 / 1.06 || !winStillCovers(winRef.current, desired)) {
          setWin(desired);
        }
        return;
      }
      const desired = fixedWin(layout, !winIsFull(winRef.current, layout));
      if (!winIsFull(desired, layout)) {
        // windowed fixed page — same cheap device-exact re-render policy
        const raster = windowRaster(getVp().scale, desired.x1 - desired.x0, desired.y1 - desired.y0);
        const ratio = raster / rasterRef.current;
        if (winChanged(desired, winRef.current) || ratio > 1.06 || ratio < 1 / 1.06 || !winStillCovers(winRef.current, desired)) {
          setWin(desired);
        }
        return;
      }
      if (!winIsFull(winRef.current, layout)) {
        setWin(desired); // zoomed back out → return to the full-page render
        return;
      }
      const desiredBucket = bucketFor(getVp().scale, pageW, pageH);
      const current = rasterRef.current;
      const ratio = desiredBucket / current;
      if (ratio > 1.3 || ratio < 1 / 1.3) {
        rasterRef.current = desiredBucket;
        rasterQueue.push(() => setRasterTick((v) => v + 1));
        pumpQueue();
      }
    };
    const offIdle = onVpIdle(() => {
      if (idleScheduledRef.current) return;
      idleScheduledRef.current = 1;
      maybeReRaster();
    });
    return offIdle;
  }, [pageW, pageH, layout, infinite]);

  // ---- vector background render (async; re-renders when the raster bucket
  // or the window changes and lands on the next paint — the PNG snapshot
  // shows meanwhile). Windowed renders are SLICES of the page (pdf.js render
  // transform), so vector text is razor-sharp at any zoom without a giant
  // full-page bitmap.
  useEffect(() => {
    if (infinite || page.backgroundImageId == null) return;
    const st = useApp.getState();
    const notebook = st.notebooks.find((n) => n.id === page.notebookId);
    if (!notebook?.pdfOriginalId) return;
    const w = winRef.current;
    const windowedNow = !winIsFull(w, layout);
    const vectorRaster = Math.round(rasterRef.current * 10) / 10; // stable bucket key
    if (getVectorCanvas(page.id, vectorRaster, w)) return; // already rendered
    const key = `${page.id}@${vectorRaster}@${Math.round(w.x0)},${Math.round(w.y0)},${Math.round(w.x1)},${Math.round(w.y1)}`;
    if (vectorInflight.has(key)) return;
    vectorInflight.add(key);
    const canvas = document.createElement('canvas');
    void renderPdfPageVector(page, notebook, canvas, vectorRaster, pageW, windowedNow ? w : undefined)
      .then((ok) => {
        vectorInflight.delete(key);
        if (!ok) return;
        // discard a stale render (raster/window moved on while we worked)
        if (Math.abs(vectorRaster - rasterRef.current) > 0.34 || !sameWin(w, winRef.current)) return;
        putVectorCanvas(page.id, vectorRaster, w, canvas);
        setVectorTick((v) => v + 1);
      })
      .catch(() => { vectorInflight.delete(key) });
  }, [page, pageW, layout, win, rasterTick, infinite]);

  // canvas placement in world space: local (win.x0, win.y0) sits at world
  // (win.x0, layout.y + win.y0) — the page's local origin (0,0) stays glued
  // to world (0, layout.y) forever (content coordinates never move).
  const styleLeft = win.x0;
  const styleTop = layout.y + win.y0;
  const styleW = Math.max(2, win.x1 - win.x0);
  const styleH = Math.max(2, win.y1 - win.y0);

  return (
    <>
      {/* windowed fixed pages: the page shadow rides a frame div (the canvas
          box is only the visible slice, so its own shadow would be wrong) */}
      {!infinite && windowed ? (
        <div
          aria-hidden
          className="pointer-events-none absolute shadow-ink-2"
          style={{
            left: -layout.padX,
            top: layout.y - layout.padY,
            width: layout.w,
            height: layout.h,
            borderRadius: 4,
          }}
        />
      ) : null}
      <canvas
        ref={canvasRef}
        className={infinite || windowed ? 'absolute' : 'absolute shadow-ink-2'}
        style={{
          left: styleLeft,
          top: styleTop,
          width: styleW,
          height: styleH,
          ...(infinite || windowed
            ? { borderRadius: 0, outline: 'none' }
            : { borderRadius: 4, outline: '1px solid rgba(22,35,58,0.10)' }),
          touchAction: 'none',
        }}
        aria-hidden
      />
    </>
  );
}

// PERF: memoized — EditorShell re-renders on every container-size state tick
// (window resize, split-divider drags); without this memo each tick re-ran
// every mounted page component (and their layout effects) for nothing.
export default memo(PageCanvas);
