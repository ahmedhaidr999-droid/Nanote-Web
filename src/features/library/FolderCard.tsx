'use client';
// Folder tile for the content area — grid variant (card) or list variant
// (row). Clicking navigates INTO the folder in place; a ⋯ menu offers rename,
// move, new subfolder and delete.
import { useState } from 'react';
import {
  ChevronRight, FolderInput, FolderPlus, MoreVertical, Pencil, Trash2,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useT } from '@/lib/nanote/store';
import type { FolderRow } from '@/lib/nanote/types';
import { cn } from '@/lib/utils';

export interface FolderCardCounts {
  notebooks: number; // direct child notebooks
  folders: number;   // direct child folders
}

interface FolderCardProps {
  folder: FolderRow;
  counts: FolderCardCounts;
  variant: 'grid' | 'row';
  onOpen: (folder: FolderRow) => void;
  onRename: (folder: FolderRow) => void;
  onMove: (folder: FolderRow) => void;
  onNewChild: (folder: FolderRow) => void;
  onDelete: (folder: FolderRow) => void;
}

export function FolderCard({
  folder,
  counts,
  variant,
  onOpen,
  onRename,
  onMove,
  onNewChild,
  onDelete,
}: FolderCardProps) {
  const { t } = useT();
  const [menuOpen, setMenuOpen] = useState(false);

  const menu = (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('common.more')}
          aria-haspopup="menu"
          onClick={() => setMenuOpen(true)}
          className={cn(
            'flex items-center justify-center rounded-full text-muted-foreground transition-colors press-scale',
            'hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring',
            variant === 'grid'
              ? 'absolute top-2 end-2 z-10 h-8 w-8 bg-background/85 opacity-0 shadow-ink-1 backdrop-blur group-hover:opacity-100 focus-visible:opacity-100'
              : 'h-9 w-9 shrink-0',
          )}
        >
          <MoreVertical className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuItem onClick={() => onOpen(folder)}>
          <span aria-hidden>{folder.emoji}</span> {t('common.open')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onNewChild(folder)}>
          <FolderPlus aria-hidden /> {t('library.newSubfolder', 'New folder here', 'مجلد جديد هنا')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onRename(folder)}>
          <Pencil aria-hidden /> {t('library.renameFolder')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onMove(folder)}>
          <FolderInput aria-hidden /> {t('common.move')}…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:bg-destructive/10 focus:text-destructive"
          onClick={() => onDelete(folder)}
        >
          <Trash2 aria-hidden /> {t('library.deleteFolder')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (variant === 'row') {
    return (
      <li className="flex items-center gap-3 rounded-xl border bg-card p-3 shadow-ink-1">
        <button
          type="button"
          onClick={() => onOpen(folder)}
          aria-label={folder.name}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-start focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
        >
          <span
            aria-hidden
            className="flex aspect-[3/4] w-12 shrink-0 items-center justify-center rounded-md bg-surface-variant text-lg"
          >
            {folder.emoji}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-foreground">{folder.name}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              <FolderMeta counts={counts} t={t} />
            </span>
          </span>
        </button>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden />
        {menu}
      </li>
    );
  }

  return (
    <div className="group relative rounded-xl border bg-card shadow-ink-1 transition-colors hover:border-primary/40">
      <button
        type="button"
        onClick={() => onOpen(folder)}
        aria-label={folder.name}
        className="flex w-full flex-col gap-2 rounded-xl p-4 text-start transition-transform press-scale focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
      >
        <span
          aria-hidden
          className="flex h-11 w-11 items-center justify-center rounded-xl text-xl"
          style={{ background: `${folder.colorHex}1F` }}
        >
          {folder.emoji}
        </span>
        <span className="flex min-w-0 items-center gap-1">
          <span className="min-w-0 truncate text-sm font-semibold text-foreground">{folder.name}</span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden />
        </span>
        <span className="text-xs text-muted-foreground">
          <FolderMeta counts={counts} t={t} />
        </span>
      </button>
      {menu}
    </div>
  );
}

function FolderMeta({ counts, t }: { counts: FolderCardCounts; t: ReturnType<typeof useT>['t'] }) {
  if (counts.notebooks === 0 && counts.folders === 0) {
    return <>{t('library.emptyFolderMeta', 'Empty', 'فارغ')}</>;
  }
  const parts: string[] = [];
  if (counts.notebooks > 0) {
    parts.push(
      `${counts.notebooks} ${counts.notebooks === 1 ? t('library.notebookOne', 'notebook', 'دفتر') : t('library.notebookCount', 'notebooks', 'دفاتر')}`,
    );
  }
  if (counts.folders > 0) {
    parts.push(
      `${counts.folders} ${counts.folders === 1 ? t('library.folderOne', 'folder', 'مجلد') : t('library.folderCountN', 'folders', 'مجلدات')}`,
    );
  }
  return <>{parts.join(' · ')}</>;
}
