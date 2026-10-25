'use client';
// ColorPopover — favorites (5 slots), custom colors (saved from the wheel,
// max 12), recents (8), full palette, hex input. "Add color" swaps the
// content to the ColorWheel spectrum circle; saving a wheel color prepends
// it to settings.customColors and picks it.
import { useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useApp, useT } from '@/lib/nanote/store';
import { INK_PALETTE } from '@/lib/nanote/types';
import { isValidHex, normalizeHex } from '@/lib/nanote/util';
import { cn } from '@/lib/utils';
import { ColorWheel } from './ColorWheel';

const MAX_CUSTOM = 12;

export function ColorPopover({
  current,
  onPick,
  onClose,
  align = 'start',
  palette,
}: {
  current: string;
  onPick: (hex: string) => void;
  onClose?: () => void;
  align?: 'start' | 'end';
  /** extra swatch row pinned at the top (e.g. the highlighter palette) */
  palette?: string[];
}) {
  const { t } = useT();
  const favorites = useApp((s) => s.settings.favoriteColors);
  const custom = useApp((s) => s.settings.customColors);
  const recents = useApp((s) => s.editor.recentColors);
  const setSettings = useApp((s) => s.setSettings);
  const [wheelOpen, setWheelOpen] = useState(false);
  const [hex, setHex] = useState(current.startsWith('#') ? current : `#${current}`);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) onClose?.();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose?.() };
    window.addEventListener('pointerdown', onDown, { capture: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, { capture: true });
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const pick = (c: string) => { onPick(c); onClose?.() };

  const saveFavorite = () => {
    const next = [current, ...favorites.filter((f) => f !== current)].slice(0, 5);
    void setSettings({ favoriteColors: next });
  };

  /** wheel "Save": prepend to custom colors (dedupe, max 12) and pick it */
  const saveCustom = (c: string) => {
    const next = [c, ...custom.filter((x) => x !== c)].slice(0, MAX_CUSTOM);
    void setSettings({ customColors: next });
    setWheelOpen(false);
    pick(c);
  };

  const removeCustom = (c: string) => {
    void setSettings({ customColors: custom.filter((x) => x !== c) });
  };

  if (wheelOpen) {
    return (
      <div
        ref={boxRef}
        className="w-64 rounded-xl border border-border bg-card p-3 shadow-ink-2"
        style={{ pointerEvents: 'auto' }}
        dir="ltr"
        onClick={(e) => e.stopPropagation()}
      >
        <ColorWheel initial={current} onPick={saveCustom} onCancel={() => setWheelOpen(false)} />
      </div>
    );
  }

  return (
    <div
      ref={boxRef}
      className="w-64 rounded-xl border border-border bg-card p-3 shadow-ink-2"
      style={{ pointerEvents: 'auto' }}
      dir="ltr"
      onClick={(e) => e.stopPropagation()}
    >
      {palette && palette.length > 0 && (
        <>
          <div className="mb-1.5 flex gap-2">
            {palette.map((c) => (
              <Swatch key={c} color={c} active={c === current} onClick={() => pick(c)} />
            ))}
          </div>
          <div className="mb-2 h-px w-full bg-border" />
        </>
      )}

      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground">{t('tool.color.custom')}</span>
        {custom.length > 0 && (
          <span className="text-[10px] tabular-nums text-muted-foreground/70">{custom.length}/{MAX_CUSTOM}</span>
        )}
      </div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {custom.map((c) => (
          <span key={c} className="relative">
            <Swatch color={c} small active={c === current} onClick={() => pick(c)} />
            <button
              type="button"
              aria-label={`${t('tool.color.remove')} ${c}`}
              title={t('tool.color.remove')}
              onClick={(e) => { e.stopPropagation(); removeCustom(c) }}
              className="absolute -end-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-border bg-card text-foreground/80 shadow-ink-1 hover:bg-accent"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
        {custom.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
      </div>
      <button
        type="button"
        onClick={() => setWheelOpen(true)}
        className="mb-3 flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-surface-variant text-xs font-medium press-scale"
      >
        <Plus className="h-4 w-4" />
        {t('tool.color.add')}
      </button>

      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground">{t('tool.color.favorites')}</span>
        <button
          type="button"
          aria-label={t('tool.color.saveFav')}
          onClick={saveFavorite}
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent press-scale"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mb-3 flex gap-2">
        {favorites.slice(0, 5).map((c, i) => (
          <Swatch key={`${c}-${i}`} color={c} active={c === current} onClick={() => pick(c)} />
        ))}
        {favorites.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
      </div>

      {recents.length > 0 && (
        <>
          <div className="mb-1.5 text-xs font-semibold text-muted-foreground">{t('tool.color.recent')}</div>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {recents.slice(0, 8).map((c, i) => (
              <Swatch key={`${c}-${i}`} color={c} small active={c === current} onClick={() => pick(c)} />
            ))}
          </div>
        </>
      )}

      <div className="mb-1.5 text-xs font-semibold text-muted-foreground">{t('tool.color.palette')}</div>
      <div className="mb-3 grid grid-cols-8 gap-1.5">
        {INK_PALETTE.map((c) => (
          <Swatch key={c} color={c} small active={c === current} onClick={() => pick(c)} />
        ))}
      </div>

      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (isValidHex(hex)) pick(normalizeHex(hex));
        }}
      >
        <span className="text-xs font-semibold text-muted-foreground">{t('tool.color.hex')}</span>
        <input
          value={hex}
          onChange={(e) => setHex(e.target.value)}
          className="h-8 w-20 rounded-md border border-input bg-background px-2 text-xs"
          aria-label={t('tool.color.hex')}
          spellCheck={false}
        />
        <div className="h-8 w-8 rounded-md border border-input" style={{ background: isValidHex(hex) ? normalizeHex(hex) : 'transparent' }} />
      </form>
      <div className={cn('mt-1 h-0 w-0', align === 'end' ? 'self-end' : '')} />
    </div>
  );
}

function Swatch({ color, onClick, active, small }: { color: string; onClick: () => void; active?: boolean; small?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={color}
      className={cn(
        'rounded-md border press-scale',
        small ? 'h-6 w-6' : 'h-8 w-8',
        active ? 'border-primary ring-2 ring-ring ring-offset-1 ring-offset-card' : 'border-black/10',
      )}
      style={{ background: color }}
    />
  );
}
