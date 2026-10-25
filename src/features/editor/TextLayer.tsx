'use client';
// TextLayer — the selectable text overlay for imported PDFs.
//
// When the "Select text" tool is active, a DOM mirror of the world viewport
// renders one transparent <span> per extracted PDF text item (pdf.js items
// mapped to ink-space by lib/nanote/pdftext), exactly on top of the rendered
// page background. The native browser selection then works on real text;
// a floating toolbar offers Highlight / Underline / Translate / Copy on the
// current selection, converting its client rects into page-space ink
// elements (one undoable action per page).
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Copy, Highlighter, Languages, Loader2, Underline, X } from 'lucide-react';
import { toast } from 'sonner';
import { useApp, useT } from '@/lib/nanote/store';
import { PdfTextItem, ShapeEl } from '@/lib/nanote/types';
import { uid } from '@/lib/nanote/util';
import { ensurePdfText } from '@/lib/nanote/pdftext';
import { offlineTranslate } from '@/lib/nanote/offlineTranslate';
import { cn } from '@/lib/utils';
import { getVp, getViewportSize, pageAtWorldY, useVp, type PageLayout } from './viewport';

const MAX_SPANS_PER_PAGE = 1200; // pathological pages (pure glyph soup) render no layer

// ---------------------------------------------------------------- types
interface SelRect { x: number; y: number; w: number; h: number } // page-space ink coords
interface PageRects { pageId: string; rects: SelRect[] }
interface SelState {
  top: number;     // world-space top edge of the selection (toolbar anchor)
  bottom: number;  // world-space bottom edge
  cx: number;      // world-space horizontal center
  byPage: PageRects[];
  text: string;
}
interface TranslateState { status: 'loading' | 'ok'; text: string; offline?: boolean }

// ---------------------------------------------------------------- rect merging
/** Merge the selection's client rects into one band per text line
 * (Chrome emits one rect per span; same-line rects get unioned). */
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

// ---------------------------------------------------------------- page subcomponent (memoized: vp changes never re-render spans)
const PageText = memo(function PageText({ pageId, layoutY, pageH, pageW, items }: {
  pageId: string; layoutY: number; pageH: number; pageW: number; items: PdfTextItem[];
}) {
  return (
    <div data-pagetext={pageId} style={{ position: 'absolute', left: 0, top: layoutY, width: pageW, height: pageH, pointerEvents: 'none' }}>
      {items.map((it, i) => (
        <span
          key={i}
          dir="ltr"
          style={{
            position: 'absolute',
            left: it.x, top: it.y, width: it.w, height: it.h,
            fontSize: `${it.h}px`, lineHeight: `${it.h}px`,
            whiteSpace: 'pre', color: 'transparent',
            userSelect: 'text', pointerEvents: 'auto', cursor: 'text',
          }}
        >
          {it.str}
        </span>
      ))}
    </div>
  );
});

// ---------------------------------------------------------------- main
export function TextLayer({ layouts, pageW, notebookId }: {
  layouts: PageLayout[]; pageW: number; notebookId: string;
}) {
  const { t } = useT();
  const vp = useVp();
  const tool = useApp((s) => s.editor.tool);
  const notebook = useApp((s) => s.notebooks.find((n) => n.id === notebookId));
  const pages = useApp((s) => s.editor.pages);
  const active = tool === 'textselect';

  const outerRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const tbRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [items, setItems] = useState<Record<string, PdfTextItem[] | null>>({});
  const loadingRef = useRef(new Set<string>());
  const [sel, setSel] = useState<SelState | null>(null);
  const [translate, setTranslate] = useState<TranslateState | null>(null);

  const layoutsRef = useRef(layouts); layoutsRef.current = layouts;
  const pagesRef = useRef(pages); pagesRef.current = pages;
  const itemsRef = useRef(items); itemsRef.current = items;
  const translateRef = useRef(translate); translateRef.current = translate;
  const lastTextRef = useRef<string | null>(null);
  const unavailableWarnedRef = useRef(false);
  const hintShownRef = useRef(false);

  const worldH = useMemo(() => layouts.reduce((acc, l) => Math.max(acc, l.y + l.h), 0), [layouts]);
  const pdfPages = useMemo(() => pages.filter((p) => p.backgroundImageId != null), [pages]);

  // visible PDF pages (one page of margin each side, like the editor culling)
  const visiblePdfIds = useMemo(() => {
    const set = new Set<string>();
    if (!active) return set;
    const vh = getViewportSize().h;
    const top = -vp.ty / vp.scale;
    const bottom = (vh - vp.ty) / vp.scale;
    for (const l of layouts) {
      if (l.y + l.h >= top - l.h && l.y <= bottom + l.h) set.add(l.id);
    }
    return set;
  }, [active, layouts, vp.ty, vp.scale]);

  // -------------------------------------------------- lazy text extraction for visible pages
  useEffect(() => {
    if (!active || !notebook) return;
    const nb = notebook;
    for (const p of pdfPages) {
      if (!visiblePdfIds.has(p.id)) continue;
      if (p.id in items || loadingRef.current.has(p.id)) continue;
      loadingRef.current.add(p.id);
      void ensurePdfText(p, nb)
        .then((its) => setItems((m) => ({ ...m, [p.id]: its ?? null })))
        .catch(() => setItems((m) => ({ ...m, [p.id]: null })))
        .finally(() => { loadingRef.current.delete(p.id) });
    }
  }, [active, notebook, pdfPages, visiblePdfIds, items]);

  // -------------------------------------------------- one-time hint when the tool activates on a PDF
  useEffect(() => {
    if (!active || !notebook?.pdfOriginalId) return;
    if (hintShownRef.current) return;
    hintShownRef.current = true;
    toast.info(t('pdftext.selectHint'));
  }, [active, notebook, t]);

  // -------------------------------------------------- selection bookkeeping
  const closeTranslate = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setTranslate(null);
  }, []);

  const clearSelectionUi = useCallback(() => {
    lastTextRef.current = null;
    setSel(null);
    closeTranslate();
  }, [closeTranslate]);

  const evaluate = useCallback(() => {
    const mirror = mirrorRef.current;
    const pop = popRef.current;
    const selection = window.getSelection();
    if (!mirror || !selection || selection.rangeCount === 0) return;
    // the user is (de)selecting text INSIDE the translation card — never dismiss it
    if (pop && selection.anchorNode && pop.contains(selection.anchorNode)) return;

    const ours = !selection.isCollapsed
      && !!selection.anchorNode && mirror.contains(selection.anchorNode)
      && !!selection.focusNode && mirror.contains(selection.focusNode);
    if (!ours) { clearSelectionUi(); return }

    const text = selection.toString();
    if (!text.trim()) { clearSelectionUi(); return }

    const range = selection.getRangeAt(0);
    const merged = mergeLineRects(Array.from(range.getClientRects(), (r) => ({ x: r.x, y: r.y, w: r.width, h: r.height })));
    if (!merged.length) { clearSelectionUi(); return }

    // the mirror carries the same transform as the world container, so
    // (client - mirrorRect) / scale lands directly in world coordinates
    const mirrorRect = mirror.getBoundingClientRect();
    const { scale } = getVp();
    const ls = layoutsRef.current;
    let top = Infinity, bottom = -Infinity, cxSum = 0, any = false;
    const byPage = new Map<string, PageRects>();
    for (const r of merged) {
      const wx = (r.x - mirrorRect.x) / scale;
      const wy = (r.y - mirrorRect.y) / scale;
      const ww = r.w / scale, wh = r.h / scale;
      top = Math.min(top, wy);
      bottom = Math.max(bottom, wy + wh);
      cxSum += wx + ww / 2;
      const layout = pageAtWorldY(ls, wy + wh / 2);
      if (!layout) continue; // gap between pages
      any = true;
      let entry = byPage.get(layout.id);
      if (!entry) { entry = { pageId: layout.id, rects: [] }; byPage.set(layout.id, entry) }
      entry.rects.push({ x: wx, y: wy - layout.y, w: ww, h: wh });
    }
    if (!any) { clearSelectionUi(); return }

    // a fresh selection supersedes an open translation card
    if (translateRef.current && lastTextRef.current !== text) closeTranslate();
    lastTextRef.current = text;

    const next: SelState = { top, bottom, cx: cxSum / merged.length, byPage: [...byPage.values()], text };
    setSel((prev) => (prev && prev.text === next.text && prev.top === next.top && prev.bottom === next.bottom && prev.cx === next.cx ? prev : next));
  }, [clearSelectionUi, closeTranslate]);

  useEffect(() => {
    if (!active) return;
    const onSel = () => evaluate();
    const onUp = () => evaluate();
    document.addEventListener('selectionchange', onSel);
    document.addEventListener('pointerup', onUp);
    return () => {
      document.removeEventListener('selectionchange', onSel);
      document.removeEventListener('pointerup', onUp);
    };
  }, [active, evaluate]);

  // leaving the tool dismisses everything
  useEffect(() => {
    if (!active) clearSelectionUi();
  }, [active, clearSelectionUi]);

  // abort any in-flight translation when the editor closes
  useEffect(() => () => { abortRef.current?.abort(); abortRef.current = null }, []);

  // -------------------------------------------------- "no selectable text" notice (once per session)
  // Fires on capture-phase pointerdowns that land on a rendered PDF page
  // whose text layer can never yield text (no stored original / empty page).
  useEffect(() => {
    if (!active || !notebook) return;
    const parent = outerRef.current?.parentElement;
    if (!parent) return;
    const onDown = (e: PointerEvent) => {
      if (unavailableWarnedRef.current) return;
      const target = e.target as Node | null;
      if (target && (tbRef.current?.contains(target) || popRef.current?.contains(target))) return;
      const outer = outerRef.current;
      if (!outer) return;
      const rect = outer.getBoundingClientRect();
      const { scale, tx, ty } = getVp();
      const wy = (e.clientY - rect.top - ty) / scale;
      const layout = pageAtWorldY(layoutsRef.current, wy);
      if (!layout) return;
      const page = pagesRef.current.find((p) => p.id === layout.id);
      if (!page?.backgroundImageId) return; // plain ink pages: nothing to select
      const its = itemsRef.current[page.id];
      const empty = its !== undefined && (its === null || its.length === 0);
      if (notebook.pdfOriginalId == null || empty) {
        unavailableWarnedRef.current = true;
        toast.info(t('pdftext.unavailable'));
      }
    };
    parent.addEventListener('pointerdown', onDown, true);
    return () => parent.removeEventListener('pointerdown', onDown, true);
  }, [active, notebook, t]);

  // -------------------------------------------------- actions
  const doShapeAction = useCallback((kind: 'highlight' | 'underline') => {
    if (!sel) return;
    const st = useApp.getState();
    void (async () => {
      for (const { pageId, rects } of sel.byPage) {
        const doc = await st.ensureDoc(pageId);
        let z = doc.elements.reduce((acc, el) => Math.max(acc, el.z), 0) + 1;
        const els: ShapeEl[] = rects.map((r) => {
          const el: ShapeEl = kind === 'highlight'
            ? {
                kind: 'shape', id: uid(), shape: 'rect',
                x: r.x, y: r.y - 1, w: r.w, h: r.h + 2,
                stroke: '#FFD84D', strokeWidth: 0.001, fill: '#FFD84D59', z,
              }
            : {
                kind: 'shape', id: uid(), shape: 'line',
                // the pdf.js text box spans ascent→baseline, so a clean
                // underline sits just BELOW the box (over the descender zone)
                x: r.x, y: r.y + r.h + Math.max(2, r.h * 0.1), w: r.w, h: 0,
                stroke: '#E5484D', strokeWidth: 2.5, fill: null, z,
              };
          z += 1;
          return el;
        });
        useApp.getState().addElements(pageId, els); // ONE undoable action per page
      }
    })();
    window.getSelection()?.removeAllRanges();
    clearSelectionUi();
  }, [sel, clearSelectionUi]);

  const doTranslate = useCallback(() => {
    if (!sel) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setTranslate({ status: 'loading', text: '' });
    const target = useApp.getState().settings.lang === 'ar' ? 'ar' : 'en';
    // hard timeout — a hung request (e.g. captive network) must not freeze the card
    const timer = setTimeout(() => {
      if (abortRef.current === ac) ac.abort();
    }, 8000);
    void fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: sel.text, target }),
      signal: ac.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`translate http ${r.status}`);
        const j = (await r.json()) as { translation?: string };
        if (!j.translation) throw new Error('empty translation');
        if (abortRef.current !== ac) return; // superseded
        clearTimeout(timer);
        setTranslate({ status: 'ok', text: j.translation });
      })
      .catch((e) => {
        clearTimeout(timer);
        if (abortRef.current !== ac) return; // user cancelled / new request
        console.warn('[nanote] translate api failed — offline fallback', e);
        // offline engine — the APK has no server at all (static export), and the
        // browser may be offline; rough dictionary translation beats an error.
        const off = offlineTranslate(sel.text, target);
        if (off) {
          setTranslate({ status: 'ok', text: off.translation, offline: true });
        } else {
          setTranslate(null);
          toast.error(t('pdftext.translate.error'));
        }
      });
  }, [sel, t]);

  const doCopy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('pdftext.copied', 'Copied', 'تم النسخ'));
    } catch {
      // legacy fallback for non-secure contexts
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        if (!ok) throw new Error('copy failed');
        toast.success(t('pdftext.copied', 'Copied', 'تم النسخ'));
      } catch {
        toast.error(t('error.generic'));
      }
    }
  }, [t]);

  // -------------------------------------------------- toolbar / popover positioning (imperative: follows pan & zoom)
  useLayoutEffect(() => {
    const tb = tbRef.current;
    const outer = outerRef.current;
    if (!sel || !tb || !outer) return;
    const ow = outer.clientWidth, oh = outer.clientHeight;
    const w = tb.offsetWidth, h = tb.offsetHeight;
    const cxScreen = sel.cx * vp.scale + vp.tx;
    let left = Math.max(8, Math.min(ow - w - 8, cxScreen - w / 2));
    let top = sel.top * vp.scale + vp.ty - h - 8;      // above the selection
    if (top < 8) top = sel.bottom * vp.scale + vp.ty + 8; // not enough room → below
    top = Math.max(8, Math.min(oh - h - 8, top));
    tb.style.left = `${Math.round(left)}px`;
    tb.style.top = `${Math.round(top)}px`;
  }, [sel, vp]);

  useLayoutEffect(() => {
    const tb = tbRef.current;
    const pop = popRef.current;
    const outer = outerRef.current;
    if (!translate || !sel || !tb || !pop || !outer) return;
    const ow = outer.clientWidth, oh = outer.clientHeight;
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let left = tb.offsetLeft + tb.offsetWidth / 2 - pw / 2;
    left = Math.max(8, Math.min(ow - pw - 8, left));
    let top = tb.offsetTop - ph - 8;                       // above the toolbar
    if (top < 8) top = tb.offsetTop + tb.offsetHeight + 8; // → below it
    top = Math.max(8, Math.min(oh - ph - 8, top));
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
  }, [translate, sel, vp]);

  // -------------------------------------------------- render
  return (
    <div ref={outerRef} className="absolute inset-0 z-[15]" style={{ pointerEvents: 'none' }}>
      <style>{`.nanote-textlayer span::selection { background: rgba(30,111,242,0.30); }`}</style>

      {active && notebook?.pdfOriginalId && (
        <div
          ref={mirrorRef}
          aria-hidden
          className="nanote-textlayer"
          style={{
            position: 'absolute', left: 0, top: 0,
            width: pageW, height: worldH,
            transform: `translate(${vp.tx}px, ${vp.ty}px) scale(${vp.scale})`,
            transformOrigin: '0 0',
            pointerEvents: 'none', // only the spans themselves receive events
          }}
        >
          {pdfPages.map((p) => {
            if (!visiblePdfIds.has(p.id)) return null;
            const its = items[p.id];
            if (!its || its.length === 0 || its.length > MAX_SPANS_PER_PAGE) return null;
            const layout = layouts.find((l) => l.id === p.id);
            if (!layout) return null;
            return (
              <PageText key={p.id} pageId={p.id} layoutY={layout.y} pageH={p.height} pageW={pageW} items={its} />
            );
          })}
        </div>
      )}

      {sel && (
        <div
          ref={tbRef}
          role="toolbar"
          aria-label={t('tool.textselect')}
          className="absolute flex items-center gap-0.5 rounded-full border border-border bg-card/95 p-1 shadow-ink-2 backdrop-blur"
          style={{ pointerEvents: 'auto', left: 0, top: 0 }}
        >
          <ToolBtn
            icon={<Highlighter className="h-4 w-4 text-warning" />}
            label={t('pdftext.highlight')}
            onClick={() => doShapeAction('highlight')}
          />
          <ToolBtn
            icon={<Underline className="h-4 w-4 text-destructive" />}
            label={t('pdftext.underline')}
            onClick={() => doShapeAction('underline')}
          />
          <ToolBtn
            icon={<Languages className="h-4 w-4" />}
            label={t('pdftext.translate')}
            active={!!translate}
            onClick={doTranslate}
          />
          <ToolBtn
            icon={<Copy className="h-4 w-4" />}
            label={t('pdftext.copy')}
            onClick={() => void doCopy(sel.text)}
          />
        </div>
      )}

      {sel && translate && (
        <div
          ref={popRef}
          dir="ltr"
          className="absolute max-w-xs rounded-2xl border border-border bg-card p-3 shadow-ink-2"
          style={{ pointerEvents: 'auto', left: 0, top: 0 }}
          role="dialog"
          aria-label={t('pdftext.translated')}
        >
          <div className="mb-2 flex items-center gap-2">
            <Languages className="h-4 w-4 text-primary" />
            <span className="text-xs font-semibold text-muted-foreground">{t('pdftext.translated')}</span>
            {translate.offline && (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {t('pdftext.translate.offline')}
              </span>
            )}
            <button
              type="button"
              aria-label={t('common.close', 'Close', 'إغلاق')}
              onMouseDown={(e) => e.preventDefault()}
              onClick={closeTranslate}
              className="ms-auto flex h-6 w-6 items-center justify-center rounded-full hover:bg-accent"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {translate.status === 'loading' ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('pdftext.translating')}
            </div>
          ) : (
            <>
              <p
                dir="auto"
                className="nanote-scroll max-h-48 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed"
                style={{ userSelect: 'text' }}
              >
                {translate.text}
              </p>
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void doCopy(translate.text)}
                  className="flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium hover:bg-accent press-scale"
                >
                  <Copy className="h-3.5 w-3.5" />
                  {t('pdftext.copy')}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- toolbar button
function ToolBtn({ icon, label, onClick, active }: {
  icon: React.ReactNode; label: string; onClick: () => void; active?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      // never let the click steal focus/collapse the DOM text selection
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        'flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium press-scale',
        active ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
      )}
    >
      {icon}
      <span className="hidden min-[540px]:inline">{label}</span>
    </button>
  );
}
