'use client';
// LiveOverlay — single full-viewport canvas that paints registered painters
// (in-progress strokes, lasso paths, shape previews, selection drags, cursors).
import { useEffect, useRef } from 'react';
import { getPainters, getVp, onOverlayRepaint, subscribeVp } from './viewport';

export default function LiveOverlay() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const parent = canvas.parentElement!;
    let raf = 0;

    const paint = () => {
      raf = 0;
      const dpr = window.devicePixelRatio || 1;
      const w = parent.clientWidth, h = parent.clientHeight;
      if (!w || !h) return;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const vp = getVp();
      for (const p of getPainters()) p(ctx, vp);
    };

    const schedule = () => { if (!raf) raf = requestAnimationFrame(paint) };

    const ro = new ResizeObserver(schedule);
    ro.observe(parent);
    const offOverlay = onOverlayRepaint(schedule);
    const offVp = subscribeVp(schedule);
    schedule();
    return () => {
      ro.disconnect();
      offOverlay();
      offVp();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return <canvas ref={ref} className="pointer-events-none absolute inset-0 z-20" aria-hidden />;
}
