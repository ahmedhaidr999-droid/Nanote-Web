'use client';
// ColorWheel — the classic circular color spectrum: hue by angle, saturation
// by radial distance from the center (value fixed at 100%). Rendered once
// per-pixel via ImageData (dpr-aware, soft anti-aliased rim). Pointer drag
// picks the color under the cursor; the marker ring follows. Live preview
// swatch + editable hex input; Save/Cancel buttons.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import { useT } from '@/lib/nanote/store';
import { isValidHex, normalizeHex, hexToRgb, rgbToHex, clamp } from '@/lib/nanote/util';
import { Button } from '@/components/ui/button';

const SIZE = 176; // css px — the wheel's square canvas box

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = v - c;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === rr) h = 60 * (((gg - bb) / d) % 6);
    else if (max === gg) h = 60 * ((bb - rr) / d + 2);
    else h = 60 * ((rr - gg) / d + 4);
  }
  if (h < 0) h += 360;
  return [h, max === 0 ? 0 : d / max, max];
}

const hexToHsv = (hex: string): [number, number, number] => {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHsv(r, g, b);
};

/** marker position (css px inside the box) for a hex color on the wheel */
function markerOf(hex: string): { x: number; y: number } {
  const [h, s] = hexToHsv(hex);
  const rad = (SIZE / 2) * 0.94 * clamp(s, 0, 1); // rim reached slightly inside the edge
  const a = (h * Math.PI) / 180;
  return { x: SIZE / 2 + Math.cos(a) * rad, y: SIZE / 2 + Math.sin(a) * rad };
}

const hexOnWheel = (x: number, y: number): string => {
  const dx = x - SIZE / 2, dy = y - SIZE / 2;
  const dist = Math.min(1, Math.hypot(dx, dy) / ((SIZE / 2) * 0.94));
  const hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
  const [r, g, b] = hsvToRgb(hue, dist, 1);
  return rgbToHex(r, g, b);
};

export function ColorWheel({
  initial,
  onPick,
  onCancel,
}: {
  initial?: string;
  onPick: (hex: string) => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  const start = initial && isValidHex(initial) ? normalizeHex(initial) : '#E5484D';
  const [hex, setHex] = useState(start);
  const [marker, setMarker] = useState(() => markerOf(start));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  // ---- paint the spectrum once (per-pixel ImageData, dpr-aware)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2.5);
    const W = Math.round(SIZE * dpr);
    canvas.width = W;
    canvas.height = W;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(W, W);
    const c = W / 2;
    const rad = (SIZE / 2) * 0.94 * dpr; // matching markerOf()/hexOnWheel()
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const dx = x - c, dy = y - c;
        const dist = Math.hypot(dx, dy);
        const i = (y * W + x) * 4;
        if (dist > rad + dpr) continue; // transparent outside (rounded corners)
        let alpha = 255;
        if (dist > rad - dpr) alpha = Math.max(0, Math.round(255 * (rad + dpr - dist) / (2 * dpr))); // AA rim
        const sat = Math.min(1, dist / rad);
        const hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
        const [r, g, b] = hsvToRgb(hue, sat, 1);
        img.data[i] = r;
        img.data[i + 1] = g;
        img.data[i + 2] = b;
        img.data[i + 3] = alpha;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, []);

  // ---- pointer picking
  const pickAt = useCallback((e: React.PointerEvent) => {
    const box = boxRef.current;
    if (!box) return;
    const r = box.getBoundingClientRect();
    const x = clamp(e.clientX - r.left, 0, SIZE);
    const y = clamp(e.clientY - r.top, 0, SIZE);
    const inside = Math.hypot(x - SIZE / 2, y - SIZE / 2) <= SIZE / 2;
    const next = inside ? hexOnWheel(x, y) : hexOnWheel(
      SIZE / 2 + (x - SIZE / 2) * 0.999, // clamp onto the rim when dragged past
      SIZE / 2 + (y - SIZE / 2) * 0.999,
    );
    setHex(next);
    setMarker(inside ? { x, y } : markerOf(next));
  }, []);

  const onDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    pickAt(e);
  };
  const onMove = (e: React.PointerEvent) => {
    if (draggingRef.current) pickAt(e);
  };
  const onUp = () => { draggingRef.current = false };

  // typing a hex moves the marker too
  const onHexChange = (v: string) => {
    setHex(v);
    if (isValidHex(v)) setMarker(markerOf(normalizeHex(v)));
  };

  const valid = isValidHex(hex);

  return (
    <div className="w-64 select-none" dir="ltr" onClick={(e) => e.stopPropagation()}>
      <div className="mb-1 text-xs font-semibold text-muted-foreground">{t('tool.color.wheel')}</div>
      <div
        ref={boxRef}
        className="relative mx-auto touch-none"
        style={{ width: SIZE, height: SIZE }}
      >
        <canvas
          ref={canvasRef}
          className="w-[176px] h-[176px] cursor-crosshair rounded-full shadow-ink-1"
          aria-label={t('tool.color.wheel')}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        />
        {/* picked-position marker */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -ms-2.5 -mt-2.5 h-5 w-5 rounded-full border-2 border-white shadow-[0_0_0_1.5px_rgba(22,35,58,0.55)]"
          style={{ left: marker.x, top: marker.y, background: hex }}
        />
      </div>

      {/* preview + editable hex */}
      <div className="mt-2.5 flex items-center justify-center gap-2">
        <span
          className="h-8 w-8 shrink-0 rounded-md border border-black/10 shadow-ink-1"
          style={{ background: valid ? normalizeHex(hex) : hex }}
          aria-label={t('tool.color.hex')}
        />
        <input
          value={hex}
          onChange={(e) => onHexChange(e.target.value)}
          className="h-8 w-24 rounded-md border border-input bg-background px-2 text-xs uppercase"
          aria-label={t('tool.color.hex')}
          spellCheck={false}
        />
      </div>

      <div className="mt-2.5 flex justify-center gap-2">
        <Button
          type="button"
          size="sm"
          className="press-scale h-8 gap-1.5 px-3 text-xs"
          disabled={!valid}
          onClick={() => onPick(normalizeHex(hex))}
        >
          <Check className="size-3.5" />
          {t('common.save')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="press-scale h-8 gap-1.5 px-3 text-xs"
          onClick={onCancel}
        >
          <X className="size-3.5" />
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  );
}
