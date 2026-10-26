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
// Translate / Web search / Copy) from that state, with 44px drag handles on
// both ends that extend the selection word-by-word; any press that reaches the
// input surface dismisses it. Because no native selection ever exists,
// the browser/WebView can never paint ITS selection handles or the Google
// "Copy / Search" bubble on top of ours.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Copy, Feather, Highlighter, Languages, MessagesSquare, Search, Sparkles, Underline } from 'lucide-react';
import { toast } from 'sonner';
import { useApp, useT } from '@/lib/nanote/store';
import { ShapeEl } from '@/lib/nanote/types';
import { uid } from '@/lib/nanote/util';
import { ensurePdfText } from '@/lib/nanote/pdftext';
import { resolveTranslateTarget } from '@/lib/nanote/translate';
import { askAI, aiName, type AiService } from '@/lib/nanote/askai';
import { cn } from '@/lib/utils';
import {
  clearTextSel, extendSelToWord, getTextSel, setMirror, setSelLayouts, useTextSel, type SelRect,
} from './textsel';
import { getViewportSize, useVp, type PageLayout } from './viewport';
import { TranslatePopup } from './TranslatePopup';

const MAX_SPANS_PER_PAGE = 1200; // pathological pages (pure glyph soup) render no layer

// ---------------------------------------------------------------- types
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
          data-b={it.b != null ? it.b : undefined}
          data-f={it.h}
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
const SelRects = memo(function SelRects({ byPage, layouts, picked }: {
  byPage: { pageId: string; rects: SelRect[] }[]; layouts: PageLayout[]; picked?: boolean;
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
            className={picked ? 'animate-wordpop' : undefined}
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
  const hStartRef = useRef<HTMLDivElement>(null);
  const hEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const vpRef = useRef(vp); vpRef.current = vp;

  const [items, setItems] = useState<Record<string, import('@/lib/nanote/types').PdfTextItem[] | null>>({});
  const loadingRef = useRef(new Set<string>());
  const [popup, setPopup] = useState<{ text: string; target: string } | null>(null);
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
    setPopup(null);
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

  // -------------------------------------------------- tap on the page dismisses the selection
  // Any fresh press that reaches the input surface (the empty page, any text —
  // even the selected one) clears the selection at once, like a tap on the
  // glass of a native reader. Presses on our own UI (toolbar, translate card,
  // drag handles) or on floating overlays never reach the surface, so they
  // keep it. Capture phase ⇒ the clear lands before the long-press flow picks
  // its fresh word, so "second long-press re-selects" still works.
  useEffect(() => {
    if (!active) return;
    const outer = outerRef.current;
    const host = outer?.previousElementSibling ?? null; // InkSurface's input host
    if (!outer || !(host instanceof HTMLElement) || host.getAttribute('role') !== 'application') {
      console.warn('[nanote] text selection: input surface not found — tap-to-dismiss is off');
      return;
    }
    const onDown = (e: PointerEvent) => {
      if (!getTextSel()) return;
      const target = e.target as Node | null;
      if (!target || outer.contains(target) || !host.contains(target)) return;
      clearSelectionUi();
    };
    const parent = outer.parentElement;
    if (!parent) return;
    parent.addEventListener('pointerdown', onDown, true);
    return () => parent.removeEventListener('pointerdown', onDown, true);
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
      if (target && tbRef.current?.contains(target)) return;
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
                // TIGHT rects already hug the visible glyph ink (character-aware
                // band) — ±1 hair only, never the old full-em box that crossed
                // into the lines above/below. Legacy fallback rects keep the
                // small breathing margin.
                kind: 'shape', id: uid(), shape: 'rect',
                x: r.x, y: r.y - 1, w: r.w, h: r.h + 2,
                stroke: '#FFD84D', strokeWidth: 0.001, fill: '#FFD84D59', z,
              }
            : {
                kind: 'shape', id: uid(), shape: 'line',
                // underline position: with the TIGHT band the rect bottom sits
                // just under the baseline (or under the descenders) — one unit
                // down is the typographic underline spot; the legacy path keeps
                // the old below-the-box offset (its box bottom = baseline).
                x: r.x,
                y: sel.tight ? r.y + r.h + 1 : r.y + r.h + Math.max(2, r.h * 0.1),
                w: r.w, h: 0,
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
    // BOTH engines translate inside the app now: the popup fetches Google's
    // own web endpoints (or Nanote's online chain) and renders the result in
    // our own window — the user is never redirected to translate.google.com.
    const st = useApp.getState();
    setPopup({ text: sel.text, target: resolveTranslateTarget(st.settings) });
  }, [sel]);

  // Ask the configured AI (ChatGPT / Gemini / Claude) with the selected text
  const doAskAI = useCallback(() => {
    if (!sel) return;
    const svc: AiService = useApp.getState().settings.aiService ?? 'chatgpt';
    const name = aiName(svc);
    clearTextSel();
    void askAI(svc, sel.text).then(() => {
      toast.success(t('pdftext.askAi.opened', 'Opened {name} — the text is copied', 'تم فتح {name} — تم نسخ النص').replace('{name}', name));
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

  // -------------------------------------------------- drag handles (extend the selection word-by-word)
  const startHandleDrag = useCallback((e: React.PointerEvent, which: 'start' | 'end') => {
    e.stopPropagation();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* pointer already gone */ }
    const onMove = (ev: PointerEvent) => { extendSelToWord(which, ev.clientX, ev.clientY) };
    const stop = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  }, []);

  // -------------------------------------------------- web search
  const doWebSearch = useCallback(() => {
    if (!sel) return;
    openWebSearch(sel.text);
    clearSelectionUi();
  }, [sel, clearSelectionUi]);

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



  // drag handles follow the boundary carets through pan & zoom (44px grips
  // centered on the anchor point, regardless of the current zoom level)
  useLayoutEffect(() => {
    const place = (el: HTMLDivElement | null, pt: { x: number; y: number } | null) => {
      if (!el || !pt) return;
      el.style.left = `${Math.round(pt.x * vp.scale + vp.tx - 22)}px`;
      el.style.top = `${Math.round(pt.y * vp.scale + vp.ty - 22)}px`;
    };
    place(hStartRef.current, sel?.startPt ?? null);
    place(hEndRef.current, sel?.endPt ?? null);
  }, [sel, vp]);

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
          {sel && <SelRects byPage={sel.byPage} layouts={layouts} picked={sel.picked} />}
        </div>
      )}

      {sel && (
        <>
          <SelHandle
            btnRef={hStartRef}
            label={t('pdftext.handleStart', 'Selection start', 'بداية التحديد')}
            onPointerDown={(e) => startHandleDrag(e, 'start')}
          />
          <SelHandle
            btnRef={hEndRef}
            label={t('pdftext.handleEnd', 'Selection end', 'نهاية التحديد')}
            onPointerDown={(e) => startHandleDrag(e, 'end')}
          />
        </>
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
            active={!!popup}
            onClick={doTranslate}
          />
          <ToolBtn
            icon={
              (useApp.getState().settings.aiService ?? 'chatgpt') === 'gemini'
                ? <Sparkles className="h-4 w-4" />
                : (useApp.getState().settings.aiService ?? 'chatgpt') === 'claude'
                  ? <Feather className="h-4 w-4" />
                  : <MessagesSquare className="h-4 w-4" />
            }
            label={t('pdftext.askAi', 'Ask {name}', 'اسأل {name}').replace('{name}', aiName(useApp.getState().settings.aiService ?? 'chatgpt'))}
            onClick={doAskAI}
          />
          <ToolBtn
            icon={<Search className="h-4 w-4" />}
            label={t('pdftext.searchWeb', 'Web search', 'البحث في الويب')}
            onClick={doWebSearch}
          />
          <ToolBtn
            icon={<Copy className="h-4 w-4" />}
            label={t('pdftext.copy')}
            onClick={() => void doCopy(sel.text)}
          />
        </div>
      )}

      {popup && (
        <TranslatePopup text={popup.text} initialTarget={popup.target} onClose={closeTranslate} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- web search
/** Google search results for the selected text — a named popup window (never
 *  a full tab); falls back to a plain new tab when popups are constrained. */
function openWebSearch(text: string) {
  const url = `https://www.google.com/search?q=${encodeURIComponent(text)}`;
  try {
    window.open(url, 'nanote-web-search', 'popup,width=560,height=700');
  } catch {
    window.open(url, '_blank');
  }
}

// ---------------------------------------------------------------- selection drag handle
/** 44px touch-friendly grip on one end of the selection (the dot is 16px —
 *  the hit area is the full grip, so fingers never miss it). */
function SelHandle({ btnRef, label, onPointerDown }: {
  btnRef: React.RefObject<HTMLDivElement | null>; label: string; onPointerDown: (e: React.PointerEvent) => void;
}) {
  return (
    <div
      ref={btnRef}
      role="button"
      tabIndex={0}
      aria-label={label}
      onPointerDown={onPointerDown}
      className="absolute flex h-11 w-11 cursor-grab items-center justify-center"
      style={{ left: 0, top: 0, pointerEvents: 'auto', touchAction: 'none' }}
    >
      <div className="h-4 w-4 rounded-full border-[2.5px] border-white bg-primary shadow-ink-1" />
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
