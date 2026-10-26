// Paper templates — definitions + canvas drawing + preview rendering.
import { TemplateId } from './types';
import { isDarkHex, withAlpha } from './util';

export interface TemplateDef { id: TemplateId; hasBgImage?: false }

export const TEMPLATE_IDS: TemplateId[] = [
  'blank', 'ruled', 'wideruled', 'grid', 'dotgrid', 'handwriting',
  'music', 'isometric', 'daily', 'weekly', 'monthly', 'custom',
];

export function templateLineColor(bgHex: string): string {
  return isDarkHex(bgHex) ? 'rgba(255,255,255,0.14)' : 'rgba(90,107,133,0.30)';
}

export function templateAccentColor(bgHex: string): string {
  return isDarkHex(bgHex) ? 'rgba(255,255,255,0.22)' : 'rgba(30,111,242,0.30)';
}

/**
 * Seamless (infinity-paper) pattern fill — ONE canvas op instead of a loop
 * over every cell. Why: at low zoom the render window spans tens of thousands
 * of local units, and a per-cell dot/grid loop exploded into 1M+ arc() calls
 * per repaint (multi-second freezes at 8% zoom). A repeat-pattern tile drawn
 * at device resolution and mapped through pattern.setTransform fills the
 * whole slice in O(bitmap) — at any zoom — while staying anchored to the
 * ABSOLUTE local grid (the pattern origin is the CTM origin), so the pattern
 * never shimmers between re-renders.
 */
function seamlessPatternFill(
  ctx: CanvasRenderingContext2D,
  cellLocal: number,
  drawCell: (t: CanvasRenderingContext2D) => void,
  fillRect: (c: CanvasRenderingContext2D) => void,
): void {
  const m = ctx.getTransform();
  const raster = Math.abs(m.a) || 1; // current local→device scale
  const px = Math.max(2, Math.ceil(cellLocal * raster));
  const tile = document.createElement('canvas');
  tile.width = px;
  tile.height = px;
  const tctx = tile.getContext('2d');
  if (!tctx) return;
  // draw ONE cell at (near-)device resolution, in local units
  tctx.scale(px / cellLocal, px / cellLocal);
  drawCell(tctx);
  const pat = ctx.createPattern(tile, 'repeat');
  if (!pat) return;
  // map tile-bitmap px back to exact local units: tile covers cellLocal local
  // units, so scale = cellLocal·raster / px per tile pixel — sharp at every
  // zoom, no accumulated drift (the pattern transform composes with the CTM).
  const s = (cellLocal * raster) / px;
  try {
    pat.setTransform(new DOMMatrix([s, 0, 0, s, 0, 0]));
  } catch { /* very old engines: repeat unscaled — still seamless */ }
  ctx.save();
  ctx.fillStyle = pat;
  fillRect(ctx);
  ctx.restore();
}

export function drawTemplate(
  ctx: CanvasRenderingContext2D,
  template: TemplateId,
  w: number,
  h: number,
  bgHex: string,
  // seamless (infinity paper): the pattern region is [x0..w] × [y0..h] in
  // page-local coordinates and x0/y0 may be negative — pattern lines stay
  // anchored to the absolute local grid so the background never breaks,
  // no matter which slice of the endless sheet is being drawn.
  x0 = 0,
  y0 = 0,
  seamless = false,
) {
  if (template === 'blank' || template === 'custom') return;
  const line = templateLineColor(bgHex);
  const accent = templateAccentColor(bgHex);
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = line;
  ctx.fillStyle = line;

  // in seamless mode there are no page edges — pattern covers the full slice.
  // on fixed pages keep the original margins so regular notebooks look identical.
  const hline = (y: number, xa = x0, xb = w) => { ctx.beginPath(); ctx.moveTo(xa, y); ctx.lineTo(xb, y); ctx.stroke() };
  const vline = (x: number, ya = y0, yb = h) => { ctx.beginPath(); ctx.moveTo(x, ya); ctx.lineTo(x, yb); ctx.stroke() };

  switch (template) {
    case 'ruled': {
      if (seamless) {
        // lines every 32 local units, anchored at y ≡ 72 (mod 32) — the same
        // absolute positions the loop produced, filled as ONE pattern op
        const step = 32;
        seamlessPatternFill(ctx, step, (t) => {
          t.lineWidth = 1;
          t.strokeStyle = line;
          t.beginPath();
          t.moveTo(-1, 72 % step);
          t.lineTo(step + 1, 72 % step);
          t.stroke();
        }, (c) => c.fillRect(x0, y0, w - x0, h - y0));
        break;
      }
      const step = 32;
      const first = 72 + Math.ceil((y0 - 72) / step) * step;
      const lastY = h - 24;
      for (let y = Math.max(72, first); y < lastY; y += step) hline(y);
      break;
    }
    case 'wideruled': {
      if (seamless) {
        const step = 48;
        seamlessPatternFill(ctx, step, (t) => {
          t.lineWidth = 1;
          t.strokeStyle = line;
          t.beginPath();
          t.moveTo(-1, 80 % step);
          t.lineTo(step + 1, 80 % step);
          t.stroke();
        }, (c) => c.fillRect(x0, y0, w - x0, h - y0));
        break;
      }
      const step = 48;
      const first = 80 + Math.ceil((y0 - 80) / step) * step;
      const lastY = h - 32;
      for (let y = Math.max(80, first); y < lastY; y += step) hline(y);
      break;
    }
    case 'grid': {
      if (seamless) {
        // 24-unit square grid — one cell tile carries BOTH sides of each seam
        // (a stroke straddling the tile edge is clipped to its inner half;
        // drawing the line at 0 AND at s makes the two halves meet exactly)
        const s = 24;
        seamlessPatternFill(ctx, s, (t) => {
          t.lineWidth = 1;
          t.strokeStyle = line;
          t.beginPath();
          t.moveTo(0, -1); t.lineTo(0, s + 1); t.stroke();
          t.beginPath();
          t.moveTo(s, -1); t.lineTo(s, s + 1); t.stroke();
          t.beginPath();
          t.moveTo(-1, 0); t.lineTo(s + 1, 0); t.stroke();
          t.beginPath();
          t.moveTo(-1, s); t.lineTo(s + 1, s); t.stroke();
        }, (c) => c.fillRect(x0, y0, w - x0, h - y0));
        break;
      }
      const s = 24;
      const fx = Math.ceil(x0 / s) * s;
      const fy = Math.ceil(y0 / s) * s;
      for (let x = fx; x <= w; x += s) vline(x);
      for (let y = fy; y <= h; y += s) hline(y);
      break;
    }
    case 'dotgrid': {
      if (seamless) {
        // dots every 24 units — one centered dot per pattern cell
        const s = 24;
        seamlessPatternFill(ctx, s, (t) => {
          t.fillStyle = line;
          t.beginPath();
          t.arc(s / 2, s / 2, 1.7, 0, Math.PI * 2);
          t.fill();
        }, (c) => c.fillRect(x0, y0, w - x0, h - y0));
        break;
      }
      const s = 24;
      const fx = Math.ceil(x0 / s) * s;
      const fy = Math.ceil(y0 / s) * s;
      // fixed pages start one cell in (no dots on the page edge); the endless
      // sheet has no edges — dots continue into negative space seamlessly.
      const sx = seamless ? fx : Math.max(fx, s);
      const sy = seamless ? fy : Math.max(fy, s);
      for (let x = sx; x < w; x += s) for (let y = sy; y < h; y += s) {
        ctx.beginPath(); ctx.arc(x, y, 1.7, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case 'handwriting': {
      const group = 64;
      const g0 = Math.ceil((y0 - 96) / group);
      const g1 = Math.floor(((seamless ? h : h - 40) - 96) / group);
      for (let g = g0; g <= g1; g++) {
        const y = 96 + g * group;
        if (y < y0 - 32 || y > h + 40) continue;
        // baseline
        ctx.strokeStyle = accent;
        hline(y + 32);
        // midline (dashed)
        ctx.strokeStyle = line;
        ctx.setLineDash([5, 7]);
        hline(y + 12);
        // ascender line
        hline(y - 8);
        ctx.setLineDash([]);
      }
      break;
    }
    case 'music': {
      const groupH = 128;
      const g0 = Math.ceil((y0 - 96) / groupH);
      const g1 = Math.floor(((seamless ? h : h - 40) - 96) / groupH);
      for (let g = g0; g <= g1; g++) {
        const base = 96 + g * groupH;
        if (base + 4 * 14 < y0 - 20 || base > h + 20) continue;
        ctx.strokeStyle = accent;
        for (let i = 0; i < 5; i++) hline(base + i * 14, seamless ? x0 : 48, seamless ? w : w - 48);
      }
      break;
    }
    case 'isometric': {
      const s = 30;
      const drawFamily = (angleDeg: number) => {
        const a = (angleDeg * Math.PI) / 180;
        const dirx = Math.cos(a), diry = Math.sin(a);
        const nx = -diry, ny = dirx;
        const cx = (x0 + w) / 2, cy = (y0 + h) / 2;
        const diag = Math.hypot(w - x0, h - y0);
        const count = Math.ceil(diag / s) + 2;
        // families stay anchored to the local grid: offset lines from the
        // absolute origin, then clip the visible band to the slice
        const baseOffset = Math.floor((x0 + y0) / s) * s;
        for (let i = -count + Math.floor(baseOffset / s); i <= count + Math.floor(baseOffset / s); i++) {
          const ox = cx + nx * i * s, oy = cy + ny * i * s;
          ctx.beginPath();
          ctx.moveTo(ox - dirx * diag, oy - diry * diag);
          ctx.lineTo(ox + dirx * diag, oy + diry * diag);
          ctx.stroke();
        }
      };
      ctx.strokeStyle = withAlpha(isDarkHex(bgHex) ? '#FFFFFF' : '#5A6B85', 0.16);
      drawFamily(90);
      drawFamily(30);
      drawFamily(150);
      break;
    }
    case 'daily': {
      // header
      ctx.strokeStyle = accent; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x0, 64); ctx.lineTo(w, 64); ctx.stroke();
      ctx.lineWidth = 1;
      // checkbox column + sections
      const secH = 110;
      const g0 = Math.ceil((y0 - 110) / secH);
      const g1 = Math.floor(((seamless ? h : h - 30) - 110) / secH);
      for (let g = g0; g <= g1; g++) {
        const y = 110 + g * secH;
        if (y + secH < y0 - 30 || y > h + 30) continue;
        ctx.strokeStyle = line;
        ctx.strokeRect(40, y, 18, 18);
        hline(y + secH - 26, 40, w - 40);
        ctx.strokeRect(40, y + secH - 46, 18, 18);
      }
      break;
    }
    case 'weekly': {
      const pad = 36;
      const cw = (w - pad * 2) / 7;
      ctx.strokeStyle = accent; ctx.lineWidth = 1.5;
      hline(70, pad, w - pad);
      ctx.lineWidth = 1;
      ctx.strokeStyle = line;
      for (let i = 0; i <= 7; i++) vline(pad + i * cw, 40, seamless ? h : h - 30);
      hline(40, pad, w - pad);
      break;
    }
    case 'monthly': {
      const pad = 30;
      const cw = (w - pad * 2) / 7;
      const rh = (h - 110 - pad) / 5;
      ctx.strokeStyle = accent; ctx.lineWidth = 1.5;
      hline(80, pad, w - pad);
      ctx.lineWidth = 1; ctx.strokeStyle = line;
      for (let i = 0; i <= 7; i++) vline(pad + i * cw, 110, 110 + 5 * rh);
      for (let j = 0; j <= 5; j++) hline(110 + j * rh, pad, w - pad);
      break;
    }
  }
  ctx.restore();
}

/** Small preview PNG for template pickers. */
export function renderTemplatePreview(template: TemplateId, w = 96, h = 128, bg = '#FFFFFF'): string {
  const c = document.createElement('canvas');
  const scale = 2;
  c.width = w * scale; c.height = h * scale;
  const ctx = c.getContext('2d')!;
  ctx.scale((w * scale) / 794, (h * scale) / 1054); // draw as if A4 then downscale via transform
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 794, 1054);
  drawTemplate(ctx, template, 794, 1054, bg);
  return c.toDataURL('image/png');
}
