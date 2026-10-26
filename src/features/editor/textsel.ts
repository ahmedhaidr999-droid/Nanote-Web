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
import { glyphBand } from '@/lib/nanote/pdftext';

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
  picked?: boolean;  // fresh long-press/tap word pick → rects pop in once
  tight?: boolean;   // rects are glyph-band tight (PDF baseline metrics present)
  startPt: { x: number; y: number } | null; // world-space anchor of the start drag handle
  endPt: { x: number; y: number } | null;   // …and of the end handle (document order)
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

/**
 * TIGHT glyph-band rects — the "selection is bigger than the text" fix.
 * The DOM span boxes span the full em (line-height), but the VISIBLE ink of
 * the selected characters is usually far shorter: a word like "more" only
 * reaches x-height, "yes" adds one descender, "Type" the cap height. For each
 * text-node FRAGMENT of the range we read the parent span's PDF-derived
 * baseline (data-b) + em size (data-f), classify the fragment's characters
 * (glyphBand) and emit a rect that hugs the real ink — so the selection
 * indicator, the highlighter band and the underline all match the text and
 * never cross into the line above or below.
 * Returns null when any fragment lacks the PDF metrics (pre-basline cache)
 * — the caller then falls back to the legacy full-em rects.
 */
function tightFragments(range: Range, scale: number): { pageId: string; rects: SelRect[] }[] | null {
  const out = new Map<string, SelRect[]>();
  // enumerate the range's text-node fragments
  const frags: { node: Text; start: number; end: number }[] = [];
  const root = range.commonAncestorContainer;
  if (root.nodeType === Node.TEXT_NODE) {
    const t = root as Text;
    let s = 0, e = (t.data ?? '').length;
    if (range.startContainer === t) s = range.startOffset;
    if (range.endContainer === t) e = range.endOffset;
    if (range.startContainer === t && range.endContainer === t) { s = range.startOffset; e = range.endOffset }
    if (e > s) frags.push({ node: t, start: s, end: e });
  } else {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const t = n as Text;
      let s = 0, e = (t.data ?? '').length;
      if (t === range.startContainer) s = range.startOffset;
      if (t === range.endContainer) e = range.endOffset;
      if (e > s) frags.push({ node: t, start: s, end: e });
    }
  }
  if (!frags.length) return null;
  for (const frag of frags) {
    const span = frag.node.parentElement;
    if (!span) return null;
    const bAttr = span.getAttribute('data-b');
    const fAttr = span.getAttribute('data-f');
    const pageDiv = (span.closest('[data-pagetext]') as HTMLElement | null);
    if (bAttr == null || fAttr == null || !pageDiv) return null; // legacy spans → fallback
    const b = +bAttr, f = Math.max(1, +fAttr);
    // fragment client rect (union of its sub-range rects)
    let r: { x: number; y: number; width: number; height: number } | null = null;
    try {
      const sub = document.createRange();
      sub.setStart(frag.node, frag.start);
      sub.setEnd(frag.node, frag.end);
      for (const cr of sub.getClientRects()) {
        if (!r) r = { x: cr.x, y: cr.y, width: cr.width, height: cr.height };
        else {
          const x0 = Math.min(r.x, cr.x), y0 = Math.min(r.y, cr.y);
          r = { x: x0, y: y0, width: Math.max(r.x + r.width, cr.x + cr.width) - x0, height: Math.max(r.y + r.height, cr.y + cr.height) - y0 };
        }
      }
    } catch { return null }
    if (!r) return null;
    // client → page-local (the page div already carries the world transform)
    const pd = pageDiv.getBoundingClientRect();
    const px = (r.x - pd.left) / scale;
    const pw = r.width / scale;
    // the ink band of THIS fragment's characters
    const band = glyphBand(frag.node.data.slice(frag.start, frag.end));
    const top = b - band.asc * f;
    const bottom = b + band.desc * f;
    const pageId = pageDiv.dataset.pagetext ?? '';
    let list = out.get(pageId);
    if (!list) { list = []; out.set(pageId, list) }
    list.push({ x: px, y: top, w: pw, h: Math.max(1, bottom - top) });
  }
  const byPage: { pageId: string; rects: SelRect[] }[] = [];
  for (const [pageId, rects] of out) {
    const merged = mergeLineRects(rects);
    if (merged.length) byPage.push({ pageId, rects: merged });
  }
  return byPage.length ? byPage : null;
}

/** Client point of a caret via its collapsed range rect — the drag handles
 *  ride ~0.73em down the line, just above the baseline like native grips.
 *  Null when the browser reports no measurable rect for the caret. */
function caretClientPoint(c: CaretPoint): { x: number; y: number } | null {
  try {
    const r = document.createRange();
    r.setStart(c.node, c.offset);
    r.collapse(true);
    const rect = r.getBoundingClientRect();
    if (rect.height > 0) return { x: rect.left, y: rect.top + rect.height * 0.73 };
    if (rect.width > 0 || rect.left !== 0 || rect.top !== 0) return { x: rect.left, y: rect.top };
  } catch { /* detached node — caller falls back to the band edges */ }
  return null;
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
 *  the mirror's transform. `picked` marks a fresh long-press/tap word pick
 *  (the rects play a short pop-in animation once). */
export function setSelectionFromCarets(anchor: CaretPoint, focus: CaretPoint, picked = false): TextSel | null {
  const mirror = mirrorEl;
  if (!mirror) return null;
  const range = rangeFromCarets(anchor, focus);
  if (!range) return null;

  const text = range.toString();
  if (!text.trim()) { clearTextSel(); return null }

  const { scale } = getVp();

  // TIGHT glyph-band rects first (the indicator + highlight hug the real
  // ink); falls back to the legacy full-em boxes when the spans carry no
  // PDF baseline metrics (old cached text layers)
  const tight = tightFragments(range, scale);
  let top = Infinity, bottom = -Infinity, cxSum = 0, nLines = 0;
  const byPage = new Map<string, PageRects>();

  if (tight) {
    for (const { pageId, rects } of tight) {
      const layout = layouts.find((l) => l.id === pageId);
      if (!layout) continue;
      let entry = byPage.get(pageId);
      if (!entry) { entry = { pageId, rects: [] }; byPage.set(pageId, entry) }
      for (const r of rects) {
        const wy = layout.y + r.y;
        top = Math.min(top, wy);
        bottom = Math.max(bottom, wy + r.h);
        cxSum += r.x + r.w / 2;
        nLines += 1;
        entry.rects.push(r);
      }
    }
  }
  if (nLines > 0) {
    const next0: TextSel = {
      top, bottom, cx: cxSum / nLines,
      byPage: [...byPage.values()],
      text, anchor, focus, picked,
      tight: true,
      startPt: null, endPt: null,
    };
    // drag-handle anchors stay where they were (caret-based — see below)
    const anchorFirst = compareCarets(anchor, focus) <= 0;
    const sC = anchorFirst ? anchor : focus;
    const eC = anchorFirst ? focus : anchor;
    const mirrorRect = mirror.getBoundingClientRect();
    const toWorld = (p: { x: number; y: number } | null) =>
      p ? { x: (p.x - mirrorRect.x) / scale, y: (p.y - mirrorRect.y) / scale } : null;
    next0.startPt = toWorld(caretClientPoint(sC));
    next0.endPt = toWorld(caretClientPoint(eC));
    if (!next0.startPt || !next0.endPt) {
      const f = next0.byPage[0]?.rects[0];
      const l = next0.byPage[next0.byPage.length - 1]?.rects.slice(-1)[0];
      const fl = layouts.find((x) => x.id === next0.byPage[0]?.pageId);
      const ll = layouts.find((x) => x.id === next0.byPage[next0.byPage.length - 1]?.pageId);
      if (f && fl) next0.startPt = next0.startPt ?? { x: f.x, y: fl.y + f.y + f.h * 0.73 };
      if (l && ll) next0.endPt = next0.endPt ?? { x: l.x + l.w, y: ll.y + l.y + l.h * 0.73 };
    }
    state = next0;
    notify();
    return next0;
  }

  // -------- legacy path (no PDF baseline metrics on the spans) --------
  const clientRects = Array.from(range.getClientRects(), (r) => ({ x: r.x, y: r.y, w: r.width, h: r.height }));
  if (!clientRects.length) { clearTextSel(); return null }

  const mirrorRect = mirror.getBoundingClientRect();
  top = Infinity; bottom = -Infinity; cxSum = 0;
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

  // drag-handle anchors: the world-space position of each boundary caret in
  // document order (the start handle sits on the first boundary)
  const anchorFirst = compareCarets(anchor, focus) <= 0;
  const sC = anchorFirst ? anchor : focus;
  const eC = anchorFirst ? focus : anchor;
  const toWorld = (p: { x: number; y: number } | null) =>
    p ? { x: (p.x - mirrorRect.x) / scale, y: (p.y - mirrorRect.y) / scale } : null;
  let startPt = toWorld(caretClientPoint(sC));
  let endPt = toWorld(caretClientPoint(eC));
  if ((!startPt || !endPt) && merged.length) {
    // unmeasurable carets → the outer band edges instead
    const f = merged[0], l = merged[merged.length - 1];
    startPt = startPt ?? { x: (f.x - mirrorRect.x) / scale, y: (f.y + f.h * 0.73 - mirrorRect.y) / scale };
    endPt = endPt ?? { x: (l.x + l.w - mirrorRect.x) / scale, y: (l.y + l.h * 0.73 - mirrorRect.y) / scale };
  }

  const next: TextSel = {
    top, bottom, cx: cxSum / merged.length,
    byPage: [...byPage.values()],
    text, anchor, focus, picked,
    startPt, endPt,
  };
  state = next;
  notify();
  return next;
}

// ---------------------------------------------------------------- drag-handle extension
// The floating selection grips extend the selection word-by-word: words are
// segmented from the mounted mirror spans (cached), matched to the pointer by
// distance (vertical slack, 3:1 y:x weighting) and the boundary lands on the
// word's OUTER edge, so the whole word always joins the selection.

interface SpanWord { node: Text; start: number; end: number }

const spanWordsCache = new WeakMap<HTMLElement, SpanWord[]>();

/** Words of one mirror span — segmented once per mounted span (span text is
 *  immutable while mounted; a reload mounts fresh elements). */
function spanWordsOf(span: HTMLElement): SpanWord[] {
  const hit = spanWordsCache.get(span);
  if (hit) return hit;
  const words: SpanWord[] = [];
  const node = span.firstChild;
  if (node && node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? '';
    if (segmenter) {
      for (const seg of segmenter.segment(text)) {
        if (/[\p{L}\p{M}\p{N}]/u.test(seg.segment)) {
          words.push({ node: node as Text, start: seg.index, end: seg.index + seg.segment.length });
        }
      }
    } else {
      for (const m of text.matchAll(/[\p{L}\p{M}\p{N}]+/gu)) {
        if (m.index !== undefined) words.push({ node: node as Text, start: m.index, end: m.index + m[0].length });
      }
    }
  }
  spanWordsCache.set(span, words);
  return words;
}

/** The mirror word nearest a client point — the drag-handle drop target. */
function nearestWordAtPoint(clientX: number, clientY: number): SpanWord | null {
  const mirror = mirrorEl;
  if (!mirror) return null;
  let best: SpanWord | null = null;
  let bestD = Infinity;
  for (const span of mirror.querySelectorAll<HTMLElement>('[data-pagetext] > span')) {
    const box = span.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    if (clientY < box.top - box.height || clientY > box.bottom + box.height) continue; // one line of slack
    for (const w of spanWordsOf(span)) {
      const r = document.createRange();
      r.setStart(w.node, w.start);
      r.setEnd(w.node, w.end);
      const rect = r.getBoundingClientRect();
      const dx = Math.max(0, Math.abs(clientX - (rect.left + rect.right) / 2) - rect.width / 2);
      const dy = Math.max(0, Math.abs(clientY - (rect.top + rect.bottom) / 2) - rect.height / 2);
      const d = dy * 3 + dx;
      if (d < bestD) { bestD = d; best = w }
    }
  }
  return best;
}

/** Move one boundary caret ('start' | 'end', document order) onto the word
 *  nearest the pointer and keep the other boundary anchored — the drag-handle
 *  gesture. The boundary takes the word's outer edge (away from the fixed
 *  caret), so the selection always covers whole words; the rects, toolbar and
 *  text update live on every move. Returns whether the selection changed. */
export function extendSelToWord(which: 'start' | 'end', clientX: number, clientY: number): boolean {
  const st = state;
  if (!st) return false;
  const anchorFirst = compareCarets(st.anchor, st.focus) <= 0;
  const startC = anchorFirst ? st.anchor : st.focus;
  const endC = anchorFirst ? st.focus : st.anchor;
  const fixed = which === 'start' ? endC : startC;
  const moving = which === 'start' ? startC : endC;
  const word = nearestWordAtPoint(clientX, clientY);
  if (!word) return false;
  const after = compareCarets({ node: word.node, offset: word.start }, fixed) >= 0;
  const next: CaretPoint = { node: word.node, offset: after ? word.end : word.start };
  if (next.node === moving.node && next.offset === moving.offset) return false; // already there
  setSelectionFromCarets(fixed, next, false);
  return true;
}
