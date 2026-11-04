// Laser pointer — ephemeral presentation ink. Two modes:
//   • normal — a comet trail: each point fades ~0.6s after it was drawn
//   • trail  — the whole stroke stays visible for a set duration (1..10s),
//              then fades out (Notewise-style persistent trail)
// The laser color is fully customizable (see Settings.laser / LaserPopover)
// and travels with each stroke. Laser ink is NEVER committed to the document;
// it lives only on the live overlay and disappears on its own.
import { requestOverlayRepaint } from './viewport';
import { hexToRgb } from '@/lib/nanote/util';

export interface LaserPoint { x: number; y: number; t: number }

export interface LaserStroke {
  pageY: number;
  pts: LaserPoint[];
  mode: 'normal' | 'trail';
  trailMs: number; // seconds (1..10) — the UI slider works in seconds
  color: string; // hex — custom laser color
}

const NORMAL_FADE_MS = 600;
const TRAIL_FADE_MS = 800;
/** trailMs is stored in SECONDS (1..10 slider) — convert once per stroke */
const holdMs = (s: LaserStroke) => Math.max(0, s.trailMs) * 1000;

const strokes: LaserStroke[] = [];
let loopRaf = 0;

/** rgb cache: hex → "r,g,b" (set once per stroke, string-built per frame) */
const rgbCache = new Map<string, string>();
function rgbStr(hex: string): string {
  let v = rgbCache.get(hex);
  if (!v) {
    const [r, g, b] = hexToRgb(hex);
    v = `${r},${g},${b}`;
    if (rgbCache.size > 64) rgbCache.clear();
    rgbCache.set(hex, v);
  }
  return v;
}

export function addLaserStroke(s: LaserStroke) {
  strokes.push(s);
  if (strokes.length > 24) strokes.shift();
  startLoop();
  requestOverlayRepaint();
}

export function clearLaser() {
  strokes.length = 0;
  requestOverlayRepaint();
}

/** distinct page offsets that currently have laser ink (for the painter) */
export function laserStrokePages(): number[] {
  const pages = new Set<number>();
  for (const s of strokes) pages.add(s.pageY);
  return [...pages];
}

/** stroke fully faded? */
function dead(s: LaserStroke, now: number): boolean {
  if (!s.pts.length) return true;
  const endT = s.pts[s.pts.length - 1].t;
  if (s.mode === 'normal') return now - endT > NORMAL_FADE_MS;
  return now - endT > holdMs(s) + TRAIL_FADE_MS;
}

function startLoop() {
  if (loopRaf) return;
  const tick = () => {
    const now = performance.now();
    for (let i = strokes.length - 1; i >= 0; i--) {
      if (dead(strokes[i], now)) strokes.splice(i, 1);
    }
    requestOverlayRepaint();
    loopRaf = strokes.length ? requestAnimationFrame(tick) : 0;
  };
  loopRaf = requestAnimationFrame(tick);
}

/**
 * Paint all live laser strokes. Assumes the ctx is already translated to the
 * page origin and scaled (page-space painting). Each stroke keeps its own
 * color (customizable from the laser popover).
 */
export function drawLaser(ctx: CanvasRenderingContext2D, pageY: number, now: number) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of strokes) {
    if (s.pageY !== pageY || s.pts.length < 1) continue;
    const endT = s.pts[s.pts.length - 1].t;
    const wholeFade =
      s.mode === 'normal'
        ? 1
        : Math.max(0, Math.min(1, 1 - (now - endT - holdMs(s)) / TRAIL_FADE_MS));
    if (wholeFade <= 0) continue;
    const rgb = rgbStr(s.color || '#E5484D');
    for (let i = 1; i < s.pts.length; i++) {
      const p0 = s.pts[i - 1], p1 = s.pts[i];
      let segAlpha = 1;
      if (s.mode === 'normal') {
        // comet: each point fades from the moment it was drawn
        segAlpha = Math.max(0, Math.min(1, 1 - (now - p1.t) / NORMAL_FADE_MS));
      }
      const alpha = segAlpha * wholeFade;
      if (alpha <= 0.01) continue;
      ctx.strokeStyle = `rgba(${rgb},${(alpha * 0.95).toFixed(3)})`;
      ctx.lineWidth = 3.4;
      ctx.shadowColor = `rgba(${rgb},0.55)`;
      ctx.shadowBlur = 7 * alpha;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }
    // dot at the live/last point
    const lp = s.pts[s.pts.length - 1];
    const dotAlpha =
      (s.mode === 'normal'
        ? Math.max(0, Math.min(1, 1 - (now - lp.t) / NORMAL_FADE_MS))
        : wholeFade) * 0.95;
    if (dotAlpha > 0.01) {
      ctx.fillStyle = `rgba(${rgb},${dotAlpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(lp.x, lp.y, 4.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}
