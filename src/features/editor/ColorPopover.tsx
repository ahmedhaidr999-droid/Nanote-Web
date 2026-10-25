'use client';
// ColorPopover — favorites (5 slots), recents (8), full palette, hex input.
import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { useApp, useT } from '@/lib/nanote/store';
import { INK_PALETTE } from '@/lib/nanote/types';
import { isValidHex, normalizeHex } from '@/lib/nanote/util';
import { cn } from '@/lib/utils';

export function ColorPopover({
  current,
  onPick,
  onClose,
  align = 'start',
}: {
  current: string;
  onPick: (hex: string) => void;
  onClose?: () => void;
  align?: 'start' | 'end';
}) {
  const { t } = useT();
  const favorites = useApp((s) => s.settings.favoriteColors);
  const recents = useApp((s) => s.editor.recentColors);
  const setSettings = useApp((s) => s.setSettings);
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

  return (
    <div
      ref={boxRef}
      className="w-64 rounded-xl border border-border bg-card p-3 shadow-ink-2"
      style={{ pointerEvents: 'auto' }}
      dir="ltr"
      onClick={(e) => e.stopPropagation()}
    >
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
