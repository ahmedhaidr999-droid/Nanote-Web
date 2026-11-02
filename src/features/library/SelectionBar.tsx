'use client';
// Multi-selection action bar — replaces the library toolbar while items are
// selected. Batch favorite (smart toggle), batch move (tab/folder picker) and
// batch trash (with confirmation). Folders participate too; favorite applies
// to notebooks only.
import { useState } from 'react';
import { toast } from 'sonner';
import { CheckSquare, FolderInput, Star, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useApp, useT } from '@/lib/nanote/store';
import { cn } from '@/lib/utils';
import { BatchMoveDialog } from './BatchMoveDialog';

export function SelectionBar({
  nbIds,
  folderIds,
  onExit,
  onSelectAll,
  onDelete,
  totalSelectable,
}: {
  nbIds: string[];
  folderIds: string[];
  onExit: () => void;
  onSelectAll: () => void;
  /** opens the batch-delete confirmation (owned by LibraryView) */
  onDelete: () => void;
  totalSelectable: number;
}) {
  const { t, fmt } = useT();
  const [moveOpen, setMoveOpen] = useState(false);
  const count = nbIds.length + folderIds.length;

  const notebooks = useApp((s) => s.notebooks);
  const allFav =
    nbIds.length > 0 &&
    nbIds.every((id) => notebooks.find((n) => n.id === id)?.isFavorite === true);

  const favorite = async () => {
    try {
      await useApp.getState().setNotebooksFavorite(nbIds, !allFav);
      toast.success(
        allFav
          ? t('library.select.unfavorited', 'Removed from favorites', 'أُزيل من المفضلة')
          : t('library.select.favorited', 'Added to favorites', 'أُضيف إلى المفضلة'),
      );
    } catch {
      toast.error(t('error.generic'));
    }
  };

  return (
    <>
      <div
        role="toolbar"
        aria-label={t('library.select.title', 'Selection', 'التحديد')}
        className="sticky top-14 z-30 flex flex-wrap items-center gap-1.5 border-b bg-primary/[0.04] px-2 py-2 backdrop-blur sm:px-4"
      >
        <span className="flex items-center gap-2 pe-2 text-sm font-bold tabular-nums" aria-live="polite">
          {fmt(t('library.select.selected', '{count} selected', 'تم تحديد {count}'), { count })}
        </span>

        <Button
          variant="ghost"
          size="sm"
          onClick={onSelectAll}
          disabled={count >= totalSelectable}
          className="press-scale gap-1.5"
        >
          <CheckSquare className="h-4 w-4" aria-hidden />
          {t('library.select.all', 'Select all', 'تحديد الكل')}
        </Button>

        <span className="flex-1" aria-hidden />

        {nbIds.length > 0 ? (
          <>
            <Button variant="ghost" size="sm" onClick={() => void favorite()} className="press-scale gap-1.5">
              <Star className={cn('h-4 w-4', allFav && 'fill-amber-400 text-amber-400')} aria-hidden />
              {allFav
                ? t('library.select.unfavorite', 'Unfavorite', 'إلغاء التفضيل')
                : t('library.select.favorite', 'Favorite', 'تفضيل')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setMoveOpen(true)} className="press-scale gap-1.5">
              <FolderInput className="h-4 w-4" aria-hidden />
              {t('common.move')}
            </Button>
          </>
        ) : null}

        {count > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            className="press-scale gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            {t('common.delete')}
          </Button>
        ) : null}

        <Button variant="outline" size="sm" onClick={onExit} className="press-scale gap-1.5">
          <X className="h-4 w-4" aria-hidden />
          {t('library.select.exit', 'Done', 'تم')}
        </Button>
      </div>

      <BatchMoveDialog open={moveOpen} onOpenChange={setMoveOpen} nbIds={nbIds} onDone={onExit} />
    </>
  );
}
