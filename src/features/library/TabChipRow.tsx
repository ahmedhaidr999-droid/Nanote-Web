'use client';
// Edge tab chips — the library's top-level navigation. A virtual "All Notes"
// chip plus one chip per live tab, a trailing "+" chip to create a tab, and a
// per-chip menu (chevron / long-press / right-click) with rename, new folder
// inside and delete. Replaces the old folder chips at the same screen edge.
import { useMemo, useRef, useState } from 'react';
import { ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useApp, useT } from '@/lib/nanote/store';
import type { TabRow } from '@/lib/nanote/types';
import { cn } from '@/lib/utils';
import { notebookCountsByTab } from './folderUtils';

interface TabChipRowProps {
  /** Currently selected tab id — null = the virtual "All Notes" chip. */
  activeTabId: string | null;
  /** True while the header view is on "All" (chips only steer that view). */
  chipsActive: boolean;
  onSelect: (tabId: string | null) => void;
  onNewTab: () => void;
  onRenameTab: (tab: TabRow) => void;
  onNewFolderInTab: (tab: TabRow) => void;
  onDeleteTab: (tab: TabRow) => void;
}

const LONG_PRESS_MS = 480;

// plain virtual chip ("All Notes") — same pill styling as the old folder chips
function Chip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex shrink-0 items-center whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition-colors press-scale',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'bg-card text-foreground hover:bg-accent/60',
      )}
    >
      {label}
    </button>
  );
}


export function TabChipRow({
  activeTabId,
  chipsActive,
  onSelect,
  onNewTab,
  onRenameTab,
  onNewFolderInTab,
  onDeleteTab,
}: TabChipRowProps) {
  const { t, fmt } = useT();
  const tabs = useApp((s) => s.tabs);
  const folders = useApp((s) => s.folders);
  const notebooks = useApp((s) => s.notebooks);

  const liveTabs = useMemo(() => tabs.filter((tb) => tb.deletedAt == null), [tabs]);
  const counts = useMemo(
    () => notebookCountsByTab(notebooks.filter((n) => n.deletedAt == null), folders),
    [notebooks, folders],
  );

  return (
    <nav
      aria-label={t('library.tabs')}
      className="border-b bg-background/80 px-3 py-2 backdrop-blur"
    >
      <div className="flex items-center gap-1.5 overflow-x-auto nanote-scroll">
        <Chip
          active={chipsActive && activeTabId == null}
          label={t('library.tab.all')}
          onClick={() => onSelect(null)}
        />
        {liveTabs.map((tb) => (
          <TabChip
            key={tb.id}
            tab={tb}
            count={counts[tb.id] ?? 0}
            countLabel={fmt(t('library.insideTab'), { count: counts[tb.id] ?? 0 })}
            active={chipsActive && activeTabId === tb.id}
            onSelect={onSelect}
            onRenameTab={onRenameTab}
            onNewFolderInTab={onNewFolderInTab}
            onDeleteTab={onDeleteTab}
          />
        ))}
        <button
          type="button"
          onClick={onNewTab}
          aria-label={t('library.newTab')}
          title={t('library.newTab')}
          className={cn(
            'flex h-[34px] shrink-0 items-center gap-1 rounded-full border border-dashed px-2.5 text-sm',
            'text-muted-foreground transition-colors press-scale hover:bg-accent/60 hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          <Plus className="h-4 w-4" aria-hidden />
          <span className="sr-only">{t('library.newTab')}</span>
        </button>
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------- chip + menu

interface TabChipProps {
  tab: TabRow;
  count: number;
  countLabel: string;
  active: boolean;
  onSelect: (tabId: string | null) => void;
  onRenameTab: (tab: TabRow) => void;
  onNewFolderInTab: (tab: TabRow) => void;
  onDeleteTab: (tab: TabRow) => void;
}

function TabChip({
  tab,
  count,
  countLabel,
  active,
  onSelect,
  onRenameTab,
  onNewFolderInTab,
  onDeleteTab,
}: TabChipProps) {
  const { t } = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);

  const startLongPress = () => {
    longPressFired.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      setMenuOpen(true);
    }, LONG_PRESS_MS);
  };
  const cancelLongPress = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  };

  return (
    <div
      className={cn(
        'flex shrink-0 items-stretch rounded-full border transition-colors',
        active ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-foreground hover:bg-accent/60',
      )}
      onPointerDown={(e) => {
        if (menuOpen) return;
        // only touch/pen/mouse primary button; ignore secondary (context menu)
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        startLongPress();
      }}
      onPointerUp={cancelLongPress}
      onPointerLeave={cancelLongPress}
      onPointerCancel={cancelLongPress}
      onContextMenu={(e) => {
        e.preventDefault();
        cancelLongPress();
        setMenuOpen(true);
      }}
    >
      <button
        type="button"
        aria-pressed={active}
        aria-current={active || undefined}
        onClick={() => {
          if (longPressFired.current) {
            longPressFired.current = false; // swallow the click after a long-press
            return;
          }
          onSelect(tab.id);
        }}
        className={cn(
          'flex items-center gap-1 whitespace-nowrap rounded-full px-3 py-1.5 text-sm transition-colors press-scale',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        <span aria-hidden>{tab.emoji}</span>
        <span>{tab.name}</span>
        {count > 0 ? (
          <span
            aria-label={countLabel}
            className={cn(
              'rounded-full px-1.5 text-xs tabular-nums',
              active ? 'bg-primary-foreground/20' : 'bg-surface-variant text-muted-foreground',
            )}
          >
            {count}
          </span>
        ) : null}
      </button>

      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={t('common.more')}
            aria-haspopup="menu"
            onClick={() => setMenuOpen(true)}
            className={cn(
              'flex w-6 items-center justify-center rounded-e-full transition-colors',
              'text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active && 'text-primary-foreground/80 hover:text-primary-foreground',
            )}
          >
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          <DropdownMenuItem onClick={() => onSelect(tab.id)}>
            <span aria-hidden>{tab.emoji}</span> {t('common.open')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onNewFolderInTab(tab)}>
            <Plus className="h-4 w-4" aria-hidden /> {t('library.newFolder.in')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onRenameTab(tab)}>
            <Pencil aria-hidden /> {t('library.renameTab')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:bg-destructive/10 focus:text-destructive"
            onClick={() => onDeleteTab(tab)}
          >
            <Trash2 aria-hidden /> {t('library.deleteTab')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

