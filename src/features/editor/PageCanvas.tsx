'use client';
// PageCanvas — one page rasterized to a canvas.
// PERFORMANCE MODEL (the fix for heavy/laggy pinch-zoom navigation):
//   • This component NEVER re-renders in React while the viewport moves — it
//     does not subscribe to vp state at all. The world container applies the
//     zoom/pan transform (CSS/GPU) and the existing bitmap simply scales.
//   • Re-rasterization happens ONLY after the gesture settles (vp idle for
//     ~280ms via onVpIdle), only when the raster bucket actually changed
//     (≥1.3× apart), and only one page per animation frame (global queue) —
//     so zooming stays smooth and the settle pass never stutters the UI.
//   • Rendered bitmaps are persisted in the device's Cache Storage
//     (rastercache.ts) keyed by doc version + bucket — re-opening a notebook
//     paints instantly without re-rendering PDF backgrounds and ink. The
//     cache is bypassed while transient element hides are active (selection
//     drags) so it can never be poisoned by an incomplete render.
//
// Sharp-text zoom (Notewise-style): pages imported from a PDF whose ORIGINAL
// file is stored get their background re-rendered VECTOR from that original
// at the current raster scale (pdf.js) — text stays crisp at high zoom
// instead of upscaling the ~2x import snapshot. A small module-level LRU
// keeps the two most recently rendered vector canvases alive; everything
// else falls back to the stored PNG.
//
// INFINITY PAPER (Concepts-style): instead of rasterizing the whole sheet
// (which would die once the endless canvas outgrows any bitmap), the canvas
// renders a WINDOW around the current viewport — paper + seamless background
// pattern + ONLY the elements inside the slice (culling in render.ts). The
// window follows the view on gesture-settle, so the sheet is effectively
// unbounded in all four directions while the bitmap stays viewport-sized.
// Raster-cache is SKIPPED for infinite windows (they move with the viewport,
// caching them is pointless) and there is no border/shadow — seamless paper.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/lib/nanote/store';
import { renderPage } from '@/lib/nanote/render';
import { preloadPageImages, resolveImage, imageNatural } from '@/lib/nanote/images';
import { renderPdfPageVector } from '@/lib/nanote/pdftext';
import { getCachedRaster, putCachedRaster } from '@/lib/nanote/rastercache';
import { PageRow } from '@/lib/nanote/types';
import { clamp } from '@/lib/nanote/util';
import { getHiddenIds, onRepaint, onVpIdle, getVp, getViewportSize, visibleWorldRect } from './viewport';
import type { PageLayout } from './viewport';

/** memory guard: never rasterize a page beyond ~32M pixels (~128MB RGBA) */
const MAX_RASTER_PIXELS = 32e6;
/** upper bound of the raster scale (device pixels per ink unit) */
const MAX_RASTER = 5;
// cap the window bitmap so extreme zoom-outs never blow the canvas budget
const MAX_BITMAP_DIM = 4096;

// one page re-raster per animation frame, globally
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

/** pick the raster bucket for a scale: coarse buckets, capped, memory-guarded */
function bucketFor(scale: number, pageW: number, pageH: number): number {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const raw = Math.min(Math.max(0.5, scale * dpr), MAX_RASTER);
  // memory guard for very tall pages
  const byPixels = Math.sqrt(MAX_RASTER_PIXELS / (pageW * pageH));
  return Math.min(raw, Math.max(0.5, byPixels));
}

export interface Win { x0: number; y0: number; x1: number; y1: number }

/** the full padded page box in page-local coordinates */
function fullWin(l: PageLayout): Win {
  return { x0: -l.padX, y0: -l.padY, x1: l.w - l.padX, y1: l.h - l.padY };
}

/**
 * Infinity paper: the render window ≈ the visible viewport expanded by ~80%
 * on every side (so panning keeps showing rendered paper), rounded to a
 * coarse grid to avoid churn. Unclamped — the sheet has no edges.
 */
function viewportWin(l: PageLayout): Win {
  const vis = visibleWorldRect();
  const { w: cw, h: ch } = getViewportSize();
  const mx = Math.max(320, cw * 0.8);
  const my = Math.max(320, ch * 0.8);
  const G = 128; // grid rounding — keeps re-renders sparse
  const r = (v: number) => Math.floor(v / G) * G;
  return {
    x0: r(vis.x0 - mx),
    y0: r(vis.y0 - l.y - my),
    x1: r(vis.x1 + mx),
    y1: r(vis.y1 - l.y + my),
  };
}

function winChanged(a: Win, b: Win): boolean {
  return Math.abs(a.x0 - b.x0) > 64 || Math.abs(a.y0 - b.y0) > 64 || Math.abs(a.x1 - b.x1) > 64 || Math.abs(a.y1 - b.y1) > 64;
}

interface VectorEntry {
  pageId: string;
  raster: number;
  canvas: HTMLCanvasElement;
}
const vectorLru: VectorEntry[] = [];
const VECTOR_LRU_MAX = 2;
const vectorInflight = new Set<string>();

function getVectorCanvas(pageId: string, raster: number): HTMLCanvasElement | null {
  const hit = vectorLru.find((v) => v.pageId === pageId && Math.abs(v.raster - raster) < 0.01);
  if (!hit) return null;
  // refresh LRU position
  vectorLru.splice(vectorLru.indexOf(hit), 1);
  vectorLru.push(hit);
  return hit.canvas;
}

function putVectorCanvas(pageId: string, raster: number, canvas: HTMLCanvasElement): void {
  vectorLru.push({ pageId, raster, canvas });
  while (vectorLru.length > VECTOR_LRU_MAX) vectorLru.shift();
}

export default function PageCanvas({
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
  const idleScheduledRef = useRef(0);
  // vector background state: null = use the stored PNG snapshot
  const [vectorTick, setVectorTick] = useState(0);
  const [rasterTick, setRasterTick] = useState(0);

  const pageW = layout.w;   // full padded width
  const pageH = layout.h;   // full padded height

  // render window: fixed pages = the full box (exactly the old behavior);
  // infinity paper = a slice following the viewport
  const [win, setWin] = useState<Win>(() => (infinite ? viewportWin(layout) : fullWin(layout)));
  const winRef = useRef(win);
  useEffect(() => { winRef.current = win }, [win]);

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
    const w = winRef.current;
    const ww = Math.max(2, w.x1 - w.x0);
    const wh = Math.max(2, w.y1 - w.y0);
    // raster: the zoom bucket, capped so huge slices never exceed the bitmap budget
    let raster = clamp(bucketFor(getVp().scale, ww, wh), 0.25, MAX_RASTER);
    raster = Math.min(raster, MAX_BITMAP_DIM / Math.max(ww, wh));
    rasterRef.current = raster;
    const bw = Math.max(2, Math.round(ww * raster));
    const bh = Math.max(2, Math.round(wh * raster));
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(raster, 0, 0, raster, -w.x0 * raster, -w.y0 * raster);
    const vector = !infinite && page.backgroundImageId != null
      ? getVectorCanvas(page.id, Math.round(raster * 20) / 20)
      : null;
    const hidden = getHiddenIds(page.id);
    renderPage(ctx, page, doc ?? null, w.x1, w.y1, {
      gamma,
      highlighterOpacity: hiOpacity,
      resolveImage,
      imageNatural,
      hideIds: hidden,
      win: w,
      infinite,
      ...(vector ? { backgroundOverride: { source: vector, w: vector.width, h: vector.height } } : {}),
      ...audioOptsRef.current,
    });
    // persist for instant re-opens — but NEVER while transient element hides
    // are active (selection/move previews): that render is incomplete.
    // Infinity-paper windows move with the viewport — caching them is
    // pointless (culling makes fresh renders cheap), so only fixed pages cache.
    if (!infinite && (!hidden || hidden.size === 0)) {
      void putCachedRaster(
        { pageId: page.id, docVersion, raster, pageW, pageH, gamma, hiOpacity },
        canvas,
      );
    }
  }, [page, doc, docVersion, gamma, hiOpacity, pageW, pageH, infinite]);

  /** draw a cached bitmap (instant path) */
  const paintFromBitmap = useCallback((bmp: ImageBitmap) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const raster = rasterRef.current;
    const w = Math.max(2, Math.round(pageW * raster));
    const h = Math.max(2, Math.round(pageH * raster));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0);
    ctx.imageSmoothingEnabled = true;
  }, [pageW, pageH]);

  const requestPaint = useCallback(async (tryCache = true) => {
    const token = ++tokenRef.current;
    const hidden = getHiddenIds(page.id);
    const cacheable = tryCache && !infinite && (!hidden || hidden.size === 0);
    if (cacheable) {
      const bmp = await getCachedRaster(
        { pageId: page.id, docVersion, raster: rasterRef.current, pageW, pageH, gamma, hiOpacity },
      );
      if (token === tokenRef.current && bmp && canvasRef.current) {
        paintFromBitmap(bmp);
        return;
      }
      if (token !== tokenRef.current) return; // superseded
    }
    if (token !== tokenRef.current) return;
    paintFromDoc();
  }, [page.id, docVersion, gamma, hiOpacity, pageW, pageH, infinite, paintFromBitmap, paintFromDoc]);

  // referenced images load async → repaint when they arrive
  useEffect(() => {
    void preloadPageImages(page, doc ?? null).then(() => { void requestPaint() });
  }, [page, doc, requestPaint]);

  // content changes → full paint (doc/image load, undo/redo, bucket change,
  // vector bg arrival, highlighter opacity, audio sync)
  useEffect(() => {
    void requestPaint(true);
  }, [requestPaint, rasterTick, vectorTick]);

  // transient repaints (eraser preview, selection drags hiding originals)
  // — direct doc paint, never the cache (the render is intentionally partial).
  // PERF: only the page whose hidden set actually changed re-renders — an
  // erase sweep on page 3 must not re-raster pages 1 and 2 too. The sentinel
  // (undefined) after a paintFromDoc identity change guarantees one paint
  // whenever the doc/content changed, so nothing ever ends up stale.
  const lastHiddenSigRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
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
  // re-rasterizing to a sharper bucket. Never during the gesture itself.
  // Infinity paper: the idle pass also re-centers the render window on the
  // viewport (pan/zoom settles → fresh crisp slice).
  useEffect(() => {
    const maybeReRaster = () => {
      idleScheduledRef.current = 0;
      if (infinite) {
        // re-center the window on the viewport; only actually re-render when
        // it moved beyond the grid slack or the raster bucket changed ≥1.3×
        const desired = viewportWin(layout);
        const raster = clamp(bucketFor(getVp().scale, pageW, pageH), 0.25, MAX_RASTER);
        const ratio = raster / rasterRef.current;
        if (winChanged(desired, winRef.current) || ratio > 1.3 || ratio < 1 / 1.3) {
          setWin(desired);
        }
        return;
      }
      const desired = bucketFor(getVp().scale, pageW, pageH);
      const current = rasterRef.current;
      const ratio = desired / current;
      if (ratio > 1.3 || ratio < 1 / 1.3) {
        rasterRef.current = desired;
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
  // changes and lands on the next paint — the PNG snapshot shows meanwhile)
  useEffect(() => {
    if (infinite || page.backgroundImageId == null) return;
    const st = useApp.getState();
    const notebook = st.notebooks.find((n) => n.id === page.notebookId);
    if (!notebook?.pdfOriginalId) return;
    const vectorRaster = Math.round(rasterRef.current * 20) / 20; // stable bucket key
    if (getVectorCanvas(page.id, vectorRaster)) return; // already rendered
    const key = `${page.id}@${vectorRaster}`;
    if (vectorInflight.has(key)) return;
    vectorInflight.add(key);
    const canvas = document.createElement('canvas');
    void renderPdfPageVector(page, notebook, canvas, vectorRaster, pageW)
      .then((ok) => {
        vectorInflight.delete(key);
        if (!ok) return;
        // discard a stale render (raster moved on while we worked)
        if (Math.abs(vectorRaster - rasterRef.current) > 0.34) return;
        putVectorCanvas(page.id, vectorRaster, canvas);
        setVectorTick((v) => v + 1);
      })
      .catch(() => { vectorInflight.delete(key) });
  }, [page, pageW, rasterTick, infinite]);

  // canvas placement in world space: local (win.x0, win.y0) sits at world
  // (win.x0, layout.y + win.y0) — the page's local origin (0,0) stays glued
  // to world (0, layout.y) forever (content coordinates never move).
  const styleLeft = win.x0;
  const styleTop = layout.y + win.y0;
  const styleW = Math.max(2, win.x1 - win.x0);
  const styleH = Math.max(2, win.y1 - win.y0);

  return (
    <canvas
      ref={canvasRef}
      className={infinite ? 'absolute' : 'absolute shadow-ink-2'}
      style={{
        left: styleLeft,
        top: styleTop,
        width: styleW,
        height: styleH,
        ...(infinite
          ? { borderRadius: 0, outline: 'none' }
          : { borderRadius: 4, outline: '1px solid rgba(22,35,58,0.10)' }),
        touchAction: 'none',
      }}
      aria-hidden
    />
  );
}
