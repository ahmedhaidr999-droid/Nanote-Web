'use client';
// Ruler — draggable, rotatable on-screen ruler; ink snaps to its edge.
import { useRef } from 'react';
import { useT } from '@/lib/nanote/store';
import { ruler, useVp, worldToScreen, getVp } from './viewport';

export function Ruler() {
  const vp = useVp();
  const { t } = useT();
  const dragRef = useRef<'move' | 'rotate' | null>(null);
  if (!ruler.visible) return null;

  const c = worldToScreen(ruler.cx, ruler.cy);
  const w = Math.max(120, ruler.len * vp.scale);
  const h = Math.max(26, Math.min(56, 44 * vp.scale));

  const startMove = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = 'move';
    const last = { x: e.clientX, y: e.clientY };
    const onMove = (ev: PointerEvent) => {
      if (dragRef.current !== 'move') return;
      const scale = getVp().scale;
      ruler.cx += (ev.clientX - last.x) / scale;
      ruler.cy += (ev.clientY - last.y) / scale;
      last.x = ev.clientX; last.y = ev.clientY;
      // force repaint of this component via vp emit (cheap trick)
      const el = document.getElementById('nanote-ruler');
      if (el) {
        const nc = worldToScreen(ruler.cx, ruler.cy);
        el.style.left = `${nc.x}px`;
        el.style.top = `${nc.y}px`;
      }
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startRotate = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = 'rotate';
    const onMove = (ev: PointerEvent) => {
      if (dragRef.current !== 'rotate') return;
      const dx = ev.clientX - c.x, dy = ev.clientY - c.y;
      let ang = Math.atan2(dy, dx);
      if (ev.shiftKey) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12);
      ruler.angle = ang;
      const el = document.getElementById('nanote-ruler');
      if (el) el.style.transform = `translate(-50%, -50%) rotate(${(ang * 180) / Math.PI}deg)`;
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div
      id="nanote-ruler"
      className="absolute z-30 cursor-grab touch-none select-none"
      style={{
        left: c.x,
        top: c.y,
        width: w,
        height: h,
        transform: `translate(-50%, -50%) rotate(${(ruler.angle * 180) / Math.PI}deg)`,
        pointerEvents: 'auto',
      }}
      onPointerDown={startMove}
      role="slider"
      aria-label={t('tool.ruler')}
      aria-orientation="horizontal"
      aria-valuemin={-180}
      aria-valuemax={180}
      aria-valuenow={Math.round((ruler.angle * 180) / Math.PI)}
    >
      {/* body */}
      <div
        className="h-full w-full rounded-md border border-white/60 shadow-ink-2"
        style={{
          background:
            'repeating-linear-gradient(to right, rgba(22,35,58,0.55) 0 1.5px, transparent 1.5px 12px), rgba(247,249,252,0.75)',
          backdropFilter: 'blur(2px)',
        }}
      />
      {/* edge line */}
      <div className="absolute inset-x-0 top-0 h-[3px] rounded-full bg-primary" />
      {/* rotate handle */}
      <button
        type="button"
        aria-label={t('tool.image.rotate')}
        onPointerDown={startRotate}
        className="absolute -end-4 top-1/2 h-7 w-7 -translate-y-1/2 rounded-full border-2 border-white bg-primary shadow-ink-1"
      />
      {/* center pivot */}
      <div className="absolute start-1.5 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-primary" />
    </div>
  );
}
