'use client';
// On-demand thumbnail rendering — shared by EditorShell (keeps the IDB cache
// warm after edits) and PagesDialog (renders missing pages on open so no tile
// in the Pages popup is ever blank, including never-visited PDF pages).
import * as db from '@/lib/nanote/idb';
import { preloadPageImages, resolveImage, imageNatural } from '@/lib/nanote/images';
import { renderPage } from '@/lib/nanote/render';
import { useApp } from '@/lib/nanote/store';
import { PageRow } from '@/lib/nanote/types';

const THUMB_W = 132;
const inflight = new Map<string, Promise<string>>();

async function renderToDataUrl(page: PageRow, pageW: number): Promise<string> {
  const { doc } = await db.getPageDoc(page.id);
  // decode every image the page references (backgrounds, templates, elements)
  // BEFORE rasterizing — otherwise PDF page thumbs render as blank paper.
  await preloadPageImages(page, doc);
  const scale = THUMB_W / pageW;
  const h = Math.max(40, Math.round(page.height * scale));
  const c = document.createElement('canvas');
  c.width = THUMB_W;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  ctx.scale(scale, scale);
  renderPage(ctx, page, doc, pageW, page.height, {
    gamma: useApp.getState().settings.pressureCurve,
    highlighterOpacity: useApp.getState().settings.highlighterOpacity,
    resolveImage,
    imageNatural,
  });
  return c.toDataURL('image/png');
}

/** Force re-render + store (page content changed). */
export async function refreshThumb(page: PageRow, pageW: number): Promise<string> {
  const dataUrl = await renderToDataUrl(page, pageW);
  if (dataUrl) await db.putThumb({ pageId: page.id, dataUrl, updatedAt: Date.now() });
  return dataUrl;
}

/** Return the cached thumbnail if present, else render once and store.
 *  Concurrent calls for the same page share one render. */
export async function ensureThumb(page: PageRow, pageW: number): Promise<string> {
  const rec = await db.getThumb(page.id);
  if (rec?.dataUrl) return rec.dataUrl;
  const running = inflight.get(page.id);
  if (running) return running;
  const p = refreshThumb(page, pageW).finally(() => inflight.delete(page.id));
  inflight.set(page.id, p);
  return p;
}
