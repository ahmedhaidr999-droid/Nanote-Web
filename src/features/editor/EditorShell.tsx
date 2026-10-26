'use client';
// EditorShell — composes the ink editor: world viewport with continuous
// multi-page scroll, top bar (undo/redo, bookmarks, outline, export), filmstrip,
// tool rail, zoom bar, audio panel, ruler and text editing overlay.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Undo2, Redo2, MoreVertical, Bookmark, BookmarkCheck, ListTree, FileImage,
  FileText, NotebookPen, Share2, Eraser, Plus, LayoutGrid, ZoomIn, ZoomOut, Maximize2, Check,
  SlidersHorizontal, Map as MapIcon, Palette,
} from 'lucide-react';
import { toast } from 'sonner';
import { useApp, useT } from '@/lib/nanote/store';
import { PAGE_SIZES, PAPER_COLORS, PageRow, TemplateId } from '@/lib/nanote/types';
import { uid } from '@/lib/nanote/util';
import { elementBBox } from '@/lib/nanote/geometry';
import * as db from '@/lib/nanote/idb';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import PageCanvas from './PageCanvas';
import InkSurface from './InkSurface';
import LiveOverlay from './LiveOverlay';
import { TextLayer } from './TextLayer';
import { ensureThumb, refreshThumb } from './thumbs';
import { SelectionLayer } from './SelectionLayer';
import { TextEditorOverlay, TextSession } from './TextEditorOverlay';
import { ToolRail } from './ToolRail';
import { InfinityMinimap } from './InfinityMinimap';
import { PagesDialog } from './PagesDialog';
import { InputSettingsSheet } from './InputSettingsSheet';
import { Ruler } from './Ruler';
import { recallPage } from '@/lib/nanote/pagemem';
import {
  fitWidth, getVp, layoutPages, pageAtWorldY, scrollToPage, subscribeVp, useVp, type Vp,
  animateZoomTo, animatedFit, clampVpToWorld, setViewportSize, setVp, type PageLayout,
  setZoomRangeFor, worldBoundsOf, fitToBounds, onVpIdle,
} from './viewport';

const CULL_MARGIN = 1;

export default function EditorShell({ notebookId }: { notebookId: string }) {
  const { t } = useT();
  const notebook = useApp((s) => s.notebooks.find((n) => n.id === notebookId));
  const pages = useApp((s) => s.editor.pages);
  const activePageId = useApp((s) => s.editor.activePageId);
  const undoDepth = useApp((s) => s.editor.undoStack.length);
  const redoDepth = useApp((s) => s.editor.redoStack.length);
  const quarantine = useApp((s) => s.editor.quarantine);
  const leftHanded = useApp((s) => s.settings.leftHanded);

  const containerRef = useRef<HTMLDivElement>(null);
  const lastFitWRef = useRef(0);   // container width the current fit was computed for
  const [textSession, setTextSession] = useState<TextSession | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [pagesOpen, setPagesOpen] = useState(false);
  const [inputOpen, setInputOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [thumbVersion, setThumbVersion] = useState(0);
  const dirtyThumbsRef = useRef(new Set<string>());
  const restoredRef = useRef(false); // last-page restore runs once per editor session
  const initedForRef = useRef<string | null>(null); // vp init runs once per notebook

  const pageW = PAGE_SIZES[notebook?.pageSize ?? 'a4p'].w;
  const infinite = notebook?.pageSize === 'infinite';
  const hasNotebook = notebook !== undefined;
  const { layouts, worldH } = useMemo(() => layoutPages(pages, pageW), [pages, pageW]);
  // full world content rect (infinity paper reaches into negative quadrants);
  // drives viewport clamping, fit and the roam area
  const worldBounds = useMemo(() => worldBoundsOf(layouts, pageW), [layouts, pageW]);
  const worldW = worldBounds.x1 - worldBounds.x0;
  const layoutsRef = useRef(layouts);
  layoutsRef.current = layouts;
  const pageWRef = useRef(pageW);
  pageWRef.current = pageW;
  const infiniteRef = useRef(infinite);
  infiniteRef.current = infinite;
  const minimapOn = useApp((s) => s.settings.minimap);

  // -------------------------------------------------- container size + vp init + clamp
  // useLayoutEffect ⇒ the fit lands BEFORE the browser paints the first frame —
  // the stale module vp from a previous editor session can never flash on
  // screen (open a PDF → instantly centered & fitted, never "far away").
  // Runs ONCE per notebook (not on every growth — the old worldW dep refit
  // the view whenever the endless sheet grew, which yanked the user around
  // while writing). Infinity paper reopens at the EXACT pan/zoom the user
  // left (lastVp), so content coordinates never drift between sessions.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const apply = () => {
      const w = el.clientWidth, h = el.clientHeight;
      setViewportSize(w, h);
      const wb = worldBoundsOf(layoutsRef.current, pageWRef.current);
      const ww = wb.x1 - wb.x0;
      const wh = wb.y1 - wb.y0;
      const inf = infiniteRef.current;
      const lastFitW = lastFitWRef.current;
      if (lastFitW && Math.abs(w - lastFitW) > 96) {
        if (!inf) {
          // dramatic container change (device rotate / preview panel resize) —
          // refit the width but keep the world point under the viewport center,
          // so the reader never ends up with content cut off to one side.
          const v = getVp();
          const wy = (h / 2 - v.ty) / v.scale;
          fitWidth(w, ww, wb.x0, wb.y0);
          lastFitWRef.current = w;
          setVp({ ty: h / 2 - wy * getVp().scale });
        } else {
          // endless sheet: keep the view, just re-assert the roam clamp
          lastFitWRef.current = w;
        }
        clampVpToWorld(w, h, ww, wh, inf, wb.x0, wb.y0);
      } else {
        // small jitter (scrollbars, mobile URL bar) — just re-center/clamp
        clampVpToWorld(w, h, ww, wh, inf, wb.x0, wb.y0);
      }
    };
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    setViewportSize(el.clientWidth, el.clientHeight);
    if (initedForRef.current !== notebookId && hasNotebook) {
      initedForRef.current = notebookId;
      if (infinite && notebook?.lastVp) {
        setVp(notebook.lastVp);
      } else {
        fitWidth(el.clientWidth, worldW, worldBounds.x0, worldBounds.y0);
      }
      // Per-file memory: land on the last page this notebook was read at —
      // BEFORE the first paint, so the restored position is what the user sees
      // (infinity paper is covered by lastVp above).
      if (!infinite && !restoredRef.current) {
        restoredRef.current = true;
        const remembered = recallPage(notebookId);
        const l = remembered ? layoutsRef.current.find((x) => x.id === remembered) : null;
        if (l) {
          const h = el.clientHeight;
          setVp({ ty: h * 0.35 - (l.y - l.padY) * getVp().scale });
          const wb = worldBoundsOf(layoutsRef.current, pageW);
          clampVpToWorld(el.clientWidth, h, wb.x1 - wb.x0, wb.y1 - wb.y0, false, wb.x0, wb.y0);
          useApp.getState().setActivePage(l.id);
        }
      }
    }
    lastFitWRef.current = el.clientWidth;
    return () => ro.disconnect();
  }, [notebookId, hasNotebook]);

  // persist the viewport while browsing the endless sheet (debounced idle
  // writes — closing the app mid-session still finds the last position)
  useEffect(() => {
    if (!infinite) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const offIdle = onVpIdle(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        const nb = useApp.getState().notebooks.find((n) => n.id === notebookId);
        if (nb && nb.pageSize === 'infinite') void useApp.getState().saveNotebookVp(notebookId, { ...getVp() });
      }, 1200);
    });
    return () => {
      offIdle();
      if (timer) clearTimeout(timer);
      // leaving the notebook (or the editor) — save the last view
      const st = useApp.getState();
      const nb = st.notebooks.find((n) => n.id === notebookId);
      if (nb && nb.pageSize === 'infinite') void st.saveNotebookVp(notebookId, { ...getVp() });
    };
  }, [notebookId, infinite]);

  // Infinity paper: Concepts-style near-unbounded zoom (8%–2400%). Regular
  // notebooks keep the classic 50%–800% range. Applied whenever the open
  // notebook changes.
  useEffect(() => {
    setZoomRangeFor(infinite);
  }, [infinite]);

  useEffect(() => {
    return subscribeVp(() => {
      const el = containerRef.current;
      if (!el) return;
      clampVpToWorld(el.clientWidth, el.clientHeight, worldW, worldH, infinite, worldBounds.x0, worldBounds.y0);
      // active page = page under viewport center
      const v = getVp();
      const wy = (el.clientHeight / 2 - v.ty) / v.scale;
      const p = pageAtWorldY(layoutsRef.current, wy);
      if (p) useApp.getState().setActivePage(p.id);
    });
  }, [worldW, worldH, worldBounds, infinite]);

  // -------------------------------------------------- thumbnails (async, downsampled)
  // Edits (docVersions bumps) re-render through the shared thumbs module; on
  // editor open every page WITHOUT a cached thumbnail is primed — PDF pages the
  // user never visited get real content in the Pages popup instead of blanks.
  const pagesKey = useMemo(() => pages.map((p) => p.id).join(','), [pages]);
  useEffect(() => {
    if (!pagesKey) return;
    let alive = true;
    void (async () => {
      for (const p of useApp.getState().editor.pages) {
        if (!alive) return;
        const rec = await db.getThumb(p.id);
        if (rec) continue;
        const url = await ensureThumb(p, pageW);
        if (!alive) return;
        if (url) setThumbVersion((v) => v + 1);
      }
    })();
    return () => { alive = false };
  }, [pagesKey, pageW]);

  useEffect(() => {
    let alive = true;
    const lastVersions = new Map<string, number>();
    const timer = setInterval(() => {
      const id = dirtyThumbsRef.current.values().next().value as string | undefined;
      if (!id) return;
      dirtyThumbsRef.current.delete(id);
      const page = useApp.getState().editor.pages.find((p) => p.id === id);
      if (page) void refreshThumb(page, pageW).then(() => { if (alive) setThumbVersion((v) => v + 1) });
    }, 900);
    const unsub = useApp.subscribe((state) => {
      for (const p of state.editor.pages) {
        const v = state.editor.docVersions[p.id] ?? 0;
        if (v > 0 && lastVersions.get(p.id) !== v) {
          lastVersions.set(p.id, v);
          dirtyThumbsRef.current.add(p.id);
        }
      }
    });
    return () => {
      alive = false;
      clearInterval(timer);
      unsub();
    };
  }, [pageW]);

  // -------------------------------------------------- keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const st = useApp.getState();
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); st.undo() }
      else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); st.redo() }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        if (st.editor.tool === 'lasso' && st.editor.clipboard && st.editor.activePageId) {
          e.preventDefault();
          st.pasteClipboard(st.editor.activePageId);
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (st.editor.selection) { e.preventDefault(); st.deleteSelection() }
      } else if (e.key === 'Escape') {
        if (textSession) setTextSession(null);
        else if (st.editor.selection) st.setSelection(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [textSession]);

  // quarantine notice
  useEffect(() => {
    const flagged = Object.entries(quarantine).filter(([, v]) => v);
    if (flagged.length) toast.warning(t('editor.quarantined'));
  }, [quarantine, t]);

  // -------------------------------------------------- culling is inside WorldLayer (no per-frame React renders)

  const activePage = pages.find((p) => p.id === activePageId) ?? pages[0];
  const activeIndex = pages.findIndex((p) => p.id === activePage?.id);

  const onTextTap = useCallback((pageId: string, pt: { x: number; y: number }, existing: TextSession['existing']) => {
    const layout = layoutsRef.current.find((l) => l.id === pageId);
    if (!layout) return;
    setTextSession({ pageId, layoutY: layout.y, existing, pt });
    useApp.getState().setTool('text');
  }, []);

  const doExport = async (kind: 'png' | 'pdfPage' | 'pdfNotebook' | 'sharePng') => {
    if (!activePage) return;
    try {
      const loading = toast.loading(
        kind === 'png' || kind === 'sharePng' ? t('export.png.building') : t('export.pdf.building'),
      );
      const mod = await import('@/lib/nanote/export');
      if (kind === 'png') await mod.exportPagePng(activePage.id).then(({ blob, filename }) => mod.downloadBlob(blob, filename));
      if (kind === 'sharePng') await mod.sharePagePng(activePage.id);
      if (kind === 'pdfPage') await mod.exportPagePdf(activePage.id);
      if (kind === 'pdfNotebook') await mod.exportNotebookPdf(notebookId);
      toast.success(t('export.done'), { id: loading });
    } catch (e) {
      console.warn(e);
      toast.error(t('error.generic'));
    }
  };

  if (!notebook) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <Button onClick={() => useApp.getState().closeEditor()}>{t('common.back')}</Button>
      </main>
    );
  }

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-background" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {/* ------------------------------------------------ top bar */}
      <header className="z-40 flex h-14 shrink-0 items-center gap-1 border-b border-border bg-background/90 px-2 backdrop-blur">
        <Button variant="ghost" size="icon" aria-label={t('common.back')} onClick={() => useApp.getState().closeEditor()}>
          <ArrowLeft className="h-5 w-5 rtl:-scale-x-100" />
        </Button>
        <button
          type="button"
          className="mx-1 min-w-0 max-w-[38vw] truncate rounded-md px-2 py-1 text-sm font-semibold hover:bg-accent lg:max-w-none"
          onClick={() => setRenameOpen(true)}
          aria-label={t('common.rename')}
          title={notebook.title}
        >
          {notebook.title}
        </button>
        {/* page manager — opens the pages popup (jump / insert / delete / export) */}
        <Button
          variant="ghost"
          className="h-9 shrink-0 gap-1.5 rounded-full px-2.5"
          onClick={() => setPagesOpen(true)}
          aria-label={t('editor.pages')}
          aria-haspopup="dialog"
          title={t('editor.pages')}
        >
          <LayoutGrid className="h-4 w-4" />
          <span className="text-xs font-semibold tabular-nums">
            {activeIndex + 1} / {pages.length}
          </span>
        </Button>

        <div className="ms-auto flex items-center gap-0.5">
          <Button variant="ghost" size="icon" aria-label={t('editor.undo')} disabled={undoDepth === 0} onClick={() => useApp.getState().undo()}>
            <Undo2 className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon" aria-label={t('editor.redo')} disabled={redoDepth === 0} onClick={() => useApp.getState().redo()}>
            <Redo2 className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={activePage?.isBookmarked ? t('editor.bookmark.remove') : t('editor.bookmark')}
            onClick={() => { if (activePage) void useApp.getState().updatePage(activePage.id, { isBookmarked: !activePage.isBookmarked }) }}
          >
            {activePage?.isBookmarked ? <BookmarkCheck className="h-5 w-5 text-warning" /> : <Bookmark className="h-5 w-5" />}
          </Button>
          <Button variant="ghost" size="icon" aria-label={t('editor.outline')} onClick={() => setOutlineOpen(true)}>
            <ListTree className="h-5 w-5" />
          </Button>
          {/* pen & input settings — stylus buttons, finger gestures, palm rejection */}
          <Button variant="ghost" size="icon" aria-label={t('input.title')} title={t('input.title')} onClick={() => setInputOpen(true)}>
            <SlidersHorizontal className="h-5 w-5" />
          </Button>
          {infinite && (
            <>
              {/* endless-sheet paper: pattern + color, changeable anytime */}
              <PaperPicker page={activePage} />
              {/* minimap toggle */}
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('editor.minimap')}
                title={t('editor.minimap')}
                className={minimapOn ? 'text-primary' : undefined}
                onClick={() => useApp.getState().setSettings({ minimap: !minimapOn })}
              >
                <MapIcon className="h-5 w-5" />
              </Button>
            </>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={t('common.more')}>
                <MoreVertical className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => {
                const idx = activeIndex;
                void useApp.getState().insertPage(idx, notebook.defaultTemplate).then((id) => {
                  const l = layoutsRef.current.find((x) => x.id === id);
                  if (l) scrollToPage(l, 0.4);
                  toast.success(t('editor.addPage'));
                });
              }}>
                <Plus className="h-4 w-4" /> {t('editor.addPage')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void doExport('png')}>
                <FileImage className="h-4 w-4" /> {t('editor.exportPng')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void doExport('pdfPage')}>
                <FileText className="h-4 w-4" /> {t('editor.exportPage')} — PDF
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void doExport('pdfNotebook')}>
                <NotebookPen className="h-4 w-4" /> {t('editor.exportNotebook')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void doExport('sharePng')}>
                <Share2 className="h-4 w-4" /> {t('editor.sharePage')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* ------------------------------------------------ viewport */}
      <div ref={containerRef} className="relative min-h-0 flex-1" data-viewport>
        {/* world — direct-DOM transform + culling (see WorldLayer below) */}
        <WorldLayer pages={pages} layouts={layouts} pageW={pageW} worldH={worldH} infinite={infinite} />

        <ToolRail pageW={pageW} />

        {/* infinity paper: mini overview map (toggle in the top bar) */}
        {infinite && minimapOn && activePage && (() => {
          const l = layouts.find((x) => x.id === activePage.id);
          return l ? (
            <div className="absolute end-3 top-3 z-20">
              <InfinityMinimap page={activePage} layout={l} />
            </div>
          ) : null;
        })()}

        <InkSurface layouts={layouts} pageW={pageW} onTextTap={onTextTap} />
        <TextLayer layouts={layouts} pageW={pageW} notebookId={notebookId} />
        <LiveOverlay />
        <SelectionLayer layouts={layouts} pageW={pageW} />
        <Ruler />

        {textSession && (
          <TextEditorOverlay session={textSession} onDone={() => setTextSession(null)} />
        )}

        {/* zoom bar — the only component that re-renders per vp frame */}
        <ZoomBar
          fitW={activePage ? layouts.find((l) => l.id === activePage.id)?.w ?? pageW : pageW}
          leftHanded={leftHanded}
          onFit={infinite ? () => {
            // Fit on the endless sheet = frame the actual CONTENT (ink, text,
            // shapes, images) — doubles as "jump back to my notes" when lost
            const doc = activePage ? useApp.getState().editor.docs[activePage.id] : null;
            const l = activePage ? layouts.find((x) => x.id === activePage.id) : null;
            if (!l || !activePage) return;
            let b = { x0: -l.padX, y0: l.y - l.padY, x1: l.w - l.padX, y1: l.y - l.padY + l.h };
            if (doc && doc.elements.length) {
              let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
              for (const el of doc.elements) {
                const bb = elementBBox(el);
                if (bb.x0 < x0) x0 = bb.x0;
                if (bb.y0 < y0) y0 = bb.y0;
                if (bb.x1 > x1) x1 = bb.x1;
                if (bb.y1 > y1) y1 = bb.y1;
              }
              if (x0 !== Infinity) b = { x0, y0: y0 + l.y, x1, y1: y1 + l.y };
            }
            fitToBounds(b, containerRef.current?.clientWidth ?? 800, containerRef.current?.clientHeight ?? 600);
          } : undefined}
        />
      </div>

      {/* pages popup (jump / insert / duplicate / delete / export / multi-select) */}
      <PagesDialog open={pagesOpen} onOpenChange={setPagesOpen} layouts={layouts} thumbVersion={thumbVersion} notebookId={notebookId} />

      {/* pen & input settings (stylus buttons + finger gestures) */}
      <InputSettingsSheet open={inputOpen} onOpenChange={setInputOpen} />

      {/* outline sheet */}
      <Sheet open={outlineOpen} onOpenChange={setOutlineOpen}>
        <SheetContent side="bottom" className="max-h-[70vh] overflow-y-auto nanote-scroll rounded-t-2xl p-0" dir="ltr">
          <SheetHeader className="border-b border-border px-4 py-3">
            <SheetTitle className="text-base">{t('editor.outline')}</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 p-4 pb-24">
            <section>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                <Bookmark className="h-4 w-4" /> {t('editor.bookmarks')}
              </h3>
              {pages.filter((p) => p.isBookmarked).length === 0 ? (
                <p className="text-sm text-muted-foreground">—</p>
              ) : (
                <ul className="space-y-1">
                  {pages.map((p, i) => p.isBookmarked ? (
                    <li key={p.id}>
                      <button
                        type="button"
                        className="w-full rounded-lg px-3 py-2 text-start text-sm hover:bg-accent press-scale"
                        onClick={() => {
                          const l = layouts.find((x) => x.id === p.id);
                          if (l) scrollToPage(l, 0.35);
                          setOutlineOpen(false);
                        }}
                      >
                        {t('editor.page').replace('{n}', String(i + 1))}
                      </button>
                    </li>
                  ) : null)}
                </ul>
              )}
            </section>
            <section>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                <ListTree className="h-4 w-4" /> {t('pages.labels')}
              </h3>
              <ul className="space-y-2">
                {pages.map((p, i) => (
                  <li key={p.id} className="rounded-xl border border-border p-3">
                    <div className="mb-1.5 text-xs font-semibold text-muted-foreground">
                      {t('editor.page').replace('{n}', String(i + 1))}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {p.labels.map((label) => (
                        <span key={label.id} className="flex items-center gap-1 rounded-full bg-surface-variant px-2.5 py-1 text-xs">
                          {label.title}
                          <button
                            type="button"
                            aria-label={t('common.delete')}
                            onClick={() => void useApp.getState().updatePage(p.id, { labels: p.labels.filter((l) => l.id !== label.id) })}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      <AddLabelInput onAdd={(title) => void useApp.getState().updatePage(p.id, { labels: [...p.labels, { id: uid(), title }] })} />
                    </div>
                    <button
                      type="button"
                      className="mt-2 text-xs font-medium text-primary hover:underline"
                      onClick={() => {
                        const l = layouts.find((x) => x.id === p.id);
                        if (l) scrollToPage(l, 0.35);
                        setOutlineOpen(false);
                      }}
                    >
                      {t('pages.jump')} →
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </SheetContent>
      </Sheet>

      {/* rename dialog */}
      <RenameDialog key={renameOpen ? 'open' : 'closed'} open={renameOpen} onOpenChange={setRenameOpen} initial={notebook.title} onConfirm={(title) => void useApp.getState().renameNotebook(notebookId, title)} />

    </main>
  );
}

// ---------------------------------------------------------------- helpers & subcomponents
/**
 * WorldLayer — the zoom/pan world container.
 * The transform is written DIRECTLY to the DOM node on every vp
 * change (subscribeVp + translate3d → GPU-composited). React does NOT re-render
 * here while the viewport moves; culling state updates only when the VISIBLE
 * SET actually changes, and PageCanvas never subscribes to vp — so gestures
 * stay pure compositor work (no React renders, no re-rasters mid-gesture).
 */
function WorldLayer({ pages, layouts, pageW, worldH, infinite }: {
  pages: PageRow[];
  layouts: PageLayout[];
  pageW: number;
  worldH: number;
  infinite: boolean;
}) {
  const worldRef = useRef<HTMLDivElement>(null);
  const [visibleIds, setVisibleIds] = useState<Set<string>>(() => new Set(layouts.slice(0, 2).map((l) => l.id)));

  useEffect(() => {
    const el = worldRef.current;
    if (!el) return;
    let lastKey = '';
    let containerH = el.parentElement?.clientHeight ?? 800;
    const ro = new ResizeObserver(() => {
      containerH = el.parentElement?.clientHeight ?? containerH;
    });
    if (el.parentElement) ro.observe(el.parentElement);

    const apply = () => {
      const vp: Vp = getVp();
      el.style.transform = `translate3d(${vp.tx}px, ${vp.ty}px, 0) scale(${vp.scale})`;
      // culling — infinity-paper pages render viewport windows (cheap), so
      // they stay mounted at all times; fixed pages cull to the visible band
      const top = -vp.ty / vp.scale;
      const bottom = (containerH - vp.ty) / vp.scale;
      const ids = layouts.map((l) => l.id);
      const set = new Set<string>();
      let first = -1, last = -1;
      layouts.forEach((l, i) => {
        const boxTop = l.y - l.padY;
        const pageBottom = boxTop + l.h;
        const visible = infinite || (pageBottom >= top - l.h * CULL_MARGIN && boxTop <= bottom + l.h * CULL_MARGIN);
        if (visible) {
          set.add(l.id);
          if (first === -1) first = i;
          last = i;
        }
      });
      if (!infinite) {
        if (first > 0) set.add(ids[first - 1]);
        if (last >= 0 && last < ids.length - 1) set.add(ids[last + 1]);
      }
      const key = [...set].join('|');
      if (key !== lastKey) {
        lastKey = key;
        setVisibleIds(set);
      }
    };
    const off = subscribeVp(apply);
    apply();
    return () => { off(); ro.disconnect() };
  }, [layouts, infinite]);

  return (
    <div
      ref={worldRef}
      className="absolute left-0 top-0 z-0"
      style={{
        width: pageW,
        height: worldH,
        transformOrigin: '0 0',
        willChange: 'transform',
        backfaceVisibility: 'hidden',
      }}
      aria-hidden
    >
      {layouts.map((l) => {
        const page = pages.find((p) => p.id === l.id);
        if (!page) return null;
        return visibleIds.has(l.id) ? (
          <PageCanvas key={l.id} page={page} layout={l} infinite={infinite} />
        ) : (
          <div
            key={l.id}
            className="absolute shadow-ink-2"
            style={{ left: -l.padX, top: l.y - l.padY, width: l.w, height: l.h, background: page.backgroundHex || '#fff', borderRadius: 4, outline: '1px solid rgba(22,35,58,0.10)' }}
          />
        );
      })}
    </div>
  );
}

/**
 * ZoomBar — the only editor component that re-renders per vp frame (tiny).
 * Zoom anchors are measured from the live DOM so the bar is self-contained.
 * `onFit` (infinity paper) frames the actual content instead of the sheet.
 */
function ZoomBar({ fitW, leftHanded, onFit }: { fitW: number; leftHanded: boolean; onFit?: () => void }) {
  const vp = useVp();
  const { t } = useT();
  const zoomPct = Math.round(vp.scale * 100);
  const hostOf = (el: HTMLElement) => {
    const host = el.closest('[data-viewport]') as HTMLElement | null;
    return { w: host?.clientWidth ?? window.innerWidth, h: host?.clientHeight ?? window.innerHeight };
  };
  return (
    <div
      dir="ltr"
      className={cn(
        // mobile: floats above the bottom tool rail; desktop: bottom-left of the canvas
        'absolute bottom-[76px] z-30 flex items-center gap-0.5 rounded-full border border-border bg-card/95 p-1 shadow-ink-2 backdrop-blur lg:bottom-3',
        leftHanded ? 'end-3' : 'start-3',
      )}
      role="toolbar"
      aria-label={t('editor.zoom')}
    >
      <button type="button" aria-label={t('editor.zoom')} title={t('editor.zoom')} className="flex h-8 min-w-14 items-center justify-center rounded-full px-2 text-xs font-semibold tabular-nums hover:bg-accent" onClick={(e) => { const { w, h } = hostOf(e.currentTarget); animateZoomTo(w / 2, h / 2, 1) }}>
        {zoomPct}%
      </button>
      <span className="h-4 w-px bg-border" />
      <button type="button" aria-label={t('editor.zoomOut', 'Zoom out', 'تصغير')} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-accent" onClick={(e) => { const { w, h } = hostOf(e.currentTarget); animateZoomTo(w / 2, h / 2, vp.scale / 1.25) }}><ZoomOut className="h-4 w-4" /></button>
      <button type="button" aria-label={t('editor.zoomIn', 'Zoom in', 'تكبير')} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-accent" onClick={(e) => { const { w, h } = hostOf(e.currentTarget); animateZoomTo(w / 2, h / 2, vp.scale * 1.25) }}><ZoomIn className="h-4 w-4" /></button>
      <button type="button" aria-label={onFit ? t('editor.fitContent') : t('editor.fit')} title={onFit ? t('editor.fitContent') : t('editor.fit')} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-accent" onClick={(e) => {
        if (onFit) { onFit(); return }
        const { w } = hostOf(e.currentTarget);
        animatedFit(w, fitW);
      }}><Maximize2 className="h-4 w-4" /></button>
    </div>
  );
}

/** Endless-sheet paper picker — pattern (plain / grid / dots / lines) + paper
 *  color, changeable at ANY time. Lives in the editor top bar. */
function PaperPicker({ page }: { page: PageRow | undefined }) {
  const { t } = useT();
  if (!page) return null;
  const styles: { id: TemplateId; label: string; icon: string }[] = [
    { id: 'blank', label: t('paper.plain'), icon: '▭' },
    { id: 'grid', label: t('paper.grid'), icon: '▦' },
    { id: 'dotgrid', label: t('paper.dots'), icon: '⋯' },
    { id: 'ruled', label: t('paper.lined'), icon: '☰' },
  ];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('paper.title')} title={t('paper.title')}>
          <Palette className="h-5 w-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-3" dir="auto">
        <p className="mb-2 text-xs font-semibold text-muted-foreground">{t('paper.title')}</p>
        <div className="grid grid-cols-4 gap-1.5" role="group" aria-label={t('paper.title')}>
          {styles.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-label={s.label}
              aria-pressed={page.template === s.id}
              onClick={() => void useApp.getState().updatePage(page.id, { template: s.id })}
              className={cn(
                'flex h-14 flex-col items-center justify-center gap-1 rounded-lg border text-[10px] font-medium transition-colors',
                page.template === s.id
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:bg-accent',
              )}
            >
              <span className="text-lg leading-none" aria-hidden>{s.icon}</span>
              {s.label}
            </button>
          ))}
        </div>
        <p className="mb-2 mt-3 text-xs font-semibold text-muted-foreground">{t('paper.color')}</p>
        <div className="flex flex-wrap gap-1.5">
          {PAPER_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              aria-pressed={page.backgroundHex === c}
              onClick={() => void useApp.getState().updatePage(page.id, { backgroundHex: c })}
              className={cn(
                'h-7 w-7 rounded-full border-2 transition-transform press-scale',
                page.backgroundHex === c ? 'border-primary scale-110' : 'border-border',
              )}
              style={{ background: c }}
            />
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{t('paper.hint')}</p>
      </PopoverContent>
    </Popover>
  );
}

function AddLabelInput({ onAdd }: { onAdd: (title: string) => void }) {
  const { t } = useT();
  const [value, setValue] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const v = value.trim();
        if (v) { onAdd(v); setValue('') }
      }}
      className="flex items-center gap-1"
    >
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t('pages.label.add')}
        className="h-8 w-36 rounded-full text-xs"
        aria-label={t('pages.label.add')}
      />
      <Button type="submit" size="icon" variant="ghost" className="h-8 w-8 rounded-full" aria-label={t('common.add')}>
        <Check className="h-4 w-4" />
      </Button>
    </form>
  );
}

function RenameDialog({ open, onOpenChange, initial, onConfirm }: {
  open: boolean; onOpenChange: (v: boolean) => void; initial: string; onConfirm: (title: string) => void;
}) {
  const { t } = useT();
  const [value, setValue] = useState(initial);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('common.rename')}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const v = value.trim();
            if (v) { onConfirm(v); onOpenChange(false) }
          }}
        >
          <Input value={value} onChange={(e) => setValue(e.target.value)} maxLength={80} aria-label={t('common.title')} autoFocus />
          <DialogFooter className="mt-4">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
            <Button type="submit">{t('common.save')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
