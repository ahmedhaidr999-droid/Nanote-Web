// Raster cache — device Cache Storage for rendered page bitmaps.
// A page raster (paper + PDF background + ink at a given scale bucket) is the
// most expensive thing the editor renders. Caching it in the browser's
// Cache Storage makes re-opening notebooks and zoom settle-back instant and
// keeps the main thread free during navigation.
// v3 — drops every v2 raster: v2 could store IMAGE-INCOMPLETE renders (PDF
// background still decoding) that then served blank pages forever; v3 only
// ever stores complete renders, so old poisoned entries must not survive.
const CACHE_NAME = 'nanote-rasters-v3';
const LEGACY_CACHES = ['nanote-rasters-v2', 'nanote-rasters-v1'];

let cachePromise: Promise<Cache | null> | null = null;

function openCache(): Promise<Cache | null> {
  if (!cachePromise) {
    cachePromise = (async () => {
      try {
        if (typeof caches === 'undefined' || !caches.open) return null;
        // best-effort one-time cleanup of pre-v3 namespaces (poisoned rasters)
        for (const legacy of LEGACY_CACHES) { try { await caches.delete(legacy) } catch { /* ignore */ } }
        return await caches.open(CACHE_NAME);
      } catch {
        return null;
      }
    })();
  }
  return cachePromise;
}

export interface RasterKey {
  pageId: string;
  docVersion: number;
  raster: number;      // raster scale bucket
  pageW: number;
  pageH: number;
  gamma: number;
  hiOpacity?: number;  // highlighter opacity (%) — affects the render
}

function urlOf(k: RasterKey): string {
  return `/__nanote-raster/${k.pageId}?v=${k.docVersion}&r=${k.raster.toFixed(2)}&w=${Math.round(k.pageW)}&h=${Math.round(k.pageH)}&g=${k.gamma.toFixed(2)}&ho=${Math.round(k.hiOpacity ?? 40)}`;
}

// ---------------------------------------------------------------- in-memory LRU
// Decoded bitmaps kept hot in RAM. Flipping pages back and forth used to hit
// Cache Storage + PNG-decode every single time a culled page remounted —
// that decode is 10–40ms per page and stacked up into visible scroll jank.
// A small LRU (keyed exactly like the persistent cache) makes revisits free.
//
// MEMORY: the old cap was a fixed 14 ENTRIES — up to 14 × 4 bytes/px of
// device-raster bitmaps (a single 2× A4 raster is ≈14 MB ⇒ ~200 MB worst
// case, an OOM vector on 2–4 GB Android devices, doubled while the Split
// Workspace runs a second instance). The budget is now measured in BYTES,
// scaled to the device (≈6% of reported RAM, capped), and halved inside
// embedded split panes.
function memBudgetBytes(): number {
  let gb = 4;
  try {
    gb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  } catch { /* guarded */ }
  let bytes = Math.round(Math.min(96, Math.max(24, gb * 12)) * 1024 * 1024);
  try {
    if (window !== window.top) bytes = Math.round(bytes / 2); // embedded split pane
  } catch { /* cross-origin — assume embedded */ }
  return bytes;
}
const bmpBytes = (b: ImageBitmap) => Math.max(1, b.width * b.height * 4);
const memCache = new Map<string, ImageBitmap>();
let memBytes = 0;

function memGet(url: string): ImageBitmap | null {
  const hit = memCache.get(url);
  if (hit) {
    // refresh recency (Map preserves insertion order)
    memCache.delete(url);
    memCache.set(url, hit);
    return hit;
  }
  return null;
}

function memPut(url: string, bmp: ImageBitmap): void {
  if (memCache.has(url)) {
    const old = memCache.get(url)!;
    memBytes -= bmpBytes(old);
    memCache.delete(url);
  }
  memCache.set(url, bmp);
  memBytes += bmpBytes(bmp);
  const budget = memBudgetBytes();
  while (memBytes > budget && memCache.size > 1) {
    const oldest = memCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    const ev = memCache.get(oldest);
    memCache.delete(oldest);
    if (ev) {
      memBytes -= bmpBytes(ev);
      try { ev.close() } catch { /* already closed */ }
    }
  }
}

function memEvictPage(pageId: string): void {
  const prefix = `/__nanote-raster/${pageId}?`;
  for (const [url, bmp] of memCache) {
    if (url.includes(prefix)) {
      memCache.delete(url);
      memBytes -= bmpBytes(bmp);
      try { bmp.close() } catch { /* already closed */ }
    }
  }
}

/** Look up a cached raster bitmap; null on miss or decode failure. */
export async function getCachedRaster(k: RasterKey): Promise<ImageBitmap | null> {
  const url = urlOf(k);
  const hot = memGet(url);
  if (hot) return hot;
  const cache = await openCache();
  if (!cache) return null;
  try {
    const hit = await cache.match(url);
    if (!hit) return null;
    const blob = await hit.blob();
    if (!blob.size) return null;
    const bmp = await createImageBitmap(blob);
    memPut(url, bmp);
    return bmp;
  } catch {
    return null;
  }
}

/** Store a canvas render into the cache (async, best-effort, size-capped). */
export async function putCachedRaster(k: RasterKey, canvas: HTMLCanvasElement): Promise<void> {
  // hot copy first — the RAM layer serves revisits without any decode
  try {
    const hot = await createImageBitmap(canvas);
    memPut(urlOf(k), hot);
  } catch { /* RAM layer is best-effort */ }
  const cache = await openCache();
  if (!cache) return;
  try {
    // cap: don't poison the cache with gigantic bitmaps
    const px = canvas.width * canvas.height;
    if (px > 14_000_000) return;
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob((b) => res(b), 'image/png'));
    if (!blob || blob.size > 8 * 1024 * 1024) return;
    await cache.put(urlOf(k), new Response(blob, { headers: { 'Content-Type': 'image/png' } }));
  } catch {
    /* quota or serialization issue — cache is best-effort */
  }
}

/** Drop every cached raster whose pageId matches (page deleted / restored over). */
export async function evictCachedRasters(pageId: string): Promise<void> {
  memEvictPage(pageId);
  const cache = await openCache();
  if (!cache) return;
  try {
    const keys = await cache.keys();
    const prefix = `/__nanote-raster/${pageId}?`;
    await Promise.all(keys.filter((r) => r.url.includes(prefix)).map((r) => cache.delete(r)));
  } catch { /* ignore */ }
}

/** Clear the whole raster cache (settings "clear cache"). */
export async function clearRasterCache(): Promise<void> {
  for (const bmp of memCache.values()) { try { bmp.close() } catch { /* closed */ } }
  memCache.clear();
  memBytes = 0;
  try {
    if (typeof caches === 'undefined' || !caches.delete) return;
    await caches.delete(CACHE_NAME);
    cachePromise = null;
  } catch { /* ignore */ }
}
