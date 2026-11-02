'use client';
// Notebook content previews — the file browser's "what's inside" thumbnails.
//
// Renders the FIRST page of a notebook (paper + ink + images, the exact same
// renderer as the editor and the Pages popup) into a ~320px-wide PNG and
// caches it three ways:
//   1. an in-memory LRU (instant re-mounts while scrolling the library),
//   2. the IDB `nbPreviews` store (survives restarts; keyed by a content
//      revision so edits automatically invalidate),
//   3. a bounded-concurrency render queue (max 2 at a time — a library with
//      thousands of notebooks must not stampede the CPU on open).
//
// Previews render LAZILY: cards hand the system an IntersectionObserver-watched
// element and only visible cards ever request a render; unmounted cards are
// cancelled via a generation token.
import { useCallback, useEffect, useRef, useState } from 'react';
import * as db from '@/lib/nanote/idb';
import { preloadPageImages, resolveImage, imageNatural } from '@/lib/nanote/images';
import { renderPage } from '@/lib/nanote/render';
import { useApp } from '@/lib/nanote/store';
import type { NotebookRow } from '@/lib/nanote/types';

const PREVIEW_W = 320;              // px — crisp on tablets, ~40–60 KB PNG each
const MEM_LRU_MAX = 150;            // entries (~8 MB worst case)
const MAX_CONCURRENT = 2;

// ---------------------------------------------------------------- memory LRU
const memCache = new Map<string, { dataUrl: string; rev: string }>();
function memGet(key: string, rev: string): string | null {
  const hit = memCache.get(key);
  if (!hit || hit.rev !== rev) return null;
  // refresh LRU position
  memCache.delete(key);
  memCache.set(key, hit);
  return hit.dataUrl;
}
function memPut(key: string, rev: string, dataUrl: string) {
  memCache.set(key, { dataUrl, rev });
  while (memCache.size > MEM_LRU_MAX) memCache.delete(memCache.keys().next().value as string);
}

// ---------------------------------------------------------------- render queue
type Job = () => Promise<void>;
const queue: Job[] = [];
let running = 0;
function pump() {
  while (running < MAX_CONCURRENT && queue.length) {
    const job = queue.shift() as Job;
    running++;
    void job().finally(() => {
      running--;
      pump();
    });
  }
}

// ---------------------------------------------------------------- core
/** content revision — changes whenever the notebook or its first page changes,
 *  so cached previews auto-invalidate after edits. */
function previewRev(nb: NotebookRow): string {
  const st = useApp.getState();
  const page = st.pages
    .filter((p) => p.notebookId === nb.id)
    .sort((a, b) => a.pageIndex - b.pageIndex)[0];
  return `${nb.updatedAt}:${st.pageCounts[nb.id] ?? 0}:${page?.updatedAt ?? 0}:${page?.docRev ?? 0}`;
}

async function renderPreview(nb: NotebookRow): Promise<string> {
  const st = useApp.getState();
  const page = st.pages
    .filter((p) => p.notebookId === nb.id)
    .sort((a, b) => a.pageIndex - b.pageIndex)[0];
  if (!page) return '';
  const { doc } = await db.getPageDoc(page.id);
  // decode referenced images BEFORE rasterizing — otherwise PDF page previews
  // render as blank paper (same rule as thumbs.ts)
  await preloadPageImages(page, doc);
  const padX = page.padX ?? 0;
  const padY = page.padY ?? 0;
  const pageW = page.width ?? 794;
  const pw = pageW + padX;
  const ph = page.height + padY;
  const scale = PREVIEW_W / pw;
  const c = document.createElement('canvas');
  c.width = PREVIEW_W;
  c.height = Math.max(40, Math.round(ph * scale));
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  ctx.setTransform(scale, 0, 0, scale, padX * scale, padY * scale);
  renderPage(ctx, page, doc, pageW, page.height, {
    gamma: st.settings.pressureCurve,
    highlighterOpacity: st.settings.highlighterOpacity,
    resolveImage,
    imageNatural,
    win: { x0: -padX, y0: -padY, x1: pageW, y1: page.height },
    infinite: nb.pageSize === 'infinite',
  });
  return c.toDataURL('image/png');
}

const inflight = new Map<string, Promise<string | null>>();

/** Resolve a notebook's content preview — cached, deduped, queued. */
export function getNotebookPreview(nb: NotebookRow): Promise<string | null> {
  const rev = previewRev(nb);
  if (memGet(nb.id, rev)) return Promise.resolve(memGet(nb.id, rev));
  const running0 = inflight.get(nb.id);
  if (running0) return running0;
  const p = new Promise<string | null>((resolve) => {
    queue.push(async () => {
      // cached in IDB under the SAME revision? instant hit
      try {
        const rec = await db.getNbPreview(nb.id);
        if (rec && rec.rev === rev && rec.dataUrl) {
          memPut(nb.id, rev, rec.dataUrl);
          resolve(rec.dataUrl);
          return;
        }
      } catch { /* fall through to render */ }
      try {
        const dataUrl = await renderPreview(nb);
        if (dataUrl) {
          memPut(nb.id, rev, dataUrl);
          void db.putNbPreview({ notebookId: nb.id, dataUrl, rev }).catch(() => {});
          resolve(dataUrl);
        } else {
          resolve(null); // no pages (shouldn't happen) — caller falls back to cover
        }
      } catch {
        resolve(null);
      }
    });
  }).finally(() => inflight.delete(nb.id));
  inflight.set(nb.id, p);
  pump();
  return p;
}

/** Drop a notebook's cached preview (e.g. after an edit while the library is
 *  mounted — cheap; the next visible request re-renders). */
export function invalidateNotebookPreview(notebookId: string) {
  memCache.delete(notebookId);
}

// ---------------------------------------------------------------- lazy hook
/**
 * `useNotebookPreview(nb, enabled)` — returns the preview dataUrl for a
 * notebook, rendering it ONLY once the ref'd element scrolls near the
 * viewport (rootMargin ~240px). Never requests for offscreen cards, and
 * re-requests automatically when the notebook is edited while visible.
 */
export function useNotebookPreview(
  nb: NotebookRow,
  enabled: boolean,
): { setEl: (el: HTMLElement | null) => void; previewUrl: string | null } {
  // cache identity: notebook + its last edit + the mode toggle. nb.updatedAt
  // changes on every store patch of the row, so stale previews never linger.
  const cacheKey = `${nb.id}|${nb.updatedAt}|${enabled ? 1 : 0}`;
  const [state, setState] = useState<{ key: string; url: string | null }>(() => ({
    key: cacheKey,
    url: enabled ? memGet(nb.id, previewRev(nb)) : null,
  }));

  // resync from the memory cache when the key changes — the React-blessed
  // "set state during render" derived-reset (no effect, no render cascade:
  // React re-runs the component immediately and commits once).
  if (state.key !== cacheKey) {
    setState({ key: cacheKey, url: enabled ? memGet(nb.id, previewRev(nb)) : null });
  }
  const url = state.key === cacheKey
    ? state.url
    : enabled ? memGet(nb.id, previewRev(nb)) : null;

  const elRef = useRef<HTMLElement | null>(null);
  const [elTick, setElTick] = useState(0); // re-run the observer when the node attaches
  const visibleRef = useRef(false);        // became visible at least once this mount
  const genRef = useRef(0);                // cancel superseded requests

  const setEl = useCallback((el: HTMLElement | null) => {
    elRef.current = el;
    setElTick((t) => t + 1);
  }, []);

  // lazy render: subscribe to visibility with a one-shot IntersectionObserver;
  // once visible, request. If the card was already visible (mode flip without
  // scroll), request at once.
  useEffect(() => {
    const el = elRef.current;
    if (!el || !enabled) return;
    const request = () => {
      const gen = ++genRef.current;
      const key = cacheKey;
      void getNotebookPreview(nb).then((u) => {
        if (gen === genRef.current && u) setState({ key, url: u });
      }).catch(() => { /* keep the cover fallback */ });
    };
    if (visibleRef.current) {
      request();
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        visibleRef.current = true;
        io.disconnect();
        request();
      },
      { rootMargin: '240px 0px' }, // start slightly before it's on screen
    );
    io.observe(el);
    return () => io.disconnect();
    // `nb` object identity churns on every store tick — keying on id/updatedAt
    // keeps the observer armed only for real content changes.
  }, [elTick, nb.id, nb.updatedAt, enabled, cacheKey]);

  return { setEl, previewUrl: url };
}
