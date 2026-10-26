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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/lib/nanote/store';
import { renderPage } from '@/lib/nanote/render';
import { preloadPageImages, resolveImage, imageNatural } from '@/lib/nanote/images';
import { renderPdfPageVector } from '@/lib/nanote/pdftext';
import { getCachedRaster, putCachedRaster } from '@/lib/nanote/rastercache';
import { PageRow } from '@/lib/nanote/types';
import { getHiddenIds, onRepaint, onVpIdle, getVp } from './viewport';

/** memory guard: never rasterize a page beyond ~32M pixels (~128MB RGBA) */
const MAX_RASTER_PIXELS = 32e6;
/** upper bound of the raster scale (device pixels per ink unit) */
const MAX_RASTER = 5;

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
  worldY,
  pageW,
  pageH,
}: {
  page: PageRow;
  worldY: number;
  pageW: number;
  pageH: number;
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
    const raster = rasterRef.current;
    const w = Math.max(2, Math.round(pageW * raster));
    const h = Math.max(2, Math.round(pageH * raster));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(raster, 0, 0, raster, 0, 0);
    const vector = page.backgroundImageId != null
      ? getVectorCanvas(page.id, Math.round(raster * 20) / 20)
      : null;
    const hidden = getHiddenIds(page.id);
    renderPage(ctx, page, doc ?? null, pageW, pageH, {
      gamma,
      highlighterOpacity: hiOpacity,
      resolveImage,
      imageNatural,
      hideIds: hidden,
      ...(vector ? { backgroundOverride: { source: vector, w: vector.width, h: vector.height } } : {}),
      ...audioOptsRef.current,
    });
    // persist for instant re-opens — but NEVER while transient element hides
    // are active (selection/move previews): that render is incomplete.
    if (!hidden || hidden.size === 0) {
      void putCachedRaster(
        { pageId: page.id, docVersion, raster, pageW, pageH, gamma, hiOpacity },
        canvas,
      );
    }
  }, [page, doc, docVersion, gamma, hiOpacity, pageW, pageH]);

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
    const cacheable = tryCache && (!hidden || hidden.size === 0);
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
  }, [page.id, docVersion, gamma, hiOpacity, pageW, pageH, paintFromBitmap, paintFromDoc]);

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
  useEffect(() => {
    const maybeReRaster = () => {
      idleScheduledRef.current = 0;
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
  }, [pageW, pageH]);

  // ---- vector background render (async; re-renders when the raster bucket
  // changes and lands on the next paint — the PNG snapshot shows meanwhile)
  useEffect(() => {
    if (page.backgroundImageId == null) return;
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
  }, [page, pageW, rasterTick]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute shadow-ink-2"
      style={{
        left: 0,
        top: worldY,
        width: pageW,
        height: pageH,
        borderRadius: 4,
        outline: '1px solid rgba(22,35,58,0.10)',
        touchAction: 'none',
      }}
      aria-hidden
    />
  );
}
