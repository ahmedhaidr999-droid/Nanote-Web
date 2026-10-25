'use client';
// EditorShell — composes the ink editor: world viewport with continuous
// multi-page scroll, top bar (undo/redo, bookmarks, outline, export), filmstrip,
// tool rail, zoom bar, audio panel, ruler and text editing overlay.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Undo2, Redo2, MoreVertical, Bookmark, BookmarkCheck, ListTree, FileImage,
  FileText, NotebookPen, Share2, Eraser, Plus, LayoutGrid, ZoomIn, ZoomOut, Maximize2, Check,
} from 'lucide-react';
import { toast } from 'sonner';
import { useApp, useT } from '@/lib/nanote/store';
import { PAGE_SIZES } from '@/lib/nanote/types';
import { uid } from '@/lib/nanote/util';
import * as db from '@/lib/nanote/idb';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
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
import { PagesDialog } from './PagesDialog';
import { Ruler } from './Ruler';
import { recallPage } from '@/lib/nanote/pagemem';
import {
  fitWidth, getVp, layoutPages, pageAtWorldY, scrollToPage, subscribeVp, useVp,
  animateZoomTo, animatedFit, clampVpToWorld, setViewportSize, setVp, type PageLayout,
} from './viewport';

const CULL_MARGIN = 1;

export default function EditorShell({ notebookId }: { notebookId: string }) {
  const { t } = useT();
  const vp = useVp();
  const notebook = useApp((s) => s.notebooks.find((n) => n.id === notebookId));
  const pages = useApp((s) => s.editor.pages);
  const activePageId = useApp((s) => s.editor.activePageId);
  const undoDepth = useApp((s) => s.editor.undoStack.length);
  const redoDepth = useApp((s) => s.editor.redoStack.length);
  const quarantine = useApp((s) => s.editor.quarantine);
  const leftHanded = useApp((s) => s.settings.leftHanded);

  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const lastFitWRef = useRef(0);   // container width the current fit was computed for
  const [textSession, setTextSession] = useState<TextSession | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [pagesOpen, setPagesOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [thumbVersion, setThumbVersion] = useState(0);
  const dirtyThumbsRef = useRef(new Set<string>());
  const restoredRef = useRef(false); // last-page restore runs once per editor session

  const pageW = PAGE_SIZES[notebook?.pageSize ?? 'a4p'].w;
  const hasNotebook = notebook !== undefined;
  const { layouts, worldH } = useMemo(() => layoutPages(pages, pageW), [pages, pageW]);
  const layoutsRef = useRef(layouts);
  layoutsRef.current = layouts;

  // -------------------------------------------------- container size + vp init + clamp
  // useLayoutEffect ⇒ the fit lands BEFORE the browser paints the first frame —
  // the stale module vp from a previous editor session can never flash on
  // screen (open a PDF → instantly centered & fitted, never "far away").
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const apply = () => {
      const w = el.clientWidth, h = el.clientHeight;
      setViewportSize(w, h);
      setSize({ w, h });
      const wh = layoutsRef.current.reduce((acc, l) => Math.max(acc, l.y + l.h), 0);
      const lastFitW = lastFitWRef.current;
      if (lastFitW && Math.abs(w - lastFitW) > 96) {
        // dramatic container change (device rotate / preview panel resize) —
        // refit the width but keep the world point under the viewport center,
        // so the reader never ends up with content cut off to one side.
        const v = getVp();
        const wy = (h / 2 - v.ty) / v.scale;
        fitWidth(w, pageW);
        lastFitWRef.current = w;
        setVp({ ty: h / 2 - wy * getVp().scale });
        clampVpToWorld(w, h, pageW, wh);
      } else {
        // small jitter (scrollbars, mobile URL bar) — just re-center/clamp
        clampVpToWorld(w, h, pageW, wh);
      }
    };
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    setViewportSize(el.clientWidth, el.clientHeight);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    fitWidth(el.clientWidth, pageW);
    lastFitWRef.current = el.clientWidth;
    // Per-file memory: land on the last page this notebook was read at —
    // BEFORE the first paint, so the restored position is what the user sees
    // (opening a PDF again takes you straight back where you left off).
    if (!restoredRef.current) {
      restoredRef.current = true;
      const remembered = recallPage(notebookId);
      const l = remembered ? layoutsRef.current.find((x) => x.id === remembered) : null;
      if (l) {
        const h = el.clientHeight;
        setVp({ ty: h * 0.35 - l.y * getVp().scale });
        clampVpToWorld(el.clientWidth, h, pageW, layoutsRef.current.reduce((acc, x) => Math.max(acc, x.y + x.h), 0));
        useApp.getState().setActivePage(l.id);
      }
    }
    return () => ro.disconnect();
  }, [pageW, hasNotebook, notebookId]);

  useEffect(() => {
    return subscribeVp(() => {
      const el = containerRef.current;
      if (!el) return;
      clampVpToWorld(el.clientWidth, el.clientHeight, pageW, worldH);
      // active page = page under viewport center
      const v = getVp();
      const wy = (el.clientHeight / 2 - v.ty) / v.scale;
      const p = pageAtWorldY(layoutsRef.current, wy);
      if (p) useApp.getState().setActivePage(p.id);
    });
  }, [pageW, worldH]);

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

  // -------------------------------------------------- culling
  const visibleIds = useMemo(() => {
    const top = -vp.ty / vp.scale;
    const bottom = (size.h - vp.ty) / vp.scale;
    const set = new Set<string>();
    const ids = layouts.map((l) => l.id);
    let first = -1, last = -1;
    layouts.forEach((l, i) => {
      const pageBottom = l.y + l.h;
      const visible = pageBottom >= top - l.h * CULL_MARGIN && l.y <= bottom + l.h * CULL_MARGIN;
      if (visible) {
        set.add(l.id);
        if (first === -1) first = i;
        last = i;
      }
    });
    if (first > 0) set.add(ids[first - 1]);
    if (last >= 0 && last < ids.length - 1) set.add(ids[last + 1]);
    return set;
  }, [layouts, vp.ty, vp.scale, size.h]);

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

  const zoomPct = Math.round(vp.scale * 100);

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
        {/* world */}
        <div
          className="absolute left-0 top-0 z-0"
          style={{
            width: pageW,
            height: worldH,
            transform: `translate(${vp.tx}px, ${vp.ty}px) scale(${vp.scale})`,
            transformOrigin: '0 0',
          }}
          aria-hidden
        >
          {layouts.map((l) => {
            const page = pages.find((p) => p.id === l.id);
            if (!page) return null;
            return visibleIds.has(l.id) ? (
              <PageCanvas key={l.id} page={page} worldY={l.y} pageW={pageW} pageH={page.height} />
            ) : (
              <div
                key={l.id}
                className="absolute shadow-ink-2"
                style={{ left: 0, top: l.y, width: pageW, height: page.height, background: page.backgroundHex || '#fff', borderRadius: 4, outline: '1px solid rgba(22,35,58,0.10)' }}
              />
            );
          })}
        </div>

        <ToolRail pageW={pageW} />

        <InkSurface layouts={layouts} pageW={pageW} onTextTap={onTextTap} />
        <TextLayer layouts={layouts} pageW={pageW} notebookId={notebookId} />
        <LiveOverlay />
        <SelectionLayer layouts={layouts} pageW={pageW} />
        <Ruler />

        {textSession && (
          <TextEditorOverlay session={textSession} onDone={() => setTextSession(null)} />
        )}

        {/* zoom bar */}
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
          <button type="button" aria-label={t('editor.zoom')} title={t('editor.zoom')} className="flex h-8 min-w-14 items-center justify-center rounded-full px-2 text-xs font-semibold tabular-nums hover:bg-accent" onClick={() => animateZoomTo(size.w / 2, size.h / 2, 1)}>
            {zoomPct}%
          </button>
          <span className="h-4 w-px bg-border" />
          <button type="button" aria-label={t('editor.zoomOut', 'Zoom out', 'تصغير')} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-accent" onClick={() => animateZoomTo(size.w / 2, size.h / 2, vp.scale / 1.25)}><ZoomOut className="h-4 w-4" /></button>
          <button type="button" aria-label={t('editor.zoomIn', 'Zoom in', 'تكبير')} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-accent" onClick={() => animateZoomTo(size.w / 2, size.h / 2, vp.scale * 1.25)}><ZoomIn className="h-4 w-4" /></button>
          <button type="button" aria-label={t('editor.fit')} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-accent" onClick={() => animatedFit(size.w, pageW)}><Maximize2 className="h-4 w-4" /></button>
        </div>
      </div>

      {/* pages popup (jump / insert / duplicate / delete / export / multi-select) */}
      <PagesDialog open={pagesOpen} onOpenChange={setPagesOpen} layouts={layouts} thumbVersion={thumbVersion} notebookId={notebookId} />

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
