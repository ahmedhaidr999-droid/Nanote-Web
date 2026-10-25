'use client';
// textsel — Nanote's OWN text-selection engine for imported-PDF pages.
//
// WHY: relying on the browser's native DOM selection made Android/Chrome
// paint THEIR selection handles + "Copy / Search with Google" bubble right
// on top of our toolbar. The fix is architectural: we never create a native
// selection at all. Selection is computed from caret positions
// (caretRangeFromPoint) and rendered by ourselves (blue rects + our toolbar).
// No native selection ⇒ no native/Google selection UI can ever appear.
//
// The TextLayer renders transparent <span> mirrors of the PDF text; this
// module owns:
//   • caret hit-testing against those spans (with a Firefox fallback),
//   • word-at-caret segmentation (Intl.Segmenter, regex fallback),
//   • the app-owned selection state (anchor/focus carets → merged line
//     rects in page space + world-space toolbar metrics),
//   • a subscribe/useSyncExternalStore bus for React.
import { useSyncExternalStore } from 'react';
import { pageAtWorldY, getVp, type PageLayout } from './viewport';

// ---------------------------------------------------------------- types
export interface CaretPoint { node: Node; offset: number }

export interface SelRect { x: number; y: number; w: number; h: number } // page-space ink coords
export interface PageRects { pageId: string; rects: SelRect[] }

export interface TextSel {
  top: number;      // world-space top edge (toolbar anchor)
  bottom: number;   // world-space bottom edge
  cx: number;        // world-space horizontal center
  byPage: PageRects[];
  text: string;
  anchor: CaretPoint;
  focus: CaretPoint;
}

// ---------------------------------------------------------------- registry (owned by TextLayer)
let mirrorEl: HTMLElement | null = null;
let layouts: PageLayout[] = [];

export function setMirror(el: HTMLElement | null): void { mirrorEl = el }
export function setSelLayouts(ls: PageLayout[]): void { layouts = ls }

// ---------------------------------------------------------------- state bus
let state: TextSel | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

export function getTextSel(): TextSel | null { return state }

export function clearTextSel(): void {
  if (!state) return;
  state = null;
  notify();
}

export function subscribeTextSel(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn) };
}

export function useTextSel(): TextSel | null {
  return useSyncExternalStore(subscribeTextSel, getTextSel, getTextSel);
}

// ---------------------------------------------------------------- caret hit-testing

/** Caret position under a CLIENT point, but only when it lands inside the
 *  text mirror (our transparent PDF spans). Anything else (toolbar, card,
 *  ink surface, page background) returns null. */
export function caretAtPoint(clientX: number, clientY: number): CaretPoint | null {
  const mirror = mirrorEl;
  if (!mirror) return null;
  let caret: CaretPoint | null = null;
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  if (typeof doc.caretRangeFromPoint === 'function') {
    const r = doc.caretRangeFromPoint(clientX, clientY);
    if (r) caret = { node: r.startContainer, offset: r.startOffset };
  } else if (typeof doc.caretPositionFromPoint === 'function') {
    const p = doc.caretPositionFromPoint(clientX, clientY);
    if (p) caret = { node: p.offsetNode, offset: p.offset };
  }
  if (!caret || !caret.node) return null;
  // must be inside one of our mirror spans (a text node, or the span itself)
  let n: Node | null = caret.node;
  while (n) {
    if (n === mirror) return caret;
    n = n.parentNode;
  }
  // primary path hit something else (e.g. caretRangeFromPoint honored
  // pointer-events:none) → manual layout-based hit test on the spans
  return manualCaretAtPoint(clientX, clientY);
}

/** Layout-based caret hit test that does not rely on browser hit-testing at
 *  all: find the mirror span whose (transformed) box contains the point,
 *  then locate the closest character offset via per-caret Range rects. */
function manualCaretAtPoint(clientX: number, clientY: number): CaretPoint | null {
  const mirror = mirrorEl;
  if (!mirror) return null;
  const spans = mirror.querySelectorAll<HTMLElement>('[data-pagetext] > span');
  let best: { node: Node; offset: number; dist: number } | null = null;
  for (const span of spans) {
    const box = span.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    // vertical band must match (allow a little padding)
    if (clientY < box.top - 4 || clientY > box.bottom + 4) continue;
    const textNode = span.firstChild;
    if (!textNode) continue;
    const text = span.textContent ?? '';
    const pad = 2;
    const beyondRight = clientX > box.right + pad;
    const beyondLeft = clientX < box.left - pad;
    if (beyondRight || beyondLeft) {
      // horizontally outside this span's band — candidate only when close
      const dist = beyondRight ? clientX - (box.right + pad) : (box.left - pad) - clientX;
      const cand = { node: textNode, offset: beyondRight ? text.length : 0, dist: dist * dist };
      if (!best || cand.dist < best.dist) best = cand;
      continue;
    }
    // inside the span box: nearest caret offset by scanning caret rects
    let lo = 0, hi = text.length, mid = 0;
    while (lo <= hi) {
      mid = (lo + hi) >> 1;
      const r = document.createRange();
      r.setStart(textNode, mid);
      r.collapse(true);
      const rect = r.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) { lo = mid + 1; continue }
      if (clientX < rect.left) hi = mid - 1;
      else if (clientX > rect.right && mid !== text.length) lo = mid + 1;
      else { best = { node: textNode, offset: mid, dist: -1 }; return { node: textNode, offset: mid } }
    }
    // between carets: pick the boundary the binary search converged on
    const r = document.createRange();
    r.setStart(textNode, Math.min(mid, text.length));
    r.collapse(true);
    const rect = r.getBoundingClientRect();
    const offset = rect.left !== 0 && clientX < rect.left ? Math.max(0, Math.min(mid, text.length)) : Math.min(mid + 1, text.length);
    return { node: textNode, offset };
  }
  if (best) return { node: best.node, offset: best.offset };
  return null;
}

/** Cheap "is there PDF text under this point" probe. */
export function textAtPoint(clientX: number, clientY: number): boolean {
  return caretAtPoint(clientX, clientY) !== null;
}

// ---------------------------------------------------------------- word segmentation
const segmenter: Intl.Segmenter | null =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'word' })
    : null;

/** Word boundaries around a caret inside a text node → {start, end} char
 *  offsets within that node. Falls back to a \p{L}\p{N} run scan. */
export function wordRangeAt(caret: CaretPoint): { start: number; end: number } | null {
  const node = caret.node;
  if (!node) return null;
  const text = node.textContent ?? '';
  const off = Math.min(Math.max(0, caret.offset), text.length);
  if (!text.trim()) return null;

  if (segmenter) {
    for (const seg of segmenter.segment(text)) {
      if (off >= seg.index && off <= seg.index + seg.segment.length) {
        if (/[\p{L}\p{M}\p{N}]/u.test(seg.segment)) return { start: seg.index, end: seg.index + seg.segment.length };
        // whitespace/punct segment at the caret → nearest real word around it
        const before = text.slice(0, off).match(/[\p{L}\p{M}\p{N}]+$/u);
        if (before && before.index !== undefined) return { start: before.index, end: off };
        const after = text.slice(off).match(/^[\p{L}\p{M}\p{N}]+/u);
        if (after) return { start: off, end: off + after[0].length };
        return null;
      }
    }
    return null;
  }
  // regex fallback: expand around the caret within a letter/number run
  let s = off, e = off;
  while (s > 0 && /[\p{L}\p{M}\p{N}]/u.test(text[s - 1])) s--;
  while (e < text.length && /[\p{L}\p{M}\p{N}]/u.test(text[e])) e++;
  if (s === e) return null;
  return { start: s, end: e };
}

/** Document order of two caret points: -1 (a first), 0 (same), 1 (b first). */
export function compareCarets(a: CaretPoint, b: CaretPoint): number {
  try {
    const ra = document.createRange();
    ra.setStart(a.node, a.offset);
    ra.collapse(true);
    const rb = document.createRange();
    rb.setStart(b.node, b.offset);
    rb.collapse(true);
    return ra.compareBoundaryPoints(Range.START_TO_START, rb);
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------- rect math
/** Merge the selection's client rects into one band per text line. */
function mergeLineRects(rects: SelRect[]): SelRect[] {
  const rs = rects.filter((r) => r.w > 0 && r.h > 0);
  rs.sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: SelRect[] = [];
  for (const r of rs) {
    const line = lines.find((l) => r.y < l.y + l.h && l.y < r.y + r.h); // vertical overlap = same line
    if (line) {
      const x0 = Math.min(line.x, r.x), x1 = Math.max(line.x + line.w, r.x + r.w);
      const y0 = Math.min(line.y, r.y), y1 = Math.max(line.y + line.h, r.y + r.h);
      line.x = x0; line.w = x1 - x0; line.y = y0; line.h = y1 - y0;
    } else {
      lines.push({ ...r });
    }
  }
  return lines;
}

/** Build a DOM Range from two caret points (order-independent). */
function rangeFromCarets(a: CaretPoint, b: CaretPoint): Range | null {
  try {
    const r = document.createRange();
    r.setStart(a.node, a.offset);
    r.setEnd(b.node, b.offset);
    return r;
  } catch {
    try {
      const r = document.createRange();
      r.setStart(b.node, b.offset);
      r.setEnd(a.node, a.offset);
      return r;
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------- the app-owned selection

/** Compute + publish the selection between two carets (the ONLY place state
 *  is written). Converts the range's client rects to world/page space using
 *  the mirror's transform. */
export function setSelectionFromCarets(anchor: CaretPoint, focus: CaretPoint): TextSel | null {
  const mirror = mirrorEl;
  if (!mirror) return null;
  const range = rangeFromCarets(anchor, focus);
  if (!range) return null;

  const text = range.toString();
  if (!text.trim()) { clearTextSel(); return null }

  const clientRects = Array.from(range.getClientRects(), (r) => ({ x: r.x, y: r.y, w: r.width, h: r.height }));
  if (!clientRects.length) { clearTextSel(); return null }

  const mirrorRect = mirror.getBoundingClientRect();
  const { scale } = getVp();
  let top = Infinity, bottom = -Infinity, cxSum = 0;
  const byPage = new Map<string, PageRects>();
  const merged = mergeLineRects(clientRects);
  for (const r of merged) {
    const wx = (r.x - mirrorRect.x) / scale;
    const wy = (r.y - mirrorRect.y) / scale;
    const ww = r.w / scale, wh = r.h / scale;
    top = Math.min(top, wy);
    bottom = Math.max(bottom, wy + wh);
    cxSum += wx + ww / 2;
    const layout = pageAtWorldY(layouts, wy + wh / 2);
    if (!layout) continue; // gap between pages
    let entry = byPage.get(layout.id);
    if (!entry) { entry = { pageId: layout.id, rects: [] }; byPage.set(layout.id, entry) }
    entry.rects.push({ x: wx, y: wy - layout.y, w: ww, h: wh });
  }
  if (!byPage.size) { clearTextSel(); return null }

  const next: TextSel = {
    top, bottom, cx: cxSum / merged.length,
    byPage: [...byPage.values()],
    text, anchor, focus,
  };
  state = next;
  notify();
  return next;
}
