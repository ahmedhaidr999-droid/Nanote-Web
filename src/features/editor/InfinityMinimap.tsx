'use client';
// InfinityMinimap — a small optional overview of the endless sheet (Concepts
// style). Shows the whole content at a glance: paper box, ink strokes, text /
// shape / image footprints — plus a live rectangle for the current viewport.
// Click or drag anywhere on it to jump to that spot instantly.
// PERF: the content layer repaints only when the document actually changes;
// the viewport rectangle is a transformed overlay div updated on every vp
// frame (no canvas redraw while panning).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/lib/nanote/store';
import { elementBBox } from '@/lib/nanote/geometry';
import type { PageRow } from '@/lib/nanote/types';
import type { PageLayout } from './viewport';
import { getVp, getViewportSize, setVp, subscribeVp } from './viewport';

const MM_W = 176;  // css px
const MM_H = 112;

interface Frame { x0: number; y0: number; x1: number; y1: number }

/** content bounds in WORLD coords: every element + the sheet box, with margin */
function contentFrame(page: PageRow, layout: PageLayout, doc: { elements: { id: string }[] } | null): Frame {
  let x0 = -layout.padX, y0 = layout.y - layout.padY;
  let x1 = layout.w - layout.padX, y1 = layout.y - layout.padY + layout.h;
  const els = (doc?.elements ?? []) as Parameters<typeof elementBBox>[0][];
  let ex0 = Infinity, ey0 = Infinity, ex1 = -Infinity, ey1 = -Infinity;
  for (const el of els) {
    const b = elementBBox(el);
    if (b.x0 < ex0) ex0 = b.x0;
    if (b.y0 < ey0) ey0 = b.y0;
    if (b.x1 > ex1) ex1 = b.x1;
    if (b.y1 > ey1) ey1 = b.y1;
  }
  if (ex0 !== Infinity) {
    x0 = Math.min(x0, ex0); y0 = Math.min(y0, ey0);
    x1 = Math.max(x1, ex1); y1 = Math.max(y1, ey1);
  }
  // margin so lone far-out strokes don't crush the overview
  const mx = (x1 - x0) * 0.06 + 24;
  const my = (y1 - y0) * 0.06 + 24;
  return { x0: x0 - mx, y0: y0 - my, x1: x1 + mx, y1: y1 + my };
}

export function InfinityMinimap({ page, layout }: { page: PageRow; layout: PageLayout }) {
  const doc = useApp((s) => s.editor.docs[page.id]);
  const docVersion = useApp((s) => s.editor.docVersions[page.id] ?? 0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vpRectRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: MM_W, h: MM_H });

  const frame = useMemo(
    () => contentFrame(page, layout, doc),
    [page, layout, doc, docVersion],
  );
  const frameRef = useRef(frame);
  useEffect(() => { frameRef.current = frame }, [frame]);

  // -------------------------------------------------- content layer (canvas)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = box.w, h = box.h;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const f = frame;
    const s = Math.min(w / (f.x1 - f.x0), h / (f.y1 - f.y0));
    const ox = (w - (f.x1 - f.x0) * s) / 2;
    const oy = (h - (f.y1 - f.y0) * s) / 2;
    const X = (wx: number) => (wx - f.x0) * s + ox;
    const Y = (wy: number) => (wy - f.y0) * s + oy;

    // backdrop
    ctx.clearRect(0, 0, w, h);

    // the sheet box (page-local [-padX, width] × [-padY, height] → world)
    const sheet = {
      x: X(-layout.padX), y: Y(layout.y - layout.padY),
      w: (layout.w - 0) * s, h: layout.h * s,
    };
    ctx.fillStyle = page.backgroundHex || '#FFFFFF';
    ctx.fillRect(sheet.x, sheet.y, sheet.w, sheet.h);
    ctx.strokeStyle = 'rgba(22,35,58,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(sheet.x, sheet.y, sheet.w, sheet.h);

    // elements — simple polylines / footprints (cheap overview, not a raster)
    const els = doc?.elements ?? [];
    for (const el of els) {
      if (el.kind === 'stroke') {
        ctx.strokeStyle = el.color;
        ctx.globalAlpha = el.tool === 'highlighter' ? 0.5 : 0.85;
        ctx.lineWidth = Math.max(0.5, Math.min(3, el.width * s));
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (let i = 0; i < el.points.length; i++) {
          const p = el.points[i];
          if (i === 0) ctx.moveTo(X(p.x), Y(p.y + layout.y));
          else ctx.lineTo(X(p.x), Y(p.y + layout.y));
        }
        if (el.points.length === 1) {
          const p = el.points[0];
          ctx.arc(X(p.x), Y(p.y + layout.y), 0.8, 0, Math.PI * 2);
          ctx.fillStyle = el.color;
          ctx.fill();
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else {
        const b = elementBBox(el);
        ctx.fillStyle = el.kind === 'text' ? el.color : el.kind === 'shape' ? (el.fill ?? el.stroke) : '#94A3B8';
        ctx.globalAlpha = 0.8;
        ctx.fillRect(X(b.x0), Y(b.y0 + layout.y), Math.max(1, (b.x1 - b.x0) * s), Math.max(1, (b.y1 - b.y0) * s));
        ctx.globalAlpha = 1;
      }
    }
  }, [frame, doc, layout, page, box]);

  // -------------------------------------------------- viewport rect (live div)
  useEffect(() => {
    const apply = () => {
      const el = vpRectRef.current;
      if (!el) return;
      const f = frameRef.current;
      const vp = getVp();
      const { w, h } = { w: box.w, h: box.h };
      const s = Math.min(w / (f.x1 - f.x0), h / (f.y1 - f.y0));
      const ox = (w - (f.x1 - f.x0) * s) / 2;
      const oy = (h - (f.y1 - f.y0) * s) / 2;
      // visible world rect → minimap px
      const vx0 = (0 - vp.tx) / vp.scale, vy0 = (0 - vp.ty) / vp.scale;
      const vx1 = (getViewportSize().w - vp.tx) / vp.scale, vy1 = (getViewportSize().h - vp.ty) / vp.scale;
      el.style.transform = `translate(${(vx0 - f.x0) * s + ox}px, ${(vy0 - f.y0) * s + oy}px)`;
      el.style.width = `${Math.max(3, (vx1 - vx0) * s)}px`;
      el.style.height = `${Math.max(3, (vy1 - vy0) * s)}px`;
    };
    apply();
    const off = subscribeVp(apply);
    const ro = new ResizeObserver(() => {
      const host = canvasRef.current?.parentElement;
      if (host) setBox({ w: host.clientWidth, h: host.clientHeight });
    });
    if (canvasRef.current?.parentElement) ro.observe(canvasRef.current.parentElement);
    return () => { off(); ro.disconnect() };
  }, [box, frame]);

  // -------------------------------------------------- click / drag to navigate
  const navTo = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    const f = frameRef.current;
    const s = Math.min(box.w / (f.x1 - f.x0), box.h / (f.y1 - f.y0));
    const ox = (box.w - (f.x1 - f.x0) * s) / 2;
    const oy = (box.h - (f.y1 - f.y0) * s) / 2;
    const wx = (clientX - r.left - ox) / s + f.x0;
    const wy = (clientY - r.top - oy) / s + f.y0;
    const { w: cw, h: ch } = getViewportSize();
    const vp = getVp();
    setVp({ tx: cw / 2 - wx * vp.scale, ty: ch / 2 - wy * vp.scale });
  };

  const dragging = useRef(false);
  return (
    <div
      className="relative cursor-pointer touch-none overflow-hidden rounded-xl border border-border bg-card/95 shadow-ink-2 backdrop-blur"
      style={{ width: MM_W, height: MM_H }}
      aria-label="Minimap"
      onPointerDown={(e) => { dragging.current = true; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); navTo(e.clientX, e.clientY) }}
      onPointerMove={(e) => { if (dragging.current) navTo(e.clientX, e.clientY) }}
      onPointerUp={() => { dragging.current = false }}
      onPointerCancel={() => { dragging.current = false }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <div
        ref={vpRectRef}
        className="pointer-events-none absolute left-0 top-0 rounded-[3px] border-2 border-primary/80 bg-primary/10"
      />
    </div>
  );
}
