'use client';
// StickerSettingsContent — the body of Settings → Stickers. Shows the built-in
// pack (always available) and the user's own PNG sticker collection with
// add / remove. The same collection feeds the toolbar's Sticker tool.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Plus, Sticker as StickerIcon, X } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/lib/nanote/store';
import * as db from '@/lib/nanote/idb';
import {
  addUserSticker, BUILTIN_STICKERS, listUserStickers, removeUserSticker,
  subscribeStickers, type UserSticker,
} from '@/lib/nanote/stickers';
import { cn } from '@/lib/utils';

export function StickerSettingsContent() {
  const { t, lang, fmt } = useT();
  const [mine, setMine] = useState<UserSticker[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const createdUrls = useRef<Set<string>>(new Set());

  // load + live-refresh the user collection
  useEffect(() => {
    let alive = true;
    const refresh = () => { void listUserStickers().then((items) => { if (alive) setMine(items) }) };
    refresh();
    const unsub = subscribeStickers(refresh);
    return () => { alive = false; unsub() };
  }, []);

  // resolve thumbnails (object URLs) for the user stickers
  useEffect(() => {
    let alive = true;
    if (!mine) return;
    const missing = mine.filter((s) => !urls[s.id]);
    if (missing.length === 0) return;
    void Promise.all(missing.map(async (s) => {
      try {
        const rec = await db.getImage(s.id);
        if (rec?.blob) return [s.id, URL.createObjectURL(rec.blob)] as const;
      } catch { /* missing record — skip */ }
      return null;
    })).then((pairs) => {
      if (!alive) {
        for (const p of pairs) if (p) URL.revokeObjectURL(p[1]);
        return;
      }
      const next: Record<string, string> = {};
      for (const p of pairs) if (p) { next[p[0]] = p[1]; createdUrls.current.add(p[1]) }
      setUrls((u) => ({ ...u, ...next }));
    });
    return () => { alive = false };
  }, [mine, urls]);

  // revoke all object URLs on unmount
  useEffect(() => {
    const created = createdUrls.current;
    return () => { for (const u of created) URL.revokeObjectURL(u) };
  }, []);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const list = [...files].filter((f) => f.size > 0);
    if (list.length === 0) return;
    setAdding(true);
    let added = 0;
    let lastErr: 'invalid' | 'tooLarge' | 'decode' | null = null;
    for (const f of list) {
      const res = await addUserSticker(f);
      if (res.ok) added++;
      else lastErr = res.reason;
    }
    setAdding(false);
    if (added > 0) toast.success(fmt(t('sticker.added'), { n: added }), { duration: 2200 });
    if (lastErr) {
      toast.error(t(
        lastErr === 'invalid' ? 'sticker.invalid'
          : lastErr === 'tooLarge' ? 'sticker.tooLarge'
            : 'sticker.decode',
      ));
    }
  }, [fmt, t]);

  const remove = useCallback(async (id: string) => {
    await removeUserSticker(id);
    toast.success(t('sticker.removed'), { duration: 2000 });
  }, [t]);

  return (
    <div className="space-y-4">
      <input
        ref={fileRef}
        type="file"
        accept="image/png,.png"
        multiple
        className="hidden"
        onChange={(e) => {
          // IMPORTANT: snapshot the FileList into a plain array BEFORE clearing
          // the input — in Chromium the FileList is LIVE and `value = ''` empties
          // the very object we captured, silently dropping every selected file.
          const fs = [...(e.target.files ?? [])];
          e.target.value = '';
          if (fs.length) void addFiles(fs);
        }}
      />
      <p className="text-xs leading-relaxed text-muted-foreground">{t('sticker.hint')}</p>

      {/* built-in pack */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <StickerIcon className="size-4 shrink-0 text-primary" />
          {t('sticker.builtin')}
          <span className="text-xs font-normal text-muted-foreground">({BUILTIN_STICKERS.length})</span>
        </div>
        <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-8">
          {BUILTIN_STICKERS.map((s) => (
            <div
              key={s.id}
              title={lang === 'ar' ? s.labelAr : s.label}
              className="flex aspect-square items-center justify-center rounded-lg bg-muted/60 p-1"
            >
              { }
              <img
                src={s.file}
                alt={lang === 'ar' ? s.labelAr : s.label}
                draggable={false}
                className="size-full object-contain"
              />
            </div>
          ))}
        </div>
      </div>

      {/* user collection */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <Plus className="size-4 shrink-0 text-primary" />
          {t('sticker.mine')}
          {mine && <span className="text-xs font-normal text-muted-foreground">({mine.length})</span>}
        </div>
        <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-8">
          {(mine ?? []).map((s) => (
            <div key={s.id} className="group relative">
              <div
                title={s.name}
                className="flex aspect-square items-center justify-center rounded-lg bg-muted/60 p-1"
              >
                {urls[s.id] ? (
                   
                  <img src={urls[s.id]} alt={s.name} draggable={false} className="size-full object-contain" />
                ) : (
                  <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
                )}
              </div>
              <button
                type="button"
                aria-label={t('common.delete')}
                title={t('common.delete')}
                onClick={() => void remove(s.id)}
                className={cn(
                  'absolute -end-1.5 -top-1.5 z-10 flex size-5 items-center justify-center rounded-full',
                  'bg-card text-muted-foreground shadow-ink-1 border border-border hover:bg-destructive hover:text-white',
                )}
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={adding}
            onClick={() => fileRef.current?.click()}
            className="press-scale flex aspect-square flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
          >
            {adding ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Plus className="size-5" aria-hidden />}
          </button>
        </div>
        {mine && mine.length === 0 && (
          <p className="rounded-lg bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            {t('sticker.none')}
          </p>
        )}
      </div>
    </div>
  );
}
