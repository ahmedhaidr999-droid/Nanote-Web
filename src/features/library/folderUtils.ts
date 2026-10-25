// Pure folder-tree helpers shared by the sidebar, chip row and move dialog.
import type { FolderRow } from '@/lib/nanote/types';

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
