'use client';
// PagesDialog — the notebook's page manager, opened from the top bar next to
// the file name + page count. Replaces the old side filmstrip with one popup:
//   • jump to any page (click its thumbnail)
//   • per-page menu: insert after · duplicate · export PNG/PDF · delete
//   • multi-select: batch delete + batch export (one PDF / sequential PNGs)
//   • drag-reorder via the grip handle
// Thumbnails come from the IDB cache kept warm by EditorShell.
import { useEffect, useRef, useState } from 'react';
import {
  Plus, Copy, Trash2, MoreVertical, GripVertical, FileImage, FileText, Check,
  ListChecks, CheckSquare, Square,
} from 'lucide-react';
import { toast } from 'sonner';
import { useApp, useT } from '@/lib/nanote/store';
import { cn } from '@/lib/utils';
import * as db from '@/lib/nanote/idb';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/features/library/ConfirmDialog';
import { scrollToPage, type PageLayout } from './viewport';

export function PagesDialog({
  open, onOpenChange, layouts, thumbVersion, notebookId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  layouts: PageLayout[];
  thumbVersion: number;
  notebookId: string;
}) {
  const { t, fmt } = useT();
  const pages = useApp((s) => s.editor.pages);
  const activePageId = useApp((s) => s.editor.activePageId);
  const notebook = useApp((s) => s.notebooks.find((n) => n.id === notebookId));

  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  // pages are always laid out by pageIndex
  const ordered = [...layouts].sort((a, b) => {
    const pa = pages.find((p) => p.id === a.id)?.pageIndex ?? 0;
    const pb = pages.find((p) => p.id === b.id)?.pageIndex ?? 0;
    return pa - pb;
  });

  // ------------------------------------------------ thumbnail load + active scroll
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void (async () => {
      const entries = await Promise.all(
        ordered.map(async (l) => {
          const rec = await db.getThumb(l.id);
          return [l.id, rec?.dataUrl ?? ''] as const;
        }),
      );
      if (alive) setThumbs(Object.fromEntries(entries));
    })();
    return () => { alive = false };
  }, [open, layouts, thumbVersion]);

  useEffect(() => {
    if (!open) { setSelectMode(false); setSelected(new Set()) }
  }, [open]);

  // when opened, bring the active page's card into view
  useEffect(() => {
    if (!open) return;
    const id = useApp.getState().editor.activePageId;
    requestAnimationFrame(() => {
      const el = gridRef.current?.querySelector(`[data-pg-active="true"]`);
      el?.scrollIntoView({ block: 'center', inline: 'nearest' });
    });
  }, [open]);

  // ------------------------------------------------ actions
  const jumpTo = (l: PageLayout) => {
    scrollToPage(l, 0.35);
    onOpenChange(false);
  };

  const insertAfter = async (index: number) => {
    const st = useApp.getState();
    const id = await st.insertPage(index, notebook?.defaultTemplate ?? 'blank');
    if (id) toast.success(t('pages.insert'));
    requestAnimationFrame(() => {
      const cells = gridRef.current?.querySelectorAll('[data-pg]');
      (cells?.[cells.length - 1] as HTMLElement | undefined)?.scrollIntoView({ block: 'end', behavior: 'smooth' });
    });
  };

  const deleteOne = async (id: string) => {
    if (pages.length <= 1) { toast.error(t('pages.deleteLast')); return }
    await useApp.getState().deletePage(id);
    toast.success(t('common.delete'));
  };

  const deleteSelected = async () => {
    const ids = ordered.map((l) => l.id).filter((id) => selected.has(id));
    if (!ids.length || ids.length >= pages.length) { toast.error(t('pages.deleteLast')); return }
    setBusy(true);
    try {
      for (const id of ids) await useApp.getState().deletePage(id);
      toast.success(fmt(t('pages.deletedN'), { n: ids.length }));
    } finally {
      setBusy(false);
      setSelected(new Set());
      setConfirmDelete(false);
    }
  };

  const exportSelectedPdf = async () => {
    const ids = ordered.map((l) => l.id).filter((id) => selected.has(id));
    if (!ids.length) return;
    setBusy(true);
    const loading = toast.loading(t('export.pdf.building'));
    try {
      const mod = await import('@/lib/nanote/export');
      await mod.exportPagesPdf(notebookId, ids);
      toast.success(t('export.done'), { id: loading });
    } catch (e) {
      console.warn(e);
      toast.error(t('error.generic'), { id: loading });
    } finally { setBusy(false) }
  };

  const exportSelectedPngs = async () => {
    const ids = ordered.map((l) => l.id).filter((id) => selected.has(id));
    if (!ids.length) return;
    setBusy(true);
    const loading = toast.loading(fmt(t('export.png.multiple'), { n: ids.length }));
    try {
      const mod = await import('@/lib/nanote/export');
      for (let i = 0; i < ids.length; i++) {
        const { blob, filename } = await mod.exportPagePng(ids[i]);
        mod.downloadBlob(blob, filename);
        if (i < ids.length - 1) await new Promise((r) => setTimeout(r, 350));
      }
      toast.success(t('export.done'), { id: loading });
    } catch (e) {
      console.warn(e);
      toast.error(t('error.generic'), { id: loading });
    } finally { setBusy(false) }
  };

  const exportOne = async (kind: 'png' | 'pdf', id: string) => {
    const loading = toast.loading(kind === 'png' ? t('export.png.building') : t('export.pdf.building'));
    try {
      const mod = await import('@/lib/nanote/export');
      if (kind === 'png') {
        const { blob, filename } = await mod.exportPagePng(id);
        mod.downloadBlob(blob, filename);
      } else {
        await mod.exportPagePdf(id);
      }
      toast.success(t('export.done'), { id: loading });
    } catch (e) {
      console.warn(e);
      toast.error(t('error.generic'), { id: loading });
    }
  };

  // ------------------------------------------------ drag reorder (grid)
  const dragRef = useRef<{ id: string; index: number; overIndex: number } | null>(null);

  const startDrag = (e: React.PointerEvent, id: string, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { id, index, overIndex: index };
    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const hit = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-pg]') as HTMLElement | null;
      const idx = hit ? Number(hit.dataset.pg) : -1;
      gridRef.current?.querySelectorAll('[data-pg]').forEach((el) => {
        (el as HTMLElement).style.outline = '';
      });
      if (idx >= 0 && idx !== d.index) {
        d.overIndex = idx;
        (hit as HTMLElement).style.outline = '2px solid #1E6FF2';
      }
    };
    const onUp = () => {
      const d = dragRef.current;
      dragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      gridRef.current?.querySelectorAll('[data-pg]').forEach((el) => {
        (el as HTMLElement).style.outline = '';
      });
      if (d && d.overIndex !== d.index) {
        const ids = ordered.map((l) => l.id);
        const [moved] = ids.splice(d.index, 1);
        ids.splice(d.overIndex, 0, moved);
        void useApp.getState().reorderPages(ids);
        toast.success(t('pages.reorder'));
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const toggleSel = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // ------------------------------------------------ render
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex h-[85dvh] w-[95vw] max-w-5xl flex-col gap-0 overflow-hidden p-0 sm:rounded-2xl">
          <DialogHeader className="flex-row items-center gap-2 border-b border-border px-4 py-3">
            <DialogTitle className="text-base">{t('pages.title')}</DialogTitle>
            <span className="text-xs font-medium text-muted-foreground tabular-nums">
              {fmt(t('pages.countN'), { n: ordered.length })}
            </span>
            <div className="ms-auto flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
                onClick={() => {
                  const next = !selectMode;
                  setSelectMode(next);
                  if (!next) setSelected(new Set());
                }}
                aria-pressed={selectMode}
              >
                {selectMode ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4" />}
                <span className="hidden sm:inline">{t(selectMode ? 'common.done' : 'pages.select')}</span>
              </Button>
              <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => void insertAfter(pages.length - 1)}>
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">{t('editor.addPage')}</span>
              </Button>
            </div>
          </DialogHeader>

          {/* grid */}
          <div ref={gridRef} className="nanote-scroll min-h-0 flex-1 overflow-y-auto p-4">
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
              {ordered.map((l, i) => {
                const page = pages.find((p) => p.id === l.id);
                const isActive = l.id === activePageId;
                const isSel = selected.has(l.id);
                return (
                  <div
                    key={l.id}
                    data-pg={i}
                    data-pg-active={isActive}
                    className={cn(
                      'group relative rounded-lg border-2 bg-card p-1 shadow-ink-1',
                      isSel ? 'border-primary ring-2 ring-primary/30'
                        : isActive ? 'border-primary'
                        : 'border-border hover:border-primary/50',
                      selectMode ? 'cursor-pointer' : '',
                    )}
                  >
                    <button
                      type="button"
                      className="block w-full"
                      aria-label={fmt(t('editor.page'), { n: i + 1 })}
                      onClick={() => (selectMode ? toggleSel(l.id) : jumpTo(l))}
                    >
                      <div className="relative w-full overflow-hidden rounded-md bg-white" style={{ aspectRatio: `${l.w} / ${l.h}` }}>
                        {thumbs[l.id] ? (
                          <img src={thumbs[l.id]} alt="" className="h-full w-full object-contain" draggable={false} />
                        ) : (
                          <div
                            className="thumb-skeleton h-full w-full"
                            style={{ background: page?.backgroundHex || '#fff' }}
                          />
                        )}
                        <span className="absolute start-1 top-1 rounded bg-black/55 px-1 text-[10px] font-semibold text-white tabular-nums">
                          {i + 1}
                        </span>
                        {page?.isBookmarked && (
                          <span className="absolute end-1 top-1 h-2 w-2 rounded-full bg-warning" aria-label={t('pages.bookmarked')} />
                        )}
                        {isSel && (
                          <span className="absolute end-1 bottom-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-white shadow">
                            <Check className="h-3.5 w-3.5" />
                          </span>
                        )}
                      </div>
                    </button>

                    {/* drag handle */}
                    <button
                      type="button"
                      aria-label={t('pages.reorder')}
                      className="absolute start-0.5 top-8 z-10 hidden h-7 w-7 cursor-grab items-center justify-center rounded-md bg-card/90 text-muted-foreground shadow-ink-1 group-hover:flex"
                      onPointerDown={(e) => startDrag(e, l.id, i)}
                    >
                      <GripVertical className="h-4 w-4" />
                    </button>

                    {/* per-page menu */}
                    {!selectMode && (
                      <div className="absolute end-1 top-7 z-10 hidden group-hover:block">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              aria-label={t('common.more')}
                              className="flex h-7 w-7 items-center justify-center rounded-md bg-card/90 shadow-ink-1"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            <DropdownMenuItem onClick={() => void insertAfter(i)}>
                              <Plus className="h-4 w-4" /> {t('pages.insertHere')}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => void useApp.getState().duplicatePage(l.id).then(() => toast.success(t('pages.duplicate')))}>
                              <Copy className="h-4 w-4" /> {t('pages.duplicate')}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => void exportOne('png', l.id)}>
                              <FileImage className="h-4 w-4" /> {t('editor.exportPng')}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => void exportOne('pdf', l.id)}>
                              <FileText className="h-4 w-4" /> {t('editor.exportPdf')}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive" onClick={() => void deleteOne(l.id)}>
                              <Trash2 className="h-4 w-4" /> {t('pages.delete')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* selection toolbar */}
          {selectMode && (
            <div className="flex shrink-0 items-center gap-2 border-t border-border bg-card/95 px-3 py-2.5" role="toolbar">
              <span className="text-sm font-semibold tabular-nums">
                {fmt(t('pages.selectedN'), { n: selected.size })}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-8"
                disabled={selected.size >= ordered.length}
                onClick={() => setSelected(new Set(ordered.map((l) => l.id)))}
              >
                <ListChecks className="h-4 w-4" />
                <span className="hidden sm:inline">{t('pages.selectAll')}</span>
              </Button>
              <div className="ms-auto flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5"
                  disabled={!selected.size || busy}
                  onClick={() => void exportSelectedPdf()}
                >
                  <FileText className="h-4 w-4" /> PDF
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5"
                  disabled={!selected.size || busy}
                  onClick={() => void exportSelectedPngs()}
                >
                  <FileImage className="h-4 w-4" /> PNG
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-8 gap-1.5"
                  disabled={!selected.size || selected.size >= pages.length || busy}
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 className="h-4 w-4" />
                  <span className="hidden sm:inline">{t('pages.deleteSelected')}</span>
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('pages.deleteSelected')}
        description={fmt(t('pages.deleteSelected.confirm'), { n: selected.size })}
        confirmLabel={t('common.delete')}
        destructive
        onConfirm={() => deleteSelected()}
      />
    </>
  );
}
