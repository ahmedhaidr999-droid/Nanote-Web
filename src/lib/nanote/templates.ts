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

export function drawTemplate(
  ctx: CanvasRenderingContext2D,
  template: TemplateId,
  w: number,
  h: number,
  bgHex: string,
) {
  if (template === 'blank' || template === 'custom') return;
  const line = templateLineColor(bgHex);
  const accent = templateAccentColor(bgHex);
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = line;
  ctx.fillStyle = line;

  const hline = (y: number, x0 = 0, x1 = w) => { ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke() };
  const vline = (x: number, y0 = 0, y1 = h) => { ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke() };

  switch (template) {
    case 'ruled':
      for (let y = 72; y < h - 24; y += 32) hline(y);
      break;
    case 'wideruled':
      for (let y = 80; y < h - 32; y += 48) hline(y);
      break;
    case 'grid': {
      const s = 24;
      for (let x = 0; x <= w; x += s) vline(x);
      for (let y = 0; y <= h; y += s) hline(y);
      break;
    }
    case 'dotgrid': {
      const s = 24;
      for (let x = s; x < w; x += s) for (let y = s; y < h; y += s) {
        ctx.beginPath(); ctx.arc(x, y, 1.7, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case 'handwriting': {
      const group = 64;
      for (let y = 96; y < h - 40; y += group) {
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
      for (let base = 96; base + 4 * 14 < h - 40; base += groupH) {
        ctx.strokeStyle = accent;
        for (let i = 0; i < 5; i++) hline(base + i * 14, 48, w - 48);
      }
      break;
    }
    case 'isometric': {
      const s = 30;
      const drawFamily = (angleDeg: number) => {
        const a = (angleDeg * Math.PI) / 180;
        const dirx = Math.cos(a), diry = Math.sin(a);
        const nx = -diry, ny = dirx;
        const diag = Math.hypot(w, h);
        const cx = w / 2, cy = h / 2;
        const count = Math.ceil(diag / s);
        for (let i = -count; i <= count; i++) {
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
      ctx.beginPath(); ctx.moveTo(0, 64); ctx.lineTo(w, 64); ctx.stroke();
      ctx.lineWidth = 1;
      // checkbox column + sections
      const secH = 110;
      for (let y = 110; y + secH < h - 30; y += secH) {
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
      for (let i = 0; i <= 7; i++) vline(pad + i * cw, 40, h - 30);
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
