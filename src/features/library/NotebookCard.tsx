'use client';
// Grid / Large-Thumbnail notebook card — 3:4 cover or first-page CONTENT preview
// (lazy, cached — notebookPreview.ts), overlays for page count / PDF / favorite,
// selection support (long-press or explicit mode), title + optional meta below.
// PERF: memoized — the library re-renders on every store tick; cards must not.
import { memo } from 'react';
import { Check, FileText, MoreVertical, Star } from 'lucide-react';
import { NotebookCover } from '@/components/nanote/NotebookCover';
import { useApp, useT } from '@/lib/nanote/store';
import type { FolderRow, NotebookRow } from '@/lib/nanote/types';
import { fmtRelative } from '@/lib/nanote/util';
import { cn } from '@/lib/utils';
import { NotebookMenu, type NotebookDialogKind } from './NotebookMenu';
import { useImageURL } from './useImageURL';
import { pagesLabel } from './useNotebookActions';
import { useNotebookPreview } from './notebookPreview';
import { useSelectPress } from './useSelectPress';

export interface NotebookCardProps {
  notebook: NotebookRow;
  folder?: FolderRow | null;
  onDialog: (kind: NotebookDialogKind, notebook: NotebookRow) => void;
  /** 'grid' = classic cover card; 'preview' = large content preview hero */
  variant?: 'grid' | 'preview';
  /** show the first-page content render instead of cover art (grid mode pref) */
  preferPreview?: boolean;
  isPdf?: boolean;
  showDate?: boolean;
  showInfo?: boolean;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
  onLongPressSelect?: (id: string) => void;
}

function NotebookCardImpl({
  notebook,
  folder,
  onDialog,
  variant = 'grid',
  preferPreview = false,
  isPdf = false,
  showDate = true,
  showInfo = true,
  selectionMode = false,
  selected = false,
  onToggleSelect,
  onLongPressSelect,
}: NotebookCardProps) {
  const { t, lang } = useT();
  const pageCount = useApp((s) => s.pageCounts[notebook.id]) ?? 0;
  const imgUrl = useImageURL(notebook.coverCustomId);
  const isFav = notebook.isFavorite;
  const wantPreview = variant === 'preview' || preferPreview;
  const { setEl, previewUrl } = useNotebookPreview(notebook, wantPreview);
  const press = useSelectPress(
    () => onLongPressSelect?.(notebook.id),
    !selectionMode && !!onLongPressSelect,
  );

  const open = () => {
    if (press.consumeLongPress()) return;
    if (selectionMode) {
      onToggleSelect?.(notebook.id);
      return;
    }
    void useApp.getState().openEditor(notebook.id);
  };

  const showPreviewImg = wantPreview && !!previewUrl;

  return (
    <article
      ref={setEl}
      className={cn(
        'group relative rounded-xl transition-colors',
        '[contain:layout_paint]',
        selected && 'ring-2 ring-primary',
      )}
      style={{ contentVisibility: 'auto', containIntrinsicSize: '260px' }}
    >
      <div className="relative">
        <button
          type="button"
          onClick={open}
          aria-label={notebook.title}
          aria-pressed={selectionMode ? selected : undefined}
          {...(selectionMode || onLongPressSelect
            ? {
                onPointerDown: press.onPointerDown,
                onPointerMove: press.onPointerMove,
                onPointerUp: press.onPointerUp,
                onPointerCancel: press.onPointerCancel,
                onPointerLeave: press.onPointerLeave,
                onContextMenu: press.onContextMenu,
              }
            : null)}
          className="block w-full rounded-xl text-start press-scale focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
        >
          {showPreviewImg ? (
            <div className="relative aspect-[3/4] w-full overflow-hidden rounded-xl bg-surface-variant/50 shadow-ink-1">
              <img
                src={previewUrl as string}
                alt=""
                loading="lazy"
                draggable={false}
                className="h-full w-full object-contain"
              />
              {/* subtle paper edge so white pages don't melt into the card bg */}
              <div className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-black/[0.06]" aria-hidden />
            </div>
          ) : wantPreview ? (
            // preview wanted but still rendering — cover art holds the spot
            <NotebookCover
              coverId={notebook.coverId}
              customUrl={imgUrl}
              title={notebook.title}
              className="aspect-[3/4] w-full"
            />
          ) : (
            <NotebookCover
              coverId={notebook.coverId}
              customUrl={imgUrl}
              title={notebook.title}
              className="aspect-[3/4] w-full"
            />
          )}
        </button>

        {/* page count chip */}
        {showInfo ? (
          <div
            aria-hidden
            className="pointer-events-none absolute bottom-2 start-2 z-10 rounded-full bg-black/45 px-2 py-0.5 text-xs font-medium text-white backdrop-blur-sm"
          >
            {pagesLabel(pageCount, t)}
          </div>
        ) : null}

        {/* PDF badge */}
        {isPdf && showInfo ? (
          <div
            aria-hidden
            className="pointer-events-none absolute bottom-2 end-2 z-10 flex items-center gap-1 rounded-full bg-destructive/85 px-2 py-0.5 text-xs font-semibold text-white backdrop-blur-sm"
          >
            <FileText className="h-3 w-3" /> PDF
          </div>
        ) : null}

        {/* selection checkbox / favorite star */}
        {selectionMode ? (
          <button
            type="button"
            aria-label={selected ? t('common.deselect', 'Deselect', 'إلغاء التحديد') : t('common.select', 'Select', 'تحديد')}
            aria-pressed={selected}
            onClick={() => onToggleSelect?.(notebook.id)}
            className={cn(
              'absolute top-2 end-2 z-10 flex h-8 w-8 items-center justify-center rounded-full shadow-ink-1 backdrop-blur transition-colors press-scale focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring',
              selected ? 'bg-primary text-primary-foreground' : 'bg-background/85 text-foreground',
            )}
          >
            <Check className="h-4 w-4" aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            aria-label={isFav ? t('library.unfavorite') : t('library.favorite')}
            aria-pressed={isFav}
            onClick={() => void useApp.getState().toggleFavoriteNotebook(notebook.id)}
            className="absolute top-2 end-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-background/85 text-foreground shadow-ink-1 backdrop-blur transition-transform press-scale hover:scale-110 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
          >
            <Star
              className={cn('h-4 w-4', isFav ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground')}
            />
          </button>
        )}

        {/* context menu (hidden while selecting) */}
        {!selectionMode ? (
          <NotebookMenu notebook={notebook} onDialog={onDialog}>
            <button
              type="button"
              aria-label={t('common.more')}
              className="absolute top-2 start-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-background/85 text-foreground shadow-ink-1 backdrop-blur transition-transform press-scale hover:scale-110 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </NotebookMenu>
        ) : null}
      </div>

      <button
        type="button"
        onClick={open}
        aria-hidden
        tabIndex={-1}
        className="mt-2 block w-full px-0.5 text-start focus-visible:outline-none"
      >
        <span className="sr-only">{notebook.title}</span>
        <span className="line-clamp-1 block text-sm font-semibold text-foreground">{notebook.title}</span>
        {(showDate || showInfo) && (
          <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            {showDate ? <span className="shrink-0">{fmtRelative(notebook.lastOpenedAt, lang)}</span> : null}
            {showInfo && folder ? (
              <span className="min-w-0 truncate rounded-md bg-surface-variant px-1.5 py-0.5">
                {folder.emoji} {folder.name}
              </span>
            ) : null}
          </span>
        )}
      </button>
    </article>
  );
}

// PERF: memoized — EditorShell/library state ticks must not re-run thousands
// of card render functions for nothing.
export const NotebookCard = memo(NotebookCardImpl);
