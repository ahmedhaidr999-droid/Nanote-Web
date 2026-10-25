'use client';
// TextLayer — the selectable text overlay for imported PDFs.
//
// ARCHITECTURE (v2 — app-owned selection): a DOM mirror of the world viewport
// renders one transparent <span> per extracted PDF text item (pdf.js items
// mapped to ink-space by lib/nanote/pdftext), exactly on top of the rendered
// page background. The spans NEVER take pointer events and NEVER produce a
// native DOM selection — InkSurface feeds gesture carets into ./textsel
// (caretRangeFromPoint + word segmentation), which owns the selection state.
// We render the selection rects + a floating toolbar (Highlight / Underline /
// Translate / Copy) from that state. Because no native selection ever exists,
// the browser/WebView can never paint ITS selection handles or the Google
// "Copy / Search" bubble on top of ours.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Copy, Highlighter, Languages, Loader2, Underline, X } from 'lucide-react';
import { toast } from 'sonner';
import { useApp, useT } from '@/lib/nanote/store';
import { ShapeEl } from '@/lib/nanote/types';
import { uid } from '@/lib/nanote/util';
import { ensurePdfText } from '@/lib/nanote/pdftext';
import { translateOffline } from '@/lib/nanote/offlineTranslate';
import { googleTranslateUrl } from '@/lib/nanote/translate';
import { cn } from '@/lib/utils';
import {
  clearTextSel, setMirror, setSelLayouts, useTextSel, type SelRect,
} from './textsel';
import { getViewportSize, useVp, type PageLayout } from './viewport';

const MAX_SPANS_PER_PAGE = 1200; // pathological pages (pure glyph soup) render no layer

// ---------------------------------------------------------------- types
interface TranslateState { status: 'loading' | 'ok'; text: string; offline?: 'builtin' | 'pack' | 'pack-pivot' }

// ---------------------------------------------------------------- page subcomponent (memoized: vp changes never re-render spans)
const PageText = memo(function PageText({ pageId, layoutY, pageH, pageW, items }: {
  pageId: string; layoutY: number; pageH: number; pageW: number; items: import('@/lib/nanote/types').PdfTextItem[];
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
            // never selectable, never hit by pointer events — caret hit-testing
            // (caretRangeFromPoint) still finds these nodes, which is exactly
            // what the app-owned selection engine needs.
            userSelect: 'none', WebkitUserSelect: 'none', pointerEvents: 'none',
          }}
        >
          {it.str}
        </span>
      ))}
    </div>
  );
});

// ---------------------------------------------------------------- selection rect renderer (world-space → transforms with pan/zoom)
const SelRects = memo(function SelRects({ byPage, layouts }: {
  byPage: { pageId: string; rects: SelRect[] }[]; layouts: PageLayout[];
}) {
  return (
    <>
      {byPage.map(({ pageId, rects }) => {
        const layout = layouts.find((l) => l.id === pageId);
        if (!layout) return null;
        return rects.map((r, i) => (
          <div
            key={`${pageId}-${i}`}
            aria-hidden
            style={{
              position: 'absolute',
              left: r.x, top: layout.y + r.y, width: r.w, height: r.h,
              background: 'rgba(30,111,242,0.28)',
              borderRadius: 2,
              mixBlendMode: 'multiply',
              pointerEvents: 'none',
            }}
          />
        ));
      })}
    </>
  );
});

// ---------------------------------------------------------------- main
export function TextLayer({ layouts, pageW, notebookId }: {
  layouts: PageLayout[]; pageW: number; notebookId: string;
}) {
  const { t } = useT();
  const vp = useVp();
  const tool = useApp((s) => s.editor.tool);
  const translateEngine = useApp((s) => s.settings.translateEngine);
  const notebook = useApp((s) => s.notebooks.find((n) => n.id === notebookId));
  const pages = useApp((s) => s.editor.pages);
  const active = !!notebook?.pdfOriginalId; // the mirror is always live for PDF notebooks

  const outerRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const tbRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const vpRef = useRef(vp); vpRef.current = vp;

  const [items, setItems] = useState<Record<string, import('@/lib/nanote/types').PdfTextItem[] | null>>({});
  const loadingRef = useRef(new Set<string>());
  const [translate, setTranslate] = useState<TranslateState | null>(null);

  const translateRef = useRef(translate); translateRef.current = translate;
  const unavailableWarnedRef = useRef(false);
  const hintShownRef = useRef(false);
  const sel = useTextSel();

  const worldH = useMemo(() => layouts.reduce((acc, l) => Math.max(acc, l.y + l.h), 0), [layouts]);
  const pdfPages = useMemo(() => pages.filter((p) => p.backgroundImageId != null), [pages]);

  // register the mirror + layouts with the selection engine
  useEffect(() => {
    setMirror(mirrorRef.current);
    setSelLayouts(layouts);
    return () => { setMirror(null) };
  }, [active, layouts, notebook?.pdfOriginalId]);
  useEffect(() => { setSelLayouts(layouts) }, [layouts]);

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

  // -------------------------------------------------- lazy text extraction for visible pages (always on for PDFs)
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
    if (tool !== 'textselect' || !notebook?.pdfOriginalId) return;
    if (hintShownRef.current) return;
    hintShownRef.current = true;
    toast.info(t('pdftext.selectHint'));
  }, [tool, notebook, t]);

  // -------------------------------------------------- bookkeeping
  const closeTranslate = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setTranslate(null);
  }, []);

  const clearSelectionUi = useCallback(() => {
    clearTextSel();
    closeTranslate();
  }, [closeTranslate]);

  // a fresh selection (different text) supersedes an open translation card
  const lastSelTextRef = useRef<string | null>(null);
  useEffect(() => {
    if (!sel) { lastSelTextRef.current = null; return }
    if (lastSelTextRef.current !== null && sel.text !== lastSelTextRef.current) closeTranslate();
    lastSelTextRef.current = sel.text;
  }, [sel, closeTranslate]);

  // Escape dismisses the selection; editor close (unmount) clears everything
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clearSelectionUi();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      abortRef.current?.abort();
      abortRef.current = null;
      clearTextSel();
    };
  }, [clearSelectionUi]);

  // leaving a PDF notebook clears the selection
  useEffect(() => {
    if (!active) clearSelectionUi();
  }, [active, clearSelectionUi]);

  // -------------------------------------------------- "no selectable text" notice (once per session, explicit tool only)
  useEffect(() => {
    if (tool !== 'textselect' || !notebook) return;
    const parent = outerRef.current?.parentElement;
    if (!parent) return;
    const pagesRef = useApp.getState().editor.pages;
    const onDown = (e: PointerEvent) => {
      if (unavailableWarnedRef.current) return;
      const target = e.target as Node | null;
      if (target && (tbRef.current?.contains(target) || popRef.current?.contains(target))) return;
      const outer = outerRef.current;
      if (!outer) return;
      const rect = outer.getBoundingClientRect();
      const st = useApp.getState();
      const { scale, tx, ty } = vpRef.current;
      const wy = (e.clientY - rect.top - ty) / scale;
      const layout = layouts.find((l) => l.y <= wy && l.y + l.h >= wy);
      if (!layout) return;
      const page = pagesRef.find((p) => p.id === layout.id);
      if (!page?.backgroundImageId) return; // plain ink pages: nothing to select
      const its = items[page.id];
      const empty = its !== undefined && (its === null || its.length === 0);
      if (notebook.pdfOriginalId == null || empty) {
        unavailableWarnedRef.current = true;
        toast.info(t('pdftext.unavailable'));
      }
    };
    parent.addEventListener('pointerdown', onDown, true);
    return () => parent.removeEventListener('pointerdown', onDown, true);
  }, [tool, notebook, t, items, layouts]);

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
    clearSelectionUi();
  }, [sel, clearSelectionUi]);

  const doTranslate = useCallback(() => {
    if (!sel) return;
    const st = useApp.getState();
    const target = st.settings.translateTarget === 'auto'
      ? (st.settings.lang === 'ar' ? 'ar' : 'en')
      : st.settings.translateTarget;

    // ---- Google engine: pop up the Google Translate window with the text
    if (st.settings.translateEngine === 'google') {
      const url = googleTranslateUrl(sel.text, target);
      const win = window.open(url, '_blank', 'noopener,noreferrer');
      if (!win) toast.error(t('pdftext.translate.popupBlocked'));
      return;
    }

    // ---- Nanote engine: online LLM first, offline pack fallback second
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setTranslate({ status: 'loading', text: '' });
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
      .catch(async (e) => {
        clearTimeout(timer);
        if (abortRef.current !== ac) return; // user cancelled / new request
        console.warn('[nanote] translate api failed — offline pack fallback', e);
        // downloaded language packs (Settings → Languages) + built-in AR↔EN
        const off = await translateOffline(sel.text, target);
        if (off) {
          setTranslate({ status: 'ok', text: off.translation, offline: off.via === 'builtin' ? 'builtin' : off.via });
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
    let top = sel.top * vp.scale + vp.ty - h - 8;       // above the selection
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
    let top = tb.offsetTop - ph - 8;                        // above the toolbar
    if (top < 8) top = tb.offsetTop + tb.offsetHeight + 8;  // → below it
    top = Math.max(8, Math.min(oh - ph - 8, top));
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
  }, [translate, sel, vp]);

  // -------------------------------------------------- render
  return (
    <div ref={outerRef} className="absolute inset-0 z-[15]" style={{ pointerEvents: 'none' }}>
      {active && (
        <div
          ref={mirrorRef}
          aria-hidden
          className="nanote-textlayer"
          style={{
            position: 'absolute', left: 0, top: 0,
            width: pageW, height: worldH,
            transform: `translate(${vp.tx}px, ${vp.ty}px) scale(${vp.scale})`,
            transformOrigin: '0 0',
            pointerEvents: 'none', // the whole mirror is transparent to input
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
          {sel && <SelRects byPage={sel.byPage} layouts={layouts} />}
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
            label={translateEngine === 'google' ? t('pdftext.translate.google') : t('pdftext.translate')}
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
                {translate.offline === 'builtin'
                  ? t('pdftext.translate.offline')
                  : t('pdftext.translate.offlinePack', 'Offline pack', 'حزمة بدون اتصال')}
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
                style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
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
