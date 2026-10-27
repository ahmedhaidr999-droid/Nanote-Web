// Raster cache — device Cache Storage for rendered page bitmaps.
// A page raster (paper + PDF background + ink at a given scale bucket) is the
// most expensive thing the editor renders. Caching it in the browser's
// Cache Storage makes re-opening notebooks and zoom settle-back instant and
// keeps the main thread free during navigation.
const CACHE_NAME = 'nanote-rasters-v2';

let cachePromise: Promise<Cache | null> | null = null;

function openCache(): Promise<Cache | null> {
  if (!cachePromise) {
    cachePromise = (async () => {
      try {
        if (typeof caches === 'undefined' || !caches.open) return null;
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
  hiOpacity: number;    // highlighter opacity (%) — affects the rendered colors
}

function urlOf(k: RasterKey): string {
  return `/__nanote-raster/${k.pageId}?v=${k.docVersion}&r=${k.raster.toFixed(2)}&w=${Math.round(k.pageW)}&h=${Math.round(k.pageH)}&g=${k.gamma.toFixed(2)}&hi=${Math.round(k.hiOpacity)}`;
}

/** Look up a cached raster bitmap; null on miss or decode failure. */
export async function getCachedRaster(k: RasterKey): Promise<ImageBitmap | null> {
  const cache = await openCache();
  if (!cache) return null;
  try {
    const hit = await cache.match(urlOf(k));
    if (!hit) return null;
    const blob = await hit.blob();
    if (!blob.size) return null;
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

/** Store a canvas render into the cache (async, best-effort, size-capped). */
export async function putCachedRaster(k: RasterKey, canvas: HTMLCanvasElement): Promise<void> {
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
  try {
    if (typeof caches === 'undefined' || !caches.delete) return;
    await caches.delete(CACHE_NAME);
    cachePromise = null;
  } catch { /* ignore */ }
}
