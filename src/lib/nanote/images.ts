// Image resolution for canvas rendering — object-URL + bitmap LRU caches.
import * as db from './idb';

interface Entry<T> { value: T; touched: number }

const bitmaps = new Map<string, Entry<ImageBitmap | HTMLCanvasElement>>();
const naturals = new Map<string, { w: number; h: number }>();
const inflight = new Map<string, Promise<void>>();
const MAX = 48;

function touch<T>(map: Map<string, Entry<T>>, id: string) {
  const e = map.get(id);
  if (e) { e.touched = Date.now(); map.set(id, e) }
}

function evict() {
  while (bitmaps.size > MAX) {
    let oldest: string | null = null;
    let t = Infinity;
    for (const [k, v] of bitmaps) if (v.touched < t) { t = v.touched; oldest = k }
    if (!oldest) break;
    const e = bitmaps.get(oldest);
    if (e) {
      const val = e.value as unknown as ImageBitmap;
      if (typeof val.close === 'function') val.close();
    }
    bitmaps.delete(oldest);
  }
}

export async function ensureImageLoaded(imageId: string): Promise<void> {
  if (bitmaps.has(imageId)) { touch(bitmaps, imageId); return }
  if (inflight.has(imageId)) return inflight.get(imageId)!;
  const p = (async () => {
    const rec = await db.getImage(imageId);
    if (!rec?.blob) throw new Error('image missing');
    let src: ImageBitmap | HTMLCanvasElement;
    try {
      src = await createImageBitmap(rec.blob);
    } catch {
      // Safari/fallback path: decode via <img> → canvas
      src = await new Promise<HTMLCanvasElement>((resolve, reject) => {
        const url = URL.createObjectURL(rec.blob);
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth; c.height = img.naturalHeight;
          c.getContext('2d')!.drawImage(img, 0, 0);
          URL.revokeObjectURL(url);
          resolve(c);
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode failed')) };
        img.src = url;
      });
    }
    bitmaps.set(imageId, { value: src, touched: Date.now() });
    naturals.set(imageId, { w: rec.w || (src as ImageBitmap).width || 100, h: rec.h || (src as ImageBitmap).height || 100 });
    evict();
  })();
  inflight.set(imageId, p);
  try { await p } finally { inflight.delete(imageId) }
}

export function resolveImage(imageId: string): CanvasImageSource | null {
  const e = bitmaps.get(imageId);
  if (e) { touch(bitmaps, imageId); return e.value }
  return null;
}

export function imageNatural(imageId: string): { w: number; h: number } | null {
  const e = bitmaps.get(imageId);
  if (e) {
    const v = e.value;
    const w = (v as ImageBitmap).width ?? 0;
    const h = (v as ImageBitmap).height ?? 0;
    if (w && h) return { w, h };
  }
  return naturals.get(imageId) ?? null;
}

/** Load every image referenced by a page doc before rendering. */
export async function preloadPageImages(
  page: { backgroundImageId: string | null; customTemplateImageId: string | null },
  doc: { elements: { kind: string; imageId?: string }[] } | null,
) {
  const ids = new Set<string>();
  if (page.backgroundImageId) ids.add(page.backgroundImageId);
  if (page.customTemplateImageId) ids.add(page.customTemplateImageId);
  for (const el of doc?.elements ?? []) if (el.kind === 'image' && el.imageId) ids.add(el.imageId);
  await Promise.all([...ids].map((id) => ensureImageLoaded(id).catch(() => null)));
}

export function dropImageCache(imageId?: string) {
  if (imageId) {
    const e = bitmaps.get(imageId);
    if (e) {
      const val = e.value as unknown as ImageBitmap;
      if (typeof val.close === 'function') val.close();
    }
    bitmaps.delete(imageId);
    naturals.delete(imageId);
  } else {
    for (const e of bitmaps.values()) {
      const val = e.value as unknown as ImageBitmap;
      if (typeof val.close === 'function') val.close();
    }
    bitmaps.clear();
    naturals.clear();
  }
}

// ---------------------------------------------------------------- object URLs (for DOM <img>)
const urlCache = new Map<string, string>();

export async function imageURL(imageId: string | null | undefined): Promise<string | null> {
  if (!imageId) return null;
  if (urlCache.has(imageId)) return urlCache.get(imageId)!;
  const rec = await db.getImage(imageId);
  if (!rec?.blob) return null;
  const url = URL.createObjectURL(rec.blob);
  urlCache.set(imageId, url);
  return url;
}

export function revokeImageURL(imageId: string) {
  const url = urlCache.get(imageId);
  if (url) { URL.revokeObjectURL(url); urlCache.delete(imageId) }
}

export function fontDef(id: string) { return id }
