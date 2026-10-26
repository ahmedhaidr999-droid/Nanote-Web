// PDF import — renders each PDF page as a page background beneath the ink layer.
// The original PDF file is stored untouched; annotated copies never modify it.
//
// Robustness (real-world PDFs): CJK/standard-font data and CMaps are bundled
// locally (public/pdf/*) so rendering never touches the network; password-
// protected and damaged files raise typed errors the UI can explain; a single
// bad page never kills the import (it gets a blank background); mixed page
// orientations keep their true aspect ratio.
import * as pdfjs from 'pdfjs-dist';
import * as db from './idb';
import { NotebookRow, PAGE_SIZES, PageRow } from './types';
import { uid } from './util';

pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

const MAX_PAGES = 200;
const MAX_RENDER_WIDTH = 1600;
const MAX_FILE_BYTES = 150 * 1024 * 1024;

export interface PdfImportResult {
  notebookId: string;
  totalPages: number;   // pages in the source PDF
  imported: number;     // pages successfully rendered & stored
  failed: number;       // pages that fell back to a blank background
  capped: boolean;      // source had more than MAX_PAGES pages
}

/** Render one PDF page to a PNG blob, or null when rendering fails. */
async function renderPagePng(page: pdfjs.PDFPageProxy, maxW: number): Promise<{ blob: Blob; w: number; h: number } | null> {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(maxW / base.width, 2);
  const vp = page.getViewport({ scale });
  const c = document.createElement('canvas');
  c.width = Math.ceil(vp.width);
  c.height = Math.ceil(vp.height);
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  // white page background (some PDFs are transparent → invisible ink contrast otherwise)
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvas: c, viewport: vp }).promise;
  const blob = await new Promise<Blob | null>((resolve) => c.toBlob((b) => resolve(b), 'image/png'));
  c.width = 0; c.height = 0; // release
  if (!blob) return null;
  return { blob, w: vp.width, h: vp.height };
}

export async function importPdfAsNotebook(
  file: File,
  onProgress?: (done: number, total: number) => void,
  /** where the imported notebook should live (folder and/or tab) */
  ctx?: { folderId?: string | null; tabId?: string | null },
): Promise<PdfImportResult> {
  if (file.size > MAX_FILE_BYTES) {
    const err = new Error('pdf-too-large') as Error & { name: string };
    err.name = 'PdfTooLargeError';
    throw err;
  }

  // cMaps (CJK text) + standard font data are bundled locally → fully offline
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    cMapUrl: '/pdf/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdf/standard_fonts/',
  });
  const doc = await loadingTask.promise;

  const totalPages = doc.numPages;
  const total = Math.min(totalPages, MAX_PAGES);
  const capped = totalPages > MAX_PAGES;

  const now = Date.now();
  const title = file.name.replace(/\.pdf$/i, '') || 'PDF';
  const first = await doc.getPage(1);
  const vp1 = first.getViewport({ scale: 1 });
  const landscape = vp1.width > vp1.height;
  const pageSize = landscape ? 'a4l' : 'a4p';
  // ink-space page width must match the notebook's declared size or backgrounds
  // distort (landscape A4 is 1123 wide, not 794)
  const pageW = PAGE_SIZES[pageSize].w;

  // store the original file untouched
  const originalImageId = uid();
  await db.putImage({ id: originalImageId, w: Math.round(vp1.width), h: Math.round(vp1.height), name: file.name, createdAt: now, blob: file });

  const notebook: NotebookRow = {
    id: uid(),
    // the import lands directly in the tab/folder the user is browsing —
    // no post-import move, so the location can never be lost again
    folderId: ctx?.folderId ?? null,
    tabId: ctx?.tabId ?? null,
    pdfOriginalId: originalImageId, // the untouched source file — powers the text layer
    title,
    coverId: 'paper-white',
    coverCustomId: null,
    defaultTemplate: 'blank',
    pageSize,
    backgroundHex: '#FFFFFF',
    createdAt: now, updatedAt: now, lastOpenedAt: now,
    isFavorite: false, deletedAt: null,
    sortOrder: 0,
    tagIds: [],
  };
  await db.putNotebook(notebook);

  let imported = 0;
  let failed = 0;

  try {
    for (let i = 1; i <= total; i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      // height in ink-space preserves the page's true aspect ratio at width pageW
      const height = Math.max(120, Math.round(pageW * (base.height / base.width)));

      let imageId: string | null = null;
      try {
        const rendered = await renderPagePng(page, MAX_RENDER_WIDTH);
        if (rendered) {
          imageId = uid();
          await db.putImage({
            id: imageId, w: Math.round(rendered.w), h: Math.round(rendered.h),
            name: `${title}-p${i}.png`, createdAt: now, blob: rendered.blob,
          });
          imported++;
        } else {
          failed++;
        }
      } catch (renderErr) {
        // one damaged page must not kill the whole import
        console.warn(`[nanote] pdf page ${i} render failed`, renderErr);
        failed++;
      }

      const row: PageRow = {
        id: uid(),
        notebookId: notebook.id,
        pageIndex: i - 1,
        template: 'blank',
        backgroundHex: '#FFFFFF',
        customTemplateImageId: null,
        backgroundImageId: imageId,
        isBookmarked: false,
        labels: [],
        createdAt: now, updatedAt: now,
        textIndex: '',
        height,
      };
      await db.putPage(row);
      onProgress?.(i, total);
      if (i % 4 === 0) await new Promise((r) => setTimeout(r, 0)); // yield to UI
    }
  } finally {
    await loadingTask.destroy().catch(() => { /* worker may already be gone */ });
  }

  return { notebookId: notebook.id, totalPages, imported, failed, capped };
}
