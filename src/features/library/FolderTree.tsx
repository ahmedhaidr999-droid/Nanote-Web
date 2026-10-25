'use client';
// Desktop (lg:) sidebar folder tree — recursive, with per-row ⋯ menu and
// right-click support. Mobile uses FolderChipRow instead.
import { useMemo, useState, type ReactNode } from 'react';
import { FolderPlus, LayoutGrid, MoreVertical, Pencil, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useApp, useT } from '@/lib/nanote/store';
import type { FolderRow } from '@/lib/nanote/types';
import { cn } from '@/lib/utils';
import { buildChildrenMap, notebookCountsByFolder } from './folderUtils';

interface FolderTreeProps {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onNewFolder: (parentId: string | null) => void;
  onRename: (folder: FolderRow) => void;
  onDelete: (folder: FolderRow) => void;
}

export function FolderTree({ selectedId, onSelect, onNewFolder, onRename, onDelete }: FolderTreeProps) {
  const { t } = useT();
  const folders = useApp((s) => s.folders);
  const notebooks = useApp((s) => s.notebooks);

  const liveFolders = useMemo(() => folders.filter((f) => f.deletedAt == null), [folders]);
  const childrenMap = useMemo(() => buildChildrenMap(liveFolders), [liveFolders]);
  const liveNotebooks = useMemo(() => notebooks.filter((n) => n.deletedAt == null), [notebooks]);
  const counts = useMemo(() => notebookCountsByFolder(liveNotebooks), [liveNotebooks]);

  const renderList = (parentId: string | null, depth: number, visited: Set<string>): ReactNode =>
    (childrenMap.get(parentId) ?? []).map((f) => {
      if (visited.has(f.id)) return null;
      const next = new Set(visited);
      next.add(f.id);
      return (
        <div key={f.id} className="flex flex-col">
          <FolderTreeRow
            folder={f}
            depth={depth}
            count={counts[f.id] ?? 0}
            selected={selectedId === f.id}
            onSelect={onSelect}
            onRename={onRename}
            onDelete={onDelete}
            onNewChild={onNewFolder}
          />
          {renderList(f.id, depth + 1, next)}
        </div>
      );
    });

  return (
    <div className="flex flex-col">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t('library.folders')}
      </div>

      <button
        type="button"
        onClick={() => onSelect(null)}
        aria-current={!selectedId || undefined}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-start text-sm font-medium transition-colors press-scale',
          !selectedId ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
        )}
      >
        <LayoutGrid className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{t('library.allFolders')}</span>
        <Badge variant="secondary" className="rounded-full px-2 text-xs font-medium tabular-nums">
          {liveNotebooks.length}
        </Badge>
      </button>

      <div className="mt-0.5 flex flex-col">{renderList(null, 0, new Set())}</div>

      <button
        type="button"
        onClick={() => onNewFolder(null)}
        className="mt-3 flex items-center gap-2 rounded-lg border border-dashed px-2.5 py-2 text-sm text-muted-foreground transition-colors press-scale hover:bg-accent/60 hover:text-foreground"
      >
        <FolderPlus className="h-4 w-4 shrink-0" aria-hidden />
        <span className="truncate">{t('library.newFolder')}</span>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- row

interface FolderTreeRowProps {
  folder: FolderRow;
  depth: number;
  count: number;
  selected: boolean;
  onSelect: (id: string | null) => void;
  onRename: (folder: FolderRow) => void;
  onDelete: (folder: FolderRow) => void;
  onNewChild: (parentId: string | null) => void;
}

function FolderTreeRow({ folder, depth, count, selected, onSelect, onRename, onDelete, onNewChild }: FolderTreeRowProps) {
  const { t } = useT();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      className={cn(
        'group/row flex items-center rounded-lg transition-colors',
        selected ? 'bg-accent' : 'hover:bg-accent/60',
      )}
      style={{ paddingInlineStart: depth * 12 + 8 }}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuOpen(true);
      }}
    >
      <button
        type="button"
        onClick={() => onSelect(folder.id)}
        aria-current={selected || undefined}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg py-2 text-start text-sm press-scale"
      >
        <span className="shrink-0 text-base leading-none" aria-hidden>
          {folder.emoji}
        </span>
        <span className="min-w-0 flex-1 truncate">{folder.name}</span>
      </button>
      <Badge
        variant="secondary"
        className={cn('rounded-full px-2 text-xs font-medium tabular-nums', count === 0 && 'opacity-50')}
      >
        {count}
      </Badge>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t('common.more')}
            className="me-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity press-scale hover:bg-accent focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/row:opacity-100"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuItem onClick={() => onNewChild(folder.id)}>
            <FolderPlus aria-hidden /> {t('library.newSubfolder', 'New folder here', 'مجلد جديد هنا')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onRename(folder)}>
            <Pencil aria-hidden /> {t('library.renameFolder')}
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
    </div>
  );
}
