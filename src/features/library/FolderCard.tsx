'use client';
// Folder tile for the content area — grid variant (card) or list variant
// (row / compact row). Clicking navigates INTO the folder in place; a ⋯ menu
// offers rename, move, new subfolder and delete. Supports multi-selection.
import { memo, useState } from 'react';
import {
  Check, ChevronRight, FolderInput, FolderPlus, MoreVertical, Pencil, Trash2,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useT } from '@/lib/nanote/store';
import type { FolderRow } from '@/lib/nanote/types';
import { cn } from '@/lib/utils';
import { useSelectPress } from './useSelectPress';

export interface FolderCardCounts {
  notebooks: number; // direct child notebooks
  folders: number;   // direct child folders
}

export interface FolderCardProps {
  folder: FolderRow;
  counts: FolderCardCounts;
  variant: 'grid' | 'row' | 'compact';
  onOpen: (folder: FolderRow) => void;
  onRename: (folder: FolderRow) => void;
  onMove: (folder: FolderRow) => void;
  onNewChild: (folder: FolderRow) => void;
  onDelete: (folder: FolderRow) => void;
  showDate?: boolean;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
  onLongPressSelect?: (id: string) => void;
}

function FolderCardImpl({
  folder,
  counts,
  variant,
  onOpen,
  onRename,
  onMove,
  onNewChild,
  onDelete,
  showDate = true,
  selectionMode = false,
  selected = false,
  onToggleSelect,
  onLongPressSelect,
}: FolderCardProps) {
  const { t } = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const press = useSelectPress(
    () => onLongPressSelect?.(folder.id),
    !selectionMode && !!onLongPressSelect,
  );

  const open = () => {
    if (press.consumeLongPress()) return;
    if (selectionMode) {
      onToggleSelect?.(folder.id);
      return;
    }
    onOpen(folder);
  };

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
            // always visible — hover-revealed buttons are invisible on touch
            // screens (the ⋯ occupied space and tapped fine but never showed)
            variant === 'grid'
              ? 'absolute top-2 end-2 z-10 h-8 w-8 bg-background/85 shadow-ink-1 backdrop-blur'
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

  const pressHandlers = selectionMode || onLongPressSelect
    ? {
        onPointerDown: press.onPointerDown,
        onPointerMove: press.onPointerMove,
        onPointerUp: press.onPointerUp,
        onPointerCancel: press.onPointerCancel,
        onPointerLeave: press.onPointerLeave,
        onContextMenu: press.onContextMenu,
      }
    : null;

  if (variant === 'row' || variant === 'compact') {
    const compact = variant === 'compact';
    return (
      <li
        className={cn(
          'flex items-center rounded-xl border bg-card shadow-ink-1',
          compact ? 'gap-2.5 px-2.5 py-1.5' : 'gap-3 p-3',
          selected && 'border-primary ring-2 ring-primary',
          '[contain:layout_paint]',
        )}
        style={{ contentVisibility: 'auto', containIntrinsicSize: compact ? '44px' : '76px' }}
      >
        {selectionMode ? (
          <button
            type="button"
            aria-label={selected ? t('common.deselect', 'Deselect', 'إلغاء التحديد') : t('common.select', 'Select', 'تحديد')}
            aria-pressed={selected}
            onClick={() => onToggleSelect?.(folder.id)}
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
          aria-label={folder.name}
          aria-pressed={selectionMode ? selected : undefined}
          {...pressHandlers}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-start focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
        >
          <span
            aria-hidden
            className={cn(
              'flex shrink-0 items-center justify-center rounded-md text-lg',
              compact ? 'h-9 w-9' : 'aspect-[3/4] w-12',
            )}
            style={{ background: `${folder.colorHex}1F` }}
          >
            {folder.emoji}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-foreground">{folder.name}</span>
            {(showDate || !compact) && (
              <span className="mt-0.5 block text-xs text-muted-foreground">
                <FolderMeta counts={counts} t={t} />
              </span>
            )}
          </span>
        </button>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden />
        {!selectionMode ? menu : null}
      </li>
    );
  }

  return (
    <div
      className={cn(
        'group relative rounded-xl border bg-card shadow-ink-1 transition-colors hover:border-primary/40',
        selected && 'border-primary ring-2 ring-primary',
        '[contain:layout_paint]',
      )}
    >
      <button
        type="button"
        onClick={open}
        aria-label={folder.name}
        aria-pressed={selectionMode ? selected : undefined}
        {...pressHandlers}
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
      {selectionMode ? (
        <button
          type="button"
          aria-label={selected ? t('common.deselect', 'Deselect', 'إلغاء التحديد') : t('common.select', 'Select', 'تحديد')}
          aria-pressed={selected}
          onClick={() => onToggleSelect?.(folder.id)}
          className={cn(
            'absolute top-2 end-2 z-10 flex h-8 w-8 items-center justify-center rounded-full shadow-ink-1 backdrop-blur transition-colors press-scale focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring',
            selected ? 'bg-primary text-primary-foreground' : 'bg-background/85 text-foreground',
          )}
        >
          <Check className="h-4 w-4" aria-hidden />
        </button>
      ) : (
        menu
      )}
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

export const FolderCard = memo(FolderCardImpl);
