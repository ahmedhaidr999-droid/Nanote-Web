// Pure folder-tree helpers shared by the tab chips, folder cards, move dialogs
// and the trash list.
import type { FolderRow, NotebookRow, TabRow } from '@/lib/nanote/types';

export type ChildrenMap = Map<string | null, FolderRow[]>;

/** Groups folders by parentId (name-sorted); key `null` = root level. */
export function buildChildrenMap(folders: FolderRow[]): ChildrenMap {
  const m: ChildrenMap = new Map();
  for (const f of folders) {
    const key = f.parentId ?? null;
    const arr = m.get(key);
    if (arr) arr.push(f);
    else m.set(key, [f]);
  }
  for (const arr of m.values()) arr.sort((a, b) => a.name.localeCompare(b.name));
  return m;
}

/** Ancestor chain (root → … → folder), cycle-guarded. */
export function folderChain(folders: FolderRow[], id: string | null): FolderRow[] {
  if (!id) return [];
  const byId = new Map(folders.map((f) => [f.id, f]));
  const chain: FolderRow[] = [];
  let cur: FolderRow | undefined = byId.get(id);
  let guard = 0;
  while (cur && guard++ < 50) {
    chain.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return chain;
}

/** Live notebook counts keyed by folder id (direct children only). */
export function notebookCountsByFolder(notebooks: { folderId: string | null }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const n of notebooks) {
    if (n.folderId) counts[n.folderId] = (counts[n.folderId] ?? 0) + 1;
  }
  return counts;
}

/** Folder + all descendant ids (cycle-guarded) — used for move-target exclusion. */
export function subtreeIds(folders: FolderRow[], rootId: string): string[] {
  const byParent = new Map<string, FolderRow[]>();
  for (const f of folders) {
    const key = f.parentId ?? '';
    const arr = byParent.get(key);
    if (arr) arr.push(f);
    else byParent.set(key, [f]);
  }
  const ids: string[] = [];
  const stack = [rootId];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    for (const child of byParent.get(id) ?? []) stack.push(child.id);
  }
  return ids;
}

/** Live notebook counts keyed by tab id. Notebooks inside folders resolve
 *  their tab through the folder (folderId is the source of truth). */
export function notebookCountsByTab(
  notebooks: NotebookRow[],
  folders: FolderRow[],
): Record<string, number> {
  const folderTab = new Map(folders.map((f) => [f.id, f.tabId]));
  const counts: Record<string, number> = {};
  for (const n of notebooks) {
    const tb = n.folderId ? folderTab.get(n.folderId) ?? n.tabId : n.tabId;
    if (tb) counts[tb] = (counts[tb] ?? 0) + 1;
  }
  return counts;
}

/** Live tabs, name-sorted with the app language. */
export function liveTabsSorted(tabs: TabRow[], lang: string): TabRow[] {
  return tabs
    .filter((tb) => tb.deletedAt == null)
    .sort((a, b) => a.name.localeCompare(b.name, lang === 'ar' ? 'ar' : 'en'));
}
