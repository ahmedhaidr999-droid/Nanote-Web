'use client';
// Trash tab — trashed notebooks and top-most trashed folders with
// restore / delete-permanently actions (confirm dialog for the latter).
import { useMemo, useState } from 'react';
import { Info, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/nanote/EmptyState';
import { NotebookCover } from '@/components/nanote/NotebookCover';
import { useApp, useT } from '@/lib/nanote/store';
import type { FolderRow, NotebookRow } from '@/lib/nanote/types';
import { fmtDate } from '@/lib/nanote/util';
import { ConfirmDialog } from './ConfirmDialog';
import { useImageURL } from './useImageURL';
import { useNotebookActions } from './useNotebookActions';

export function TrashList() {
  const { t, lang, fmt } = useT();
  const notebooks = useApp((s) => s.notebooks);
  const folders = useApp((s) => s.folders);
  const actions = useNotebookActions();

  const [purgeNb, setPurgeNb] = useState<NotebookRow | null>(null);
  const [purgeFolder, setPurgeFolder] = useState<FolderRow | null>(null);

  const trashedNotebooks = useMemo(
    () =>
      notebooks
        .filter((n) => n.deletedAt != null)
        .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0)),
    [notebooks],
  );

  // a whole folder subtree is trashed together — only surface top-most folders
  const trashedFolders = useMemo(
    () =>
      folders
        .filter(
          (f) =>
            f.deletedAt != null &&
            (f.parentId == null || (folders.find((p) => p.id === f.parentId)?.deletedAt ?? null) == null),
        )
        .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0)),
    [folders],
  );

  if (trashedNotebooks.length + trashedFolders.length === 0) {
    return <EmptyState icon={Trash2} title={t('library.empty.trash')} hint={t('library.trashHint')} />;
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-2 rounded-lg bg-surface-variant/70 px-3 py-2 text-sm text-muted-foreground">
        <Info className="h-4 w-4 shrink-0" aria-hidden />
        {t('library.trashHint')}
      </div>

      <section aria-label={t('library.notebooks', 'Notebooks', 'الدفاتر')} className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
          {t('library.notebooks', 'Notebooks', 'الدفاتر')}
        </h2>
        <ul className="flex flex-col gap-2">
          {trashedNotebooks.map((nb) => (
            <TrashNotebookItem
              key={nb.id}
              notebook={nb}
              lang={lang}
              onRestore={() => void actions.restoreNotebook(nb.id)}
              onPurge={() => setPurgeNb(nb)}
            />
          ))}
        </ul>
      </section>

      <section aria-label={t('library.folders')}>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{t('library.folders')}</h2>
        <ul className="flex flex-col gap-2">
          {trashedFolders.map((f) => (
            <TrashFolderItem
              key={f.id}
              folder={f}
              lang={lang}
              onRestore={() => void actions.restoreFolder(f.id)}
              onPurge={() => setPurgeFolder(f)}
            />
          ))}
        </ul>
      </section>

      <ConfirmDialog
        open={!!purgeNb}
        onOpenChange={(o) => {
          if (!o) setPurgeNb(null);
        }}
        title={t('common.deletePermanent')}
        description={
          purgeNb
            ? fmt(
                t(
                  'library.deleteNotebook.confirm',
                  '“{name}” will be deleted permanently. This cannot be undone.',
                  'سيُحذف «{name}» نهائيًا. لا يمكن التراجع عن هذا الإجراء.',
                ),
                { name: purgeNb.title },
              )
            : undefined
        }
        confirmLabel={t('common.deletePermanent')}
        destructive
        onConfirm={async () => {
          if (!purgeNb) return;
          await actions.purgeNotebook(purgeNb.id);
        }}
      />

      <ConfirmDialog
        open={!!purgeFolder}
        onOpenChange={(o) => {
          if (!o) setPurgeFolder(null);
        }}
        title={t('common.deletePermanent')}
        description={
          purgeFolder
            ? fmt(
                t(
                  'library.purgeFolder.confirm',
                  '“{name}” and everything inside it will be deleted permanently.',
                  'سيُحذف «{name}» وكل محتواه نهائيًا.',
                ),
                { name: purgeFolder.name },
              )
            : undefined
        }
        confirmLabel={t('common.deletePermanent')}
        destructive
        onConfirm={async () => {
          if (!purgeFolder) return;
          await actions.purgeFolder(purgeFolder.id);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------- items

function TrashNotebookItem({
  notebook,
  lang,
  onRestore,
  onPurge,
}: {
  notebook: NotebookRow;
  lang: 'en' | 'ar';
  onRestore: () => void;
  onPurge: () => void;
}) {
  const { t } = useT();
  const imgUrl = useImageURL(notebook.coverCustomId);
  return (
    <li className="flex items-center gap-3 rounded-xl border bg-card p-3 shadow-ink-1">
      <NotebookCover
        coverId={notebook.coverId}
        customUrl={imgUrl}
        className="aspect-[3/4] w-12 shrink-0 rounded-md"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{notebook.title}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{fmtDate(notebook.deletedAt ?? 0, lang)}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="outline" size="sm" onClick={onRestore} className="press-scale">
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          <span className="hidden sm:inline">{t('common.restore')}</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onPurge}
          className="press-scale border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
          <span className="hidden sm:inline">{t('common.deletePermanent')}</span>
        </Button>
      </div>
    </li>
  );
}

function TrashFolderItem({
  folder,
  lang,
  onRestore,
  onPurge,
}: {
  folder: FolderRow;
  lang: 'en' | 'ar';
  onRestore: () => void;
  onPurge: () => void;
}) {
  const { t } = useT();
  return (
    <li className="flex items-center gap-3 rounded-xl border bg-card p-3 shadow-ink-1">
      <div
        className="flex aspect-[3/4] w-12 shrink-0 items-center justify-center rounded-md bg-surface-variant text-lg"
        aria-hidden
      >
        {folder.emoji}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{folder.name}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{fmtDate(folder.deletedAt ?? 0, lang)}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="outline" size="sm" onClick={onRestore} className="press-scale">
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          <span className="hidden sm:inline">{t('common.restore')}</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onPurge}
          className="press-scale border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
          <span className="hidden sm:inline">{t('common.deletePermanent')}</span>
        </Button>
      </div>
    </li>
  );
}
