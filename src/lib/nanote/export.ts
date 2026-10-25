// Nanote export — PNG (page) and PDF (page/notebook, vector strokes via jsPDF context2d).
// Paper, templates and background/PDF pages are preserved in the output.
import { jsPDF } from 'jspdf';
import * as db from './idb';
import { PageRow, NotebookRow, TextEl, PAGE_SIZES } from './types';
import { renderPage, measureTextEl, drawText } from './render';
import { preloadPageImages, resolveImage, imageNatural, ensureImageLoaded } from './images';
import { downloadBlob, shareBlob, sanitizeFilename } from './util';

const PX_TO_PT = 0.75; // 96dpi CSS px → 72dpi PDF points

export function pageDimensions(page: PageRow, notebook: NotebookRow): { w: number; h: number } {
  const base = PAGE_SIZES[notebook.pageSize] ?? PAGE_SIZES.a4p;
  const w = base.w;
  const h = notebook.pageSize === 'infinite' ? Math.max(page.height || base.h, base.h) : (page.height || base.h);
  return { w, h };
}

// ---------------------------------------------------------------- PNG
export async function renderPageToCanvas(page: PageRow, notebook: NotebookRow, scale = 2): Promise<HTMLCanvasElement> {
  const { doc } = await db.getPageDoc(page.id);
  const { w, h } = pageDimensions(page, notebook);
  await preloadPageImages(page, doc);
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  const ctx = c.getContext('2d')!;
  ctx.scale(scale, scale);
  renderPage(ctx, page, doc, w, h, {
    gamma: 1,
    resolveImage,
    imageNatural,
  });
  return c;
}

export async function exportPagePng(pageId: string): Promise<{ blob: Blob; filename: string }> {
  const page = (await db.listPages()).find((p) => p.id === pageId);
  if (!page) throw new Error('page not found');
  const notebook = (await db.listNotebooks()).find((n) => n.id === page.notebookId);
  if (!notebook) throw new Error('notebook not found');
  const c = await renderPageToCanvas(page, notebook, 2);
  const blob = await new Promise<Blob>((resolve) => c.toBlob((b) => resolve(b!), 'image/png'));
  return { blob, filename: `${sanitizeFilename(notebook.title)}-p${page.pageIndex + 1}.png` };
}

// ---------------------------------------------------------------- PDF helpers
function isLatinOnly(s: string): boolean {
  // PDF standard fonts can't shape complex scripts — rasterize anything else
  return /^[\x00-\x024F\u2000-\u206F\u2190-\u2BFF\uE000-\uFFFD]*$/.test(s);
}

function pdfContext(pdf: jsPDF): CanvasRenderingContext2D {
  // jsPDF's context2d is API-compatible with the 2D context our renderer targets
  return pdf.context2d as unknown as CanvasRenderingContext2D;
}

function rasterizeText(el: TextEl, scale = 3): HTMLCanvasElement | null {
  const c = document.createElement('canvas');
  const probe = c.getContext('2d')!;
  const { lines, lineHeight } = measureTextEl(probe, el);
  const width = Math.max(10, el.w);
  const height = Math.max(10, lines.length * lineHeight + el.size * 0.35);
  c.width = Math.ceil(width * scale);
  c.height = Math.ceil(height * scale);
  const ctx = c.getContext('2d')!;
  ctx.scale(scale, scale);
  drawText(ctx, { ...el, y: 0 });
  return c;
}

// ---------------------------------------------------------------- PDF
async function buildPdf(notebook: NotebookRow, pages: PageRow[]): Promise<Blob> {
  const sorted = [...pages].sort((a, b) => a.pageIndex - b.pageIndex);
  if (!sorted.length) throw new Error('no pages');
  const first = sorted[0];
  const dim0 = pageDimensions(first, notebook);
  const pdf = new jsPDF({
    unit: 'pt',
    format: [dim0.w * PX_TO_PT, dim0.h * PX_TO_PT],
    compress: true,
    orientation: dim0.w > dim0.h ? 'landscape' : 'portrait',
  });
  const ctx = pdfContext(pdf);

  for (let i = 0; i < sorted.length; i++) {
    const page = sorted[i];
    const { doc } = await db.getPageDoc(page.id);
    const { w, h } = pageDimensions(page, notebook);
    if (i > 0) {
      pdf.addPage([w * PX_TO_PT, h * PX_TO_PT], w > h ? 'landscape' : 'portrait');
    }
    await preloadPageImages(page, doc);
    ctx.save();
    ctx.scale(PX_TO_PT, PX_TO_PT);
    ctx.clearRect(0, 0, w, h);

    // raster the non-Latin text boxes (context2d can't shape Arabic)
    const rasterTexts = new Map<string, HTMLCanvasElement>();
    for (const el of doc?.elements ?? []) {
      if (el.kind === 'text' && el.text && !isLatinOnly(el.text)) {
        const raster = rasterizeText(el);
        if (raster) rasterTexts.set(el.id, raster);
      }
    }
    // hide the original non-Latin text boxes, draw their rasters after the page render
    const hideIds = new Set(rasterTexts.keys());
    renderPage(ctx, page, doc, w, h, {
      gamma: 1,
      resolveImage,
      imageNatural,
      hideIds,
    });
    for (const el of doc?.elements ?? []) {
      if (el.kind !== 'text' || !rasterTexts.has(el.id)) continue;
      const raster = rasterTexts.get(el.id)!;
      const ratioH = (el.text.split('\n').length * el.size * 1.35 + el.size * 0.35);
      try {
        ctx.drawImage(raster, el.x, el.y, Math.max(raster.width / 3, el.w), ratioH);
      } catch { /* ignore */ }
    }
    ctx.restore();
  }
  return pdf.output('blob');
}

async function shareOrDownload(blob: Blob, filename: string, title: string) {
  await shareBlob(blob, filename, title);
}

export async function exportPagePdf(pageId: string): Promise<void> {
  const page = (await db.listPages()).find((p) => p.id === pageId);
  if (!page) throw new Error('page not found');
  const notebook = (await db.listNotebooks()).find((n) => n.id === page.notebookId);
  if (!notebook) throw new Error('notebook not found');
  const blob = await buildPdf(notebook, [page]);
  await shareOrDownload(blob, `${sanitizeFilename(notebook.title)}-p${page.pageIndex + 1}.pdf`, notebook.title);
}

export async function exportNotebookPdf(notebookId: string): Promise<void> {
  const notebook = (await db.listNotebooks()).find((n) => n.id === notebookId);
  if (!notebook) throw new Error('notebook not found');
  const pages = (await db.listPages()).filter((p) => p.notebookId === notebookId);
  if (!pages.length) throw new Error('no pages');
  const blob = await buildPdf(notebook, pages);
  await shareOrDownload(blob, `${sanitizeFilename(notebook.title)}.pdf`, notebook.title);
}

/** Export an arbitrary subset of pages (pages dialog multi-select) as one PDF. */
export async function exportPagesPdf(notebookId: string, pageIds: string[]): Promise<void> {
  const notebook = (await db.listNotebooks()).find((n) => n.id === notebookId);
  if (!notebook) throw new Error('notebook not found');
  const idSet = new Set(pageIds);
  const pages = (await db.listPages()).filter((p) => p.notebookId === notebookId && idSet.has(p.id));
  if (!pages.length) throw new Error('no pages');
  const blob = await buildPdf(notebook, pages);
  await shareOrDownload(blob, `${sanitizeFilename(notebook.title)}-pages.pdf`, notebook.title);
}

/** used by the editor share menu */
export async function sharePagePng(pageId: string): Promise<void> {
  const { blob, filename } = await exportPagePng(pageId);
  await shareOrDownload(blob, filename, 'Nanote');
}

export { ensureImageLoaded, downloadBlob };
