'use client';
// Breadcrumb strip — Tab emoji+name › Folder › SubFolder, each crumb clickable,
// plus an "up one level" affordance. Shown inside a tab while a folder is open.
import { useMemo } from 'react';
import { ArrowUpLeft, ChevronRight, Home } from 'lucide-react';
import { useT } from '@/lib/nanote/store';
import type { FolderRow, TabRow } from '@/lib/nanote/types';
import { cn } from '@/lib/utils';
import { folderChain } from './folderUtils';

interface BreadcrumbBarProps {
  tab: TabRow;
  folderId: string;
  folders: FolderRow[]; // live folders of this tab
  onGoToTab: () => void;
  onGoToFolder: (folderId: string | null) => void;
}

export function BreadcrumbBar({ tab, folderId, folders, onGoToTab, onGoToFolder }: BreadcrumbBarProps) {
  const { t } = useT();
  const chain = useMemo(() => folderChain(folders, folderId), [folders, folderId]);

  return (
    <nav
      aria-label={t('common.breadcrumb', 'Breadcrumb', 'مسار التنقل')}
      className="flex items-center gap-1.5 border-b bg-background/60 px-3 py-1.5 backdrop-blur"
    >
      <button
        type="button"
        onClick={chain.length > 1 ? () => onGoToFolder(chain[chain.length - 2].id) : onGoToTab}
        aria-label={t('library.upOneLevel')}
               title={t('library.upOneLevel')}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors press-scale hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowUpLeft className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
      </button>

      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto nanote-scroll">
        <button
          type="button"
          onClick={onGoToTab}
          className={cn(
            'flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-sm transition-colors press-scale',
            'text-muted-foreground hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          <Home className="h-3.5 w-3.5" aria-hidden />
          <span className="max-w-32 truncate" title={tab.name}>
            <span aria-hidden>{tab.emoji}</span> {tab.name}
          </span>
        </button>

        {chain.map((f, i) => {
          const last = i === chain.length - 1;
          return (
            <span key={f.id} className="flex shrink-0 items-center gap-1">
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/70 rtl:rotate-180" aria-hidden />
              {last ? (
                <span aria-current="page" className="max-w-40 truncate rounded-md px-1.5 py-1 text-sm font-semibold text-foreground" title={f.name}>
                  <span aria-hidden>{f.emoji}</span> {f.name}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onGoToFolder(f.id)}
                  className="flex max-w-40 items-center gap-1 truncate rounded-md px-1.5 py-1 text-sm text-muted-foreground transition-colors press-scale hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  title={f.name}
                >
                  <span aria-hidden>{f.emoji}</span> {f.name}
                </button>
              )}
            </span>
          );
        })}
      </div>
    </nav>
  );
}
