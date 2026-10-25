'use client';
// Compact list row for the "list" library view.
import { MoreVertical } from 'lucide-react';
import { NotebookCover } from '@/components/nanote/NotebookCover';
import { useApp, useT } from '@/lib/nanote/store';
import type { FolderRow, NotebookRow, TagRow } from '@/lib/nanote/types';
import { fmtRelative } from '@/lib/nanote/util';
import { NotebookMenu, type NotebookDialogKind } from './NotebookMenu';
import { useImageURL } from './useImageURL';
import { pagesLabel } from './useNotebookActions';

interface NotebookListRowProps {
  notebook: NotebookRow;
  folder?: FolderRow | null;
  tagsById: Map<string, TagRow>;
  onDialog: (kind: NotebookDialogKind, notebook: NotebookRow) => void;
}

export function NotebookListRow({ notebook, folder, tagsById, onDialog }: NotebookListRowProps) {
  const { t, lang } = useT();
  const pageCount = useApp((s) => s.pageCounts[notebook.id]) ?? 0;
  const imgUrl = useImageURL(notebook.coverCustomId);
  const tagList = notebook.tagIds
    .map((id) => tagsById.get(id))
    .filter((tg): tg is TagRow => !!tg)
    .slice(0, 3);

  return (
    <li className="flex items-center gap-3 rounded-xl border bg-card p-3 shadow-ink-1">
      <button
        type="button"
        onClick={() => void useApp.getState().openEditor(notebook.id)}
        aria-label={notebook.title}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-start focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
      >
        <NotebookCover
          coverId={notebook.coverId}
          customUrl={imgUrl}
          className="aspect-[3/4] w-14 shrink-0 rounded-lg"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-foreground">{notebook.title}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="shrink-0">{pagesLabel(pageCount, t)}</span>
            <span aria-hidden>·</span>
            <span className="shrink-0">{fmtRelative(notebook.lastOpenedAt, lang)}</span>
            {folder ? (
              <span className="min-w-0 truncate rounded-md bg-surface-variant px-1.5 py-0.5">
                {folder.emoji} {folder.name}
              </span>
            ) : null}
          </span>
          {tagList.length > 0 ? (
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

      <NotebookMenu notebook={notebook} onDialog={onDialog}>
        <button
          type="button"
          aria-label={t('common.more')}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors press-scale hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
        >
          <MoreVertical className="h-4 w-4" />
        </button>
      </NotebookMenu>
    </li>
  );
}
