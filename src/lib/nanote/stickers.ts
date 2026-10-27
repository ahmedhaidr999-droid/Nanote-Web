// Sticker system — NoteWise-style.
//
// Two collections feed ONE picker (toolbar → Sticker tool):
//   • BUILTIN_STICKERS — PNG files bundled with the app at /stickers/*.png.
//     Always available, never removable.
//   • User stickers — PNGs the user adds from Settings → Stickers (or straight
//     from the sticker picker). Persisted in IndexedDB: the bitmap lives in the
//     shared `images` store (id prefix `stk:`) and the ordered catalog lives in
//     the `meta` store under `userStickers` — so the collection survives
//     restarts and shows up identically in the picker and in Settings.
//
// Inserting a sticker copies the bitmap into a fresh images-store record and
// places an ImageEl on the page — stickers therefore render, move, resize,
// crop, export and undo exactly like any inserted image, and deleting a
// sticker from the collection never removes already-placed ones.
import * as db from './idb';
import { uid } from './util';

export interface StickerDef {
  id: string;      // stable id ('builtin:airplane')
  file: string;    // public path (/stickers/airplane.png)
  label: string;   // English label
  labelAr: string; // Arabic label
}

export interface UserSticker {
  id: string;      // images-store id ('stk:…')
  name: string;
  w: number;
  h: number;
  createdAt: number;
}

/** The permanent sticker pack shipped with the app (public/stickers). */
export const BUILTIN_STICKERS: StickerDef[] = [
  { id: 'builtin:airplane', file: '/stickers/airplane.png', label: 'Airplane', labelAr: 'طائرة' },
  { id: 'builtin:confidence', file: '/stickers/confidence.png', label: 'Confidence', labelAr: 'الثقة' },
  { id: 'builtin:better', file: '/stickers/better.png', label: 'Get better', labelAr: 'كن أفضل' },
  { id: 'builtin:motivate', file: '/stickers/motivate.png', label: 'Motivated', labelAr: 'تحفيز' },
  { id: 'builtin:motivation', file: '/stickers/motivation.png', label: 'Motivation', labelAr: 'إلهام' },
  { id: 'builtin:motivation-1', file: '/stickers/motivation-1.png', label: 'Motivation 1', labelAr: 'إلهام ١' },
  { id: 'builtin:motivation-2', file: '/stickers/motivation-2.png', label: 'Motivation 2', labelAr: 'إلهام ٢' },
  { id: 'builtin:motivation-3', file: '/stickers/motivation-3.png', label: 'Motivation 3', labelAr: 'إلهام ٣' },
  { id: 'builtin:sticky-notes', file: '/stickers/sticky-notes.png', label: 'Sticky notes', labelAr: 'ملاحظات لاصقة' },
  { id: 'builtin:listening', file: '/stickers/listening.png', label: 'Listening', labelAr: 'استماع' },
];

const META_KEY = 'userStickers';
export const STICKER_MAX_BYTES = 8 * 1024 * 1024; // 8 MB per sticker
const STICKER_MAX_DIM = 1024; // stored at up to 1024px on the long edge

// ---------------------------------------------------------------- catalog cache + pub/sub

let cache: UserSticker[] | null = null;
const listeners = new Set<() => void>();

/** Subscribe to user-sticker collection changes (add/remove). */
export function subscribeStickers(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn) };
}

function emitChange() { for (const fn of listeners) fn() }

async function loadCatalog(): Promise<UserSticker[]> {
  if (cache) return cache;
  const rec = await db.getMeta<{ id: string; items: UserSticker[] }>(META_KEY);
  cache = Array.isArray(rec?.items) ? rec!.items.filter((s) => s && typeof s.id === 'string') : [];
  return cache;
}

async function saveCatalog(items: UserSticker[]) {
  cache = items;
  await db.putMeta(META_KEY, { items });
  emitChange();
}

/** The user's own sticker collection (newest last). */
export async function listUserStickers(): Promise<UserSticker[]> {
  return [...(await loadCatalog())];
}

// ---------------------------------------------------------------- add / remove

export type AddStickerResult =
  | { ok: true; sticker: UserSticker }
  | { ok: false; reason: 'invalid' | 'tooLarge' | 'decode' };

/**
 * Add a PNG file to the user's sticker collection.
 * Transparency is preserved; oversized bitmaps are downscaled to ≤1024px.
 */
export async function addUserSticker(file: File): Promise<AddStickerResult> {
  const isPng = file.type === 'image/png' || /\.png$/i.test(file.name);
  if (!isPng) return { ok: false, reason: 'invalid' };
  if (file.size > STICKER_MAX_BYTES) return { ok: false, reason: 'tooLarge' };

  let blob: Blob = file;
  let w = 0, h = 0;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return { ok: false, reason: 'decode' };
  w = bitmap.width; h = bitmap.height;
  if (!w || !h) { bitmap.close?.(); return { ok: false, reason: 'decode' } }
  const scale = Math.min(1, STICKER_MAX_DIM / Math.max(w, h));
  if (scale < 1) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    c.getContext('2d')!.drawImage(bitmap, 0, 0, c.width, c.height);
    const shrunk = await new Promise<Blob | null>((res) => c.toBlob((b) => res(b), 'image/png'));
    if (shrunk) { blob = shrunk; w = c.width; h = c.height }
  }
  bitmap.close?.();

  const id = `stk:${uid()}`;
  await db.putImage({ id, w, h, name: file.name || 'sticker.png', createdAt: Date.now(), blob });
  const sticker: UserSticker = { id, name: file.name || 'sticker.png', w, h, createdAt: Date.now() };
  await saveCatalog([...(await loadCatalog()), sticker]);
  return { ok: true, sticker };
}

/**
 * Remove a sticker from the user's collection (placed copies on pages are
 * independent image records — they keep rendering).
 */
export async function removeUserSticker(id: string): Promise<void> {
  const items = await loadCatalog();
  const next = items.filter((s) => s.id !== id);
  if (next.length !== items.length) await saveCatalog(next);
  await db.deleteImage(id).catch(() => { /* already gone */ });
  const { dropImageCache, revokeImageURL } = await import('./images');
  dropImageCache(id);
  revokeImageURL(id);
}

// ---------------------------------------------------------------- insert onto a page

export interface PreparedSticker { imageId: string; w: number; h: number }

/**
 * Materialize a sticker (built-in or user) as a FRESH images-store record, so
 * the placed element owns its own copy — later collection edits never affect
 * pages. Returns the record id + natural size for aspect-correct placement.
 */
export async function prepareSticker(source: StickerDef | UserSticker): Promise<PreparedSticker | null> {
  try {
    let blob: Blob;
    let w: number, h: number;
    if ('file' in source) {
      // built-in: fetch the bundled PNG
      const res = await fetch(source.file);
      if (!res.ok) return null;
      blob = await res.blob();
      const bmp = await createImageBitmap(blob).catch(() => null);
      w = bmp?.width ?? 0; h = bmp?.height ?? 0;
      bmp?.close?.();
    } else {
      const rec = await db.getImage(source.id);
      if (!rec?.blob) return null;
      blob = rec.blob;
      w = rec.w; h = rec.h;
    }
    if (!w || !h) {
      // size unknown (decode failed earlier) — fall back to a square
      const bmp = await createImageBitmap(blob).catch(() => null);
      w = bmp?.width ?? 256; h = bmp?.height ?? 256;
      bmp?.close?.();
    }
    const imageId = uid();
    await db.putImage({ id: imageId, w, h, name: 'file' in source ? source.label : source.name, createdAt: Date.now(), blob });
    return { imageId, w, h };
  } catch {
    return null;
  }
}
