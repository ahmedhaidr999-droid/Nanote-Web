'use client';
// PageCanvas — one page rasterized to a canvas; the world container applies
// zoom/pan, this canvas only re-rasterizes (debounced) when zoom settles.
// Re-renders on doc changes, transient eraser hides and audio sync playback.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/lib/nanote/store';
import { renderPage } from '@/lib/nanote/render';
import { preloadPageImages, resolveImage, imageNatural } from '@/lib/nanote/images';
import { PageRow } from '@/lib/nanote/types';
import { clamp } from '@/lib/nanote/util';
import { getHiddenIds, onRepaint, useVp } from './viewport';

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

  // raster scale follows zoom (debounced buckets to avoid re-raster every frame)
  const desiredRaster = useMemo(
    () => clamp(vp.scale * (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1), 0.5, 3),
    [vp.scale],
  );
  useEffect(() => {
    if (Math.abs(desiredRaster - rasterRef.current) / rasterRef.current < 0.22) return;
    const t = setTimeout(() => {
      rasterRef.current = desiredRaster;
      setRasterTick((v) => v + 1);
    }, 170);
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
    renderPage(ctx, page, doc ?? null, pageW, pageH, {
      gamma,
      resolveImage,
      imageNatural,
      hideIds: getHiddenIds(page.id),
      ...audioOpts,
    });
  };

  // main render
  useEffect(paint, [page, doc, docVersion, rasterTick, gamma, pageW, pageH, audioOpts]);

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
