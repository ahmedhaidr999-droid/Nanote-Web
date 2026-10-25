'use client';
// Shared context menu for a notebook — used by grid cards and list rows.
import type { ReactNode } from 'react';
import {
  BookOpen, Copy, FileDown, FolderInput, Pencil, Star, Tags, Trash2,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useT } from '@/lib/nanote/store';
import type { NotebookRow } from '@/lib/nanote/types';
import { useNotebookActions } from './useNotebookActions';

export type NotebookDialogKind = 'rename' | 'move' | 'tags';

interface NotebookMenuProps {
  notebook: NotebookRow;
  onDialog: (kind: NotebookDialogKind, notebook: NotebookRow) => void;
  children: ReactNode; // trigger element
}

export function NotebookMenu({ notebook, onDialog, children }: NotebookMenuProps) {
  const { t } = useT();
  const actions = useNotebookActions();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem onClick={() => actions.open(notebook.id)}>
          <BookOpen aria-hidden /> {t('common.open')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onDialog('rename', notebook)}>
          <Pencil aria-hidden /> {t('common.rename')}…
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void actions.duplicate(notebook.id)}>
          <Copy aria-hidden /> {t('common.duplicate')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onDialog('move', notebook)}>
          <FolderInput aria-hidden /> {t('library.moveTo')}…
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => actions.toggleFavorite(notebook.id)}>
          <Star aria-hidden />{' '}
          {notebook.isFavorite ? t('library.unfavorite') : t('library.favorite')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onDialog('tags', notebook)}>
          <Tags aria-hidden /> {t('library.tags')}…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void actions.exportPdf(notebook.id)}>
          <FileDown aria-hidden /> {t('library.context.exportPdf')}
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-destructive focus:bg-destructive/10 focus:text-destructive"
          onClick={() => void actions.trash(notebook.id)}
        >
          <Trash2 aria-hidden /> {t('library.context.delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
