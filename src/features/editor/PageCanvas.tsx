'use client';
// PageCanvas — one page rasterized to a canvas; the world container applies
// zoom/pan, this canvas only re-rasterizes (debounced) when zoom settles.
// Re-renders on doc changes, transient eraser hides and audio sync playback.
//
// Sharp-text zoom (Notewise-style): pages imported from a PDF whose ORIGINAL
// file is stored get their background re-rendered VECTOR from that original
// at the current raster scale (pdf.js) — text stays crisp at high zoom
// instead of upscaling the ~2x import snapshot. A small module-level LRU
// keeps the two most recently rendered vector canvases alive; everything
// else falls back to the stored PNG.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/lib/nanote/store';
import { renderPage } from '@/lib/nanote/render';
import { preloadPageImages, resolveImage, imageNatural } from '@/lib/nanote/images';
import { renderPdfPageVector } from '@/lib/nanote/pdftext';
import { PageRow } from '@/lib/nanote/types';
import { clamp } from '@/lib/nanote/util';
import { getHiddenIds, onRepaint, useVp } from './viewport';

/** memory guard: never rasterize a page beyond ~32M pixels (~128MB RGBA) */
const MAX_RASTER_PIXELS = 32e6;
/** upper bound of the raster scale (device pixels per ink unit) */
const MAX_RASTER = 5;

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
  const vp = useVp();
  const doc = useApp((s) => s.editor.docs[page.id]);
  const docVersion = useApp((s) => s.editor.docVersions[page.id] ?? 0);
  const gamma = useApp((s) => s.settings.pressureCurve);
  const audio = useApp((s) => s.editor.audio);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rasterTick, setRasterTick] = useState(0);
  const rasterRef = useRef(1);
  // vector background state: null = use the stored PNG snapshot
  const [vectorTick, setVectorTick] = useState(0);
  const vectorVersionRef = useRef(0);

  // raster scale follows zoom (debounced buckets to avoid re-raster every frame)
  const desiredRaster = useMemo(
    () => {
      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      const raw = clamp(vp.scale * dpr, 0.5, MAX_RASTER);
      // memory guard for very tall pages
      const byPixels = Math.sqrt(MAX_RASTER_PIXELS / (pageW * pageH));
      return Math.min(raw, Math.max(0.5, byPixels));
    },
    [vp.scale, pageW, pageH],
  );
  useEffect(() => {
    if (Math.abs(desiredRaster - rasterRef.current) / rasterRef.current < 0.15) return;
    const t = setTimeout(() => {
      rasterRef.current = desiredRaster;
      setRasterTick((v) => v + 1);
    }, 130);
    return () => clearTimeout(t);
  }, [desiredRaster]);

  // lazy-load doc + referenced images
  useEffect(() => {
    void useApp.getState().ensureDoc(page.id);
  }, [page.id]);
  useEffect(() => {
    void preloadPageImages(page, doc ?? null).then(() => setRasterTick((v) => v + 1));
  }, [page, doc]);

  const audioMode: 'off' | 'highlight' | 'replay' =
    !audio.playing || !audio.recId ? 'off' : audio.replay ? 'replay' : audio.sync ? 'highlight' : 'off';
  const audioOpts = useMemo(
    () => (audioMode !== 'off' ? { audio: { recId: audio.recId as string, tMs: audio.tMs, mode: audioMode as 'highlight' | 'replay' } } : {}),
    [audioMode, audio.recId, audio.tMs],
  );

  // ---- vector background render (async; re-renders when the raster bucket
  // changes and lands on the next paint — the PNG snapshot shows meanwhile)
  const vectorRaster = Math.round(desiredRaster * 20) / 20; // stable bucket key
  const canVector = page.backgroundImageId != null;
  useEffect(() => {
    if (!canVector) return;
    const st = useApp.getState();
    const notebook = st.notebooks.find((n) => n.id === page.notebookId);
    if (!notebook?.pdfOriginalId) return;
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
        if (Math.abs(vectorRaster - (rasterRef.current)) > 0.34) return;
        putVectorCanvas(page.id, vectorRaster, canvas);
        vectorVersionRef.current += 1;
        setVectorTick((v) => v + 1);
      })
      .catch(() => { vectorInflight.delete(key) });
  }, [canVector, page, pageW, vectorRaster, rasterTick]);

  const paint = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const raster = rasterRef.current;
    const w = Math.max(2, Math.round(pageW * raster));
    const h = Math.max(2, Math.round(pageH * raster));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(raster, 0, 0, raster, 0, 0);
    const vector = canVector ? getVectorCanvas(page.id, vectorRaster) : null;
    renderPage(ctx, page, doc ?? null, pageW, pageH, {
      gamma,
      resolveImage,
      imageNatural,
      hideIds: getHiddenIds(page.id),
      ...(vector ? { backgroundOverride: { source: vector, w: vector.width, h: vector.height } } : {}),
      ...audioOpts,
    });
  };

  // main render
  useEffect(paint, [page, doc, docVersion, rasterTick, vectorTick, gamma, pageW, pageH, audioOpts]);

  // transient repaints (eraser preview, selection drags hiding originals)
  useEffect(() => onRepaint(paint), [page, doc, gamma, pageW, pageH, audioOpts]);

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
