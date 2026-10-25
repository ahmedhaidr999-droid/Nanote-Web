'use client';
// Grid notebook card — 3:4 cover with overlays, title and meta below.
import { MoreVertical, Star } from 'lucide-react';
import { NotebookCover } from '@/components/nanote/NotebookCover';
import { useApp, useT } from '@/lib/nanote/store';
import type { FolderRow, NotebookRow } from '@/lib/nanote/types';
import { fmtRelative } from '@/lib/nanote/util';
import { cn } from '@/lib/utils';
import { NotebookMenu, type NotebookDialogKind } from './NotebookMenu';
import { useImageURL } from './useImageURL';
import { pagesLabel } from './useNotebookActions';

interface NotebookCardProps {
  notebook: NotebookRow;
  folder?: FolderRow | null;
  onDialog: (kind: NotebookDialogKind, notebook: NotebookRow) => void;
}

export function NotebookCard({ notebook, folder, onDialog }: NotebookCardProps) {
  const { t, lang } = useT();
  const pageCount = useApp((s) => s.pageCounts[notebook.id]) ?? 0;
  const imgUrl = useImageURL(notebook.coverCustomId);
  const isFav = notebook.isFavorite;

  const open = () => void useApp.getState().openEditor(notebook.id);

  return (
    <article className="group">
      <div className="relative">
        <button
          type="button"
          onClick={open}
          aria-label={notebook.title}
          className="block w-full rounded-xl text-start press-scale focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
        >
          <NotebookCover
            coverId={notebook.coverId}
            customUrl={imgUrl}
            title={notebook.title}
            className="aspect-[3/4] w-full"
          />
        </button>

        {/* page count chip */}
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-2 start-2 z-10 rounded-full bg-black/45 px-2 py-0.5 text-xs font-medium text-white backdrop-blur-sm"
        >
          {pagesLabel(pageCount, t)}
        </div>

        {/* favorite star */}
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

        {/* context menu */}
        <NotebookMenu notebook={notebook} onDialog={onDialog}>
          <button
            type="button"
            aria-label={t('common.more')}
            className="absolute top-2 start-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-background/85 text-foreground shadow-ink-1 backdrop-blur transition-transform press-scale hover:scale-110 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
        </NotebookMenu>
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
        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="shrink-0">{fmtRelative(notebook.lastOpenedAt, lang)}</span>
          {folder ? (
            <span className="min-w-0 truncate rounded-md bg-surface-variant px-1.5 py-0.5">
              {folder.emoji} {folder.name}
            </span>
          ) : null}
        </span>
      </button>
    </article>
  );
}
