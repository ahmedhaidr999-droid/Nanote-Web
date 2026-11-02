'use client';
// List rows for the library — 'list' (detailed: thumb + title + meta + tags)
// and 'compact' (dense single-line, more files per screen). Selection support
// (long-press or explicit mode), optional dates/info per view settings.
// PERF: memoized; contentVisibility keeps long lists cheap to scroll.
import { memo } from 'react';
import { Check, FileText, MoreVertical, Star } from 'lucide-react';
import { NotebookCover } from '@/components/nanote/NotebookCover';
import { useApp, useT } from '@/lib/nanote/store';
import type { FolderRow, NotebookRow, TagRow } from '@/lib/nanote/types';
import { fmtRelative } from '@/lib/nanote/util';
import { cn } from '@/lib/utils';
import { NotebookMenu, type NotebookDialogKind } from './NotebookMenu';
import { useImageURL } from './useImageURL';
import { pagesLabel } from './useNotebookActions';
import { useSelectPress } from './useSelectPress';

export interface NotebookListRowProps {
  notebook: NotebookRow;
  folder?: FolderRow | null;
  tagsById: Map<string, TagRow>;
  onDialog: (kind: NotebookDialogKind, notebook: NotebookRow) => void;
  /** 'list' = detailed row; 'compact' = dense single-line row */
  variant?: 'list' | 'compact';
  isPdf?: boolean;
  showDate?: boolean;
  showInfo?: boolean;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
  onLongPressSelect?: (id: string) => void;
}

function NotebookListRowImpl({
  notebook,
  folder,
  tagsById,
  onDialog,
  variant = 'list',
  isPdf = false,
  showDate = true,
  showInfo = true,
  selectionMode = false,
  selected = false,
  onToggleSelect,
  onLongPressSelect,
}: NotebookListRowProps) {
  const { t, lang } = useT();
  const pageCount = useApp((s) => s.pageCounts[notebook.id]) ?? 0;
  const imgUrl = useImageURL(notebook.coverCustomId);
  const compact = variant === 'compact';
  const press = useSelectPress(
    () => onLongPressSelect?.(notebook.id),
    !selectionMode && !!onLongPressSelect,
  );

  const tagList = notebook.tagIds
    .map((id) => tagsById.get(id))
    .filter((tg): tg is TagRow => !!tg)
    .slice(0, 3);

  const open = () => {
    if (press.consumeLongPress()) return;
    if (selectionMode) {
      onToggleSelect?.(notebook.id);
      return;
    }
    void useApp.getState().openEditor(notebook.id);
  };

  return (
    <li
      className={cn(
        'flex items-center rounded-xl border bg-card shadow-ink-1 transition-colors',
        compact ? 'gap-2.5 px-2.5 py-1.5' : 'gap-3 p-3',
        selected && 'border-primary ring-2 ring-primary',
        '[contain:layout_paint]',
      )}
      style={{ contentVisibility: 'auto', containIntrinsicSize: compact ? '44px' : '76px' }}
    >
      {/* selection checkbox */}
      {selectionMode ? (
        <button
          type="button"
          aria-label={selected ? t('common.deselect', 'Deselect', 'إلغاء التحديد') : t('common.select', 'Select', 'تحديد')}
          aria-pressed={selected}
          onClick={() => onToggleSelect?.(notebook.id)}
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors press-scale focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring',
            selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-transparent',
          )}
        >
          <Check className="h-4 w-4" aria-hidden />
        </button>
      ) : null}

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
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-start focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
      >
        <NotebookCover
          coverId={notebook.coverId}
          customUrl={imgUrl}
          className={cn('aspect-[3/4] shrink-0 rounded-lg', compact ? 'w-8' : 'w-14')}
        />
        <span className="min-w-0 flex-1">
          <span className={cn('flex items-center gap-1.5', compact ? '' : 'block truncate')}>
            <span className={cn('min-w-0 truncate text-foreground', compact ? 'text-sm font-medium' : 'text-sm font-semibold')}>
              {notebook.title}
            </span>
            {isPdf && showInfo ? (
              <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
                <FileText className="h-2.5 w-2.5" aria-hidden /> PDF
              </span>
            ) : null}
            {!compact && !selectionMode && notebook.isFavorite ? (
              <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" aria-label={t('library.tab.favorites')} />
            ) : null}
          </span>
          {showDate || showInfo ? (
            <span className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground', compact ? 'mt-0.5' : 'mt-1')}>
              {showInfo ? (
                <span className="shrink-0">{pagesLabel(pageCount, t)}</span>
              ) : null}
              {showInfo && showDate ? <span aria-hidden>·</span> : null}
              {showDate ? <span className="shrink-0">{fmtRelative(notebook.lastOpenedAt, lang)}</span> : null}
              {!compact && showInfo && folder ? (
                <span className="min-w-0 truncate rounded-md bg-surface-variant px-1.5 py-0.5">
                  {folder.emoji} {folder.name}
                </span>
              ) : null}
            </span>
          ) : null}
          {!compact && tagList.length > 0 ? (
            <span className="mt-1.5 flex flex-wrap items-center gap-1">
              {tagList.map((tg) => (
                <span
                  key={tg.id}
                  className="flex items-center gap-1 rounded-full bg-surface-variant px-1.5 py-0.5 text-xs text-muted-foreground"
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: tg.colorHex }} aria-hidden />
                  {tg.name}
                </span>
              ))}
            </span>
          ) : null}
        </span>
      </button>

      {selectionMode ? (
        <span className="flex items-center gap-1.5 pe-1">
          <button
            type="button"
            aria-label={notebook.isFavorite ? t('library.unfavorite') : t('library.favorite')}
            onClick={() => void useApp.getState().toggleFavoriteNotebook(notebook.id)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors press-scale hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
          >
            <Star className={cn('h-4 w-4', notebook.isFavorite && 'fill-amber-400 text-amber-400')} />
          </button>
        </span>
      ) : (
        <NotebookMenu notebook={notebook} onDialog={onDialog}>
          <button
            type="button"
            aria-label={t('common.more')}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors press-scale hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
        </NotebookMenu>
      )}
    </li>
  );
}

export const NotebookListRow = memo(NotebookListRowImpl);
