'use client';
// StickerPopover content — the sticker picker body attached to the toolbar's
// Sticker button (rendered inside the rail's Pop anchor card). Two collections
// in one grid (NoteWise-style):
//   • the built-in sticker pack (bundled /stickers/*.png — always present)
//   • the user's own stickers (Settings → Stickers; PNG, persisted in IndexedDB)
// Tapping a sticker places it on the page at the viewport center, selects it
// (its edit panel opens immediately). The "+" tile adds new PNGs to the user
// collection right from here.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Loader2, Sticker as StickerIcon } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/lib/nanote/store';
import * as db from '@/lib/nanote/idb';
import {
  addUserSticker, BUILTIN_STICKERS, listUserStickers, prepareSticker,
  subscribeStickers, type UserSticker,
} from '@/lib/nanote/stickers';
import { placeImageElement } from './imageInsert';

export function StickerPopover({ pageW, onClose }: { pageW: number; onClose: () => void }) {
  const { t, lang, fmt } = useT();
  const [mine, setMine] = useState<UserSticker[] | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false); // inserting in flight
  const [adding, setAdding] = useState(false); // files being imported
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

  // resolve object URLs for the user stickers' thumbnails
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

  // revoke every object URL we created when the popover closes
  useEffect(() => {
    const created = createdUrls.current;
    return () => { for (const u of created) URL.revokeObjectURL(u) };
  }, []);

  const insert = useCallback(async (source: typeof BUILTIN_STICKERS[number] | UserSticker) => {
    if (busy) return;
    setBusy(true);
    try {
      const prepared = await prepareSticker(source);
      if (!prepared) { toast.error(t('sticker.failed')); return }
      const elId = await placeImageElement({ ...prepared, pageW, targetScale: 0.35 });
      if (!elId) { toast.error(t('sticker.failed')); return }
      toast.success(t('sticker.inserted'), { duration: 2000 });
      onClose();
    } finally {
      setBusy(false);
    }
  }, [busy, onClose, pageW, t]);

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

  return (
    <div dir="ltr" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t('tool.sticker')}>
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

      {/* built-in pack */}
      <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <StickerIcon className="size-3.5 shrink-0" />
        {t('sticker.builtin')}
      </div>
      <div className="nanote-scroll grid max-h-52 grid-cols-4 gap-1.5 overflow-y-auto pr-1">
        {BUILTIN_STICKERS.map((s) => (
          <button
            key={s.id}
            type="button"
            disabled={busy}
            aria-label={lang === 'ar' ? s.labelAr : s.label}
            title={lang === 'ar' ? s.labelAr : s.label}
            onClick={() => void insert(s)}
            className="press-scale flex aspect-square items-center justify-center rounded-lg border border-transparent bg-muted/60 p-1 hover:border-primary/40 hover:bg-muted"
          >
            <img
              src={s.file}
              alt={lang === 'ar' ? s.labelAr : s.label}
              draggable={false}
              className="size-full object-contain"
            />
          </button>
        ))}
      </div>

      {/* user collection */}
      <div className="mb-1 mt-3 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <Plus className="size-3.5 shrink-0" />
        {t('sticker.mine')}
      </div>
      <div className="nanote-scroll grid max-h-40 grid-cols-4 gap-1.5 overflow-y-auto pr-1">
        {(mine ?? []).length === 0 && (
          <p className="col-span-4 rounded-lg bg-muted/40 px-2 py-3 text-center text-[11px] leading-relaxed text-muted-foreground">
            {t('sticker.none')}
          </p>
        )}
        {(mine ?? []).map((s) => (
          <button
            key={s.id}
            type="button"
            disabled={busy}
            aria-label={s.name}
            title={s.name}
            onClick={() => void insert(s)}
            className="press-scale flex aspect-square items-center justify-center rounded-lg border border-transparent bg-muted/60 p-1 hover:border-primary/40 hover:bg-muted"
          >
            {urls[s.id] ? (
              <img src={urls[s.id]} alt={s.name} draggable={false} className="size-full object-contain" />
            ) : (
              <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
            )}
          </button>
        ))}
        <button
          type="button"
          disabled={adding}
          aria-label={t('sticker.add')}
          title={t('sticker.add')}
          onClick={() => fileRef.current?.click()}
          className="press-scale flex aspect-square items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
        >
          {adding ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <Plus className="size-5" aria-hidden />}
        </button>
      </div>
    </div>
  );
}
