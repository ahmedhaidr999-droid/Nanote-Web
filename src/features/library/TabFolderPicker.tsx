'use client';
// Shared two-level move picker: pick a TAB (root) or drill into one of its
// FOLDERS (nested tree). Used by the notebook MoveDialog and MoveFolderDialog.
import { useMemo, type ReactNode } from 'react';
import { Check, ChevronRight, FolderX, Home } from 'lucide-react';
import { useT } from '@/lib/nanote/store';
import type { FolderRow, TabRow } from '@/lib/nanote/types';
import { cn } from '@/lib/utils';

export interface TabFolderPickerValue {
  tabId: string | null;   // null = "no tab" (unfiled) — only when allowNoTab
  folderId: string | null; // set ⇒ move into this folder (its tab wins)
}

interface TabFolderPickerProps {
  tabs: TabRow[];
  folders: FolderRow[]; // LIVE folders only
  value: TabFolderPickerValue;
  onChange: (v: TabFolderPickerValue) => void;
  /** Offer the "No tab" (unfiled / All Notes) root — notebooks only. */
  allowNoTab?: boolean;
  /** Folder ids that must not be pickable (self + own subtree for folder moves). */
  blockedFolderIds?: Set<string>;
}

export function TabFolderPicker({
  tabs,
  folders,
  value,
  onChange,
  allowNoTab = false,
  blockedFolderIds,
}: TabFolderPickerProps) {
  const { t } = useT();

  const rootsByTab = useMemo(() => {
    const m = new Map<string, FolderRow[]>();
    for (const f of folders) {
      if (f.parentId != null || f.tabId == null) continue;
      const arr = m.get(f.tabId);
      if (arr) arr.push(f);
      else m.set(f.tabId, [f]);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.name.localeCompare(b.name));
    return m;
  }, [folders]);

  const childrenByParent = useMemo(() => {
    const m = new Map<string, FolderRow[]>();
    for (const f of folders) {
      if (f.parentId == null) continue;
      const arr = m.get(f.parentId);
      if (arr) arr.push(f);
      else m.set(f.parentId, [f]);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.name.localeCompare(b.name));
    return m;
  }, [folders]);

  const pickedTabId = value.folderId
    ? folders.find((f) => f.id === value.folderId)?.tabId ?? value.tabId
    : value.tabId;

  const tabRow = (tabId: string | null, icon: ReactNode, label: string, active: boolean) => (
    <button
      type="button"
      onClick={() => onChange({ tabId, folderId: null })}
      aria-pressed={active}
      className={cn(
        'flex w-full items-center gap-2 rounded-lg px-2 py-2 text-start text-sm transition-colors hover:bg-accent/60',
        active && 'bg-accent/80',
      )}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {active ? <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden /> : null}
    </button>
  );

  const renderTree = (parentId: string, depth: number, visited: Set<string>): ReactNode =>
    (childrenByParent.get(parentId) ?? []).map((f) => {
      if (visited.has(f.id)) return null;
      const blocked = blockedFolderIds?.has(f.id) ?? false;
      const active = value.folderId === f.id;
      const next = new Set(visited);
      next.add(f.id);
      return (
        <div key={f.id} className="flex flex-col">
          <button
            type="button"
            disabled={blocked}
            onClick={() => onChange({ tabId: f.tabId, folderId: f.id })}
            aria-pressed={active}
            aria-disabled={blocked || undefined}
            style={{ paddingInlineStart: depth * 14 + 8 }}
            className={cn(
              'flex w-full items-center gap-2 rounded-lg px-2 py-2 text-start text-sm transition-colors hover:bg-accent/60',
              active && 'bg-accent/80',
              blocked && 'cursor-not-allowed opacity-40 hover:bg-transparent',
            )}
          >
            <span className="shrink-0 text-base leading-none" aria-hidden>
              {f.emoji}
            </span>
            <span className="min-w-0 flex-1 truncate">{f.name}</span>
            {blocked ? (
              <span className="shrink-0 text-xs text-muted-foreground">
                {t('library.move.blocked', 'Not allowed', 'غير ممكن')}
              </span>
            ) : null}
            {active ? <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden /> : null}
          </button>
          {!blocked ? renderTree(f.id, depth + 1, next) : null}
        </div>
      );
    });

  const showTree = pickedTabId != null && rootsByTab.get(pickedTabId) !== undefined;
  const emptyTab = pickedTabId != null && (rootsByTab.get(pickedTabId) ?? []).length === 0;

  return (
    <div className="flex max-h-[50vh] flex-col gap-3 overflow-y-auto nanote-scroll rounded-lg border p-1">
      <section aria-label={t('library.tabs')}>
        {allowNoTab
          ? tabRow(null, <FolderX className="h-4 w-4" />, t('library.noTab', 'No tab (All Notes)', 'بدون تبويب (كل الملاحظات)'), value.folderId == null && value.tabId == null)
          : null}
        {tabs.map((tb) =>
          tabRow(
            tb.id,
            <Home className="h-4 w-4" />,
            `${tb.emoji} ${tb.name}`,
            value.folderId == null && pickedTabId === tb.id,
          ),
        )}
      </section>

      {showTree ? (
        <section aria-label={t('library.moveTo.folder')} className="border-t pt-1">
          <div className="flex items-center gap-1.5 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <ChevronRight className="h-3 w-3 rtl:rotate-180" aria-hidden />
            {t('library.moveTo.folder')}
          </div>
          {renderTreeRoots(pickedTabId as string)}
        </section>
      ) : null}
      {emptyTab ? (
        <p className="px-2 pb-2 text-xs text-muted-foreground">
          {t('library.tabNoFolders', 'No folders in this tab yet — pick the tab itself for its root.', 'لا مجلدات في هذا التبويب بعد — اختر التبويب نفسه للجذر.')}
        </p>
      ) : null}
    </div>
  );

  function renderTreeRoots(tabId: string) {
    return (
      <>
        {(rootsByTab.get(tabId) ?? []).map((f) => {
          const blocked = blockedFolderIds?.has(f.id) ?? false;
          const active = value.folderId === f.id;
          return (
            <div key={f.id} className="flex flex-col">
              <button
                type="button"
                disabled={blocked}
                onClick={() => onChange({ tabId: f.tabId, folderId: f.id })}
                aria-pressed={active}
                aria-disabled={blocked || undefined}
                style={{ paddingInlineStart: 8 }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2 py-2 text-start text-sm transition-colors hover:bg-accent/60',
                  active && 'bg-accent/80',
                  blocked && 'cursor-not-allowed opacity-40 hover:bg-transparent',
                )}
              >
                <span className="shrink-0 text-base leading-none" aria-hidden>
                  {f.emoji}
                </span>
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                {blocked ? (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {t('library.move.blocked', 'Not allowed', 'غير ممكن')}
                  </span>
                ) : null}
                {active ? <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden /> : null}
              </button>
              {!blocked ? renderTree(f.id, 1, new Set([f.id])) : null}
            </div>
          );
        })}
      </>
    );
  }
}
