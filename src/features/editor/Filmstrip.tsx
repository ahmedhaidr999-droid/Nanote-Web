'use client';
// Filmstrip — vertical page thumbnail rail: jump, drag-reorder, insert,
// duplicate, delete. Desktop side rail + mobile sheet share the same list.
import { useEffect, useRef, useState } from 'react';
import { Plus, GripVertical, Copy, Trash2, MoreVertical } from 'lucide-react';
import { toast } from 'sonner';
import { useApp, useT } from '@/lib/nanote/store';
import { cn } from '@/lib/utils';
import * as db from '@/lib/nanote/idb';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { scrollToPage, type PageLayout } from './viewport';

export function FilmstripList({ layouts, thumbVersion }: { layouts: PageLayout[]; thumbVersion: number }) {
  const { t, fmt } = useT();
  const pages = useApp((s) => s.editor.pages);
  const activePageId = useApp((s) => s.editor.activePageId);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const dragRef = useRef<{ id: string; index: number; overIndex: number } | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const entries = await Promise.all(
        layouts.map(async (l) => {
          const rec = await db.getThumb(l.id);
          return [l.id, rec?.dataUrl ?? ''] as const;
        }),
      );
      if (!alive) return;
      setThumbs(Object.fromEntries(entries));
    })();
    return () => { alive = false };
  }, [layouts, thumbVersion]);

  const ordered = [...layouts].sort((a, b) => {
    const pa = pages.find((p) => p.id === a.id)?.pageIndex ?? 0;
    const pb = pages.find((p) => p.id === b.id)?.pageIndex ?? 0;
    return pa - pb;
  });

  const insertAfter = async (index: number) => {
    const st = useApp.getState();
    const nb = st.notebooks.find((n) => n.id === st.editor.notebookId);
    const id = await st.insertPage(index, nb?.defaultTemplate ?? 'blank');
    const layout = layouts.find((l) => l.id === id);
    if (layout) scrollToPage(layout, 0.55);
    toast.success(t('pages.insert'));
  };

  const startDrag = (e: React.PointerEvent, id: string, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { id, index, overIndex: index };
    const item = (e.currentTarget as HTMLElement).closest('[data-thumb]') as HTMLElement;
    item.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const els = [...document.querySelectorAll('[data-thumb-index]')] as HTMLElement[];
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (ev.clientY >= r.top && ev.clientY <= r.bottom) {
          const idx = Number(el.dataset.thumbIndex);
          if (idx !== d.overIndex) {
            d.overIndex = idx;
            el.style.outline = '2px solid #1E6FF2';
          }
        } else {
          el.style.outline = '';
        }
      }
    };
    const onUp = () => {
      const d = dragRef.current;
      dragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.querySelectorAll('[data-thumb-index]').forEach((el) => { (el as HTMLElement).style.outline = '' });
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

  return (
    <div className="flex flex-col gap-2 p-2">
      {ordered.map((l, i) => {
        const page = pages.find((p) => p.id === l.id);
        const isActive = l.id === activePageId;
        return (
          <div
            key={l.id}
            data-thumb
            data-thumb-index={i}
            className={cn(
              'group relative rounded-lg border-2 bg-card p-1 shadow-ink-1 cursor-pointer press-scale',
              isActive ? 'border-primary' : 'border-transparent hover:border-border',
            )}
            onClick={() => scrollToPage(l, 0.35)}
            role="button"
            aria-label={fmt(t('editor.page'), { n: i + 1 })}
          >
            <div
              className="relative w-full overflow-hidden rounded-md bg-white"
              style={{ aspectRatio: `${l.w} / ${l.h}` }}
            >
              {thumbs[l.id] ? (
                <img src={thumbs[l.id]} alt="" className="h-full w-full object-contain" draggable={false} />
              ) : (
                <div className="thumb-skeleton h-full w-full" />
              )}
              {page?.isBookmarked && (
                <span className="absolute end-1 top-1 h-2 w-2 rounded-full bg-warning" aria-label={t('pages.bookmarked')} />
              )}
              <span className="absolute start-1 top-1 rounded bg-black/50 px-1 text-[10px] font-semibold text-white tabular-nums">
                {i + 1}
              </span>
            </div>
            <button
              type="button"
              aria-label={t('pages.reorder')}
              className="absolute end-0.5 top-8 hidden h-7 w-7 items-center justify-center rounded-md bg-card/90 text-muted-foreground shadow-ink-1 group-hover:flex"
              onPointerDown={(e) => startDrag(e, l.id, i)}
            >
              <GripVertical className="h-4 w-4" />
            </button>
            <div className="absolute bottom-1 end-1 hidden group-hover:block">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" aria-label={t('common.more')} className="flex h-7 w-7 items-center justify-center rounded-md bg-card/90 shadow-ink-1">
                    <MoreVertical className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => void insertAfter(i)}>
                    <Plus className="h-4 w-4" /> {t('pages.insertHere')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void useApp.getState().duplicatePage(l.id).then(() => toast.success(t('pages.duplicate')))}>
                    <Copy className="h-4 w-4" /> {t('pages.duplicate')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => {
                      if (pages.length <= 1) { toast.error(t('pages.deleteLast')); return }
                      void useApp.getState().deletePage(l.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4" /> {t('pages.delete')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => void insertAfter(pages.length - 1)}
        className="flex items-center justify-center gap-1 rounded-lg border-2 border-dashed border-border py-3 text-sm font-medium text-muted-foreground hover:border-primary hover:text-primary press-scale"
        aria-label={t('editor.addPage')}
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

export function FilmstripRail({ layouts, thumbVersion }: { layouts: PageLayout[]; thumbVersion: number }) {
  const leftHanded = useApp((s) => s.settings.leftHanded);
  return (
    <aside
      className={cn(
        'absolute top-2 bottom-2 z-20 hidden w-32 overflow-y-auto nanote-scroll rounded-2xl border border-border bg-card/80 backdrop-blur lg:block',
        leftHanded ? 'end-2' : 'start-2',
      )}
      aria-label="Pages"
    >
      <FilmstripList layouts={layouts} thumbVersion={thumbVersion} />
    </aside>
  );
}
