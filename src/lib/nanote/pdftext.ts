// PDF text-layer extraction — lazily parses the ORIGINAL stored PDF file
// (notebook.pdfOriginalId) with pdf.js and maps every text item into
// ink-space page units (y-down from the page top), so the editor can overlay
// real, selectable DOM text on top of the rendered page background.
//
// Caching ladder per page: in-memory Map → IndexedDB 'pdftext' store →
// parse-once-then-persist. Open pdf.js documents live in a tiny module-level
// LRU keyed by the stored original's image id, so reading several pages of
// one PDF does NOT re-open the file per page, and hopping between notebooks
// keeps at most two file handles alive (evicted ones are destroyed).
import * as pdfjs from 'pdfjs-dist';
import * as db from './idb';
import { NotebookRow, PAGE_SIZES, PageRow, PdfTextItem } from './types';

pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

const memCache = new Map<string, PdfTextItem[]>();
const inflight = new Map<string, Promise<PdfTextItem[] | null>>();

// ---------------------------------------------------------------- pdf.js document LRU
const DOC_LRU_MAX = 2;
interface OpenDoc { task: pdfjs.PDFDocumentLoadingTask; doc: pdfjs.PDFDocumentProxy }
const docLru = new Map<string, Promise<OpenDoc>>();

async function openPdfDoc(imageId: string): Promise<OpenDoc> {
  const hit = docLru.get(imageId);
  if (hit) {
    // refresh LRU position (most-recently-used goes to the end)
    docLru.delete(imageId);
    docLru.set(imageId, hit);
    return hit;
  }
  const img = await db.getImage(imageId);
  if (!img) throw new Error(`[nanote] stored PDF original is missing: ${imageId}`);
  const task = pdfjs.getDocument({
    data: new Uint8Array(await img.blob.arrayBuffer()),
    cMapUrl: '/pdf/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdf/standard_fonts/',
  });
  const p: Promise<OpenDoc> = task.promise.then((doc) => ({ task, doc }));
  docLru.set(imageId, p);
  // evict the least-recently-used open document (never the one just opened)
  while (docLru.size > DOC_LRU_MAX) {
    const oldest = docLru.keys().next().value;
    if (oldest === undefined) break;
    const evicted = docLru.get(oldest);
    docLru.delete(oldest);
    evicted
      ?.then(({ task: t }) => { void t.destroy().catch(() => { /* worker may already be gone */ }) })
      .catch(() => { /* the open itself failed — nothing to destroy */ });
  }
  return p;
}

async function extract(page: PageRow, notebook: NotebookRow): Promise<PdfTextItem[] | null> {
  // 1) IndexedDB cache (pages parsed earlier)
  const rec = await db.getPdfText(page.id);
  if (rec) {
    memCache.set(page.id, rec.items);
    return rec.items;
  }

  // 2) parse from the stored original file
  const originalId = notebook.pdfOriginalId;
  if (!originalId) return null; // pre-text-layer import — no original stored
  try {
    const { doc } = await openPdfDoc(originalId);
    const num = Math.min(Math.max(1, page.pageIndex + 1), doc.numPages);
    const pdfPage = await doc.getPage(num);
    const vpBase = pdfPage.getViewport({ scale: 1 });
    const pageW = PAGE_SIZES[notebook.pageSize].w;
    const k = pageW / vpBase.width; // pdf scale-1 viewport units → ink-space units
    const tc = await pdfPage.getTextContent();
    const items: PdfTextItem[] = [];
    for (const raw of tc.items) {
      if (!('str' in raw)) continue; // TextMarkedContent carries no glyphs
      if (!raw.str.trim()) continue;
      const t = raw.transform as number[]; // [a,b,c,d,e,f] — e,f = origin in PDF user space (y-UP, scale 1)
      items.push({
        str: raw.str,
        x: t[4] * k,
        // glyph height = length of the transform's vertical axis
        h: Math.max(1, Math.hypot(t[2], t[3]) * k),
        // flip y: baseline origin → top of the glyph box, then scale
        y: Math.max(0, (vpBase.height - t[5] - raw.height) * k),
        w: Math.max(1, raw.width * k),
      });
    }
    memCache.set(page.id, items);
    void db.putPdfText({ pageId: page.id, items, updatedAt: Date.now() }).catch(() => { /* cache write is best-effort */ });
    return items;
  } catch (e) {
    console.warn(`[nanote] pdf text extract failed for page index ${page.pageIndex}`, e);
    return null;
  }
}

/**
 * Lazily ensure the ink-space text items for one imported-PDF page.
 * Returns null when the page can never yield text (no stored original /
 * damaged file); an empty array means the page genuinely has no text
 * (e.g. a scanned image PDF).
 */
export async function ensurePdfText(page: PageRow, notebook: NotebookRow): Promise<PdfTextItem[] | null> {
  const hit = memCache.get(page.id);
  if (hit) return hit;
  const running = inflight.get(page.id);
  if (running) return running;
  const p = extract(page, notebook).finally(() => { inflight.delete(page.id) });
  inflight.set(page.id, p);
  return p;
}

// ---------------------------------------------------------------- vector background
// High-fidelity zoom (Notewise-style sharp text): instead of upscaling the
// stored PNG page snapshot (~2x at import), re-render the page VECTOR from
// the untouched original PDF at the CURRENT raster scale. The LRU keeps at
// most two open pdf.js documents alive (shared with the text extractor).

/** Render one PDF page's content into `canvas` at ink-width × raster pixels.
 *  Returns false when there is no original (or rendering fails) — the caller
 *  then falls back to the stored raster PNG.
 *  `win` (page-local slice) renders only that window — used by the zoomed-in
 *  windowed page renderer so vector text stays razor-sharp at ANY zoom
 *  without ever allocating a full-page bitmap at extreme rasters. */
export async function renderPdfPageVector(
  page: PageRow,
  notebook: NotebookRow,
  canvas: HTMLCanvasElement,
  raster: number,
  pageW: number,
  win?: { x0: number; y0: number; x1: number; y1: number },
): Promise<boolean> {
  const originalId = notebook.pdfOriginalId;
  if (!originalId || raster <= 0) return false;
  try {
    const { doc } = await openPdfDoc(originalId);
    const num = Math.min(Math.max(1, page.pageIndex + 1), doc.numPages);
    const pdfPage = await doc.getPage(num);
    const vpBase = pdfPage.getViewport({ scale: 1 });
    const scale = (pageW * raster) / vpBase.width;
    const vp = pdfPage.getViewport({ scale });
    let w = Math.max(2, Math.ceil(vp.width));
    let h = Math.max(2, Math.ceil(vp.height));
    let transform: number[] | undefined;
    if (win) {
      // slice: size the canvas to the window and translate the page render
      // so the window rect lands at the canvas origin (pdf.js applies the
      // render transform in device space)
      w = Math.max(2, Math.ceil((win.x1 - win.x0) * raster));
      h = Math.max(2, Math.ceil((win.y1 - win.y0) * raster));
      transform = [1, 0, 0, 1, -win.x0 * raster, -win.y0 * raster];
    }
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#FFFFFF'; // transparent PDF pages must stay readable
    ctx.fillRect(0, 0, w, h);
    await pdfPage.render({ canvas, viewport: vp, transform }).promise;
    return true;
  } catch (e) {
    console.warn(`[nanote] vector render failed for page index ${page.pageIndex}`, e);
    return false;
  }
}
