'use client';
// "Move folder" — move a folder into another folder (moveFolder, cycle-safe,
// carries its tab) or to a TAB root (same tab: moveFolder(id, null); another
// tab: parentId=null + the new tabId, which cannot create cycles).
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useApp, useT } from '@/lib/nanote/store';
import type { FolderRow } from '@/lib/nanote/types';
import { cn } from '@/lib/utils';
import { liveTabsSorted, subtreeIds } from './folderUtils';
import { TabFolderPicker, type TabFolderPickerValue } from './TabFolderPicker';

interface MoveFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folder: FolderRow | null;
}

export function MoveFolderDialog({ open, onOpenChange, folder }: MoveFolderDialogProps) {
  const { t, lang } = useT();
  const tabs = useApp((s) => s.tabs);
  const folders = useApp((s) => s.folders);
  const [value, setValue] = useState<TabFolderPickerValue>({ tabId: null, folderId: null });
  const [busy, setBusy] = useState(false);

  const liveFolders = useMemo(() => folders.filter((f) => f.deletedAt == null), [folders]);
  const liveTabs = useMemo(() => liveTabsSorted(tabs, lang), [tabs, lang]);
  // the folder itself and its whole subtree are not valid targets (cycles)
  const blockedFolderIds = useMemo(
    () => (folder ? new Set(subtreeIds(liveFolders, folder.id)) : new Set<string>()),
    [folder, liveFolders],
  );

  useEffect(() => {
    if (open) {
      setValue({ tabId: folder?.tabId ?? null, folderId: null });
      setBusy(false);
    }
  }, [open, folder]);

  const move = async () => {
    if (!folder || busy) return;
    setBusy(true);
    try {
      const subtree = subtreeIds(
        useApp.getState().folders.filter((f) => f.deletedAt == null),
        folder.id,
      ); // [self, ...descendants] — captured BEFORE the move
      if (value.folderId) {
        await useApp.getState().moveFolder(folder.id, value.folderId);
      } else if (value.tabId != null) {
        if (value.tabId === folder.tabId) {
          await useApp.getState().moveFolder(folder.id, null);
        } else {
          // store gap: moveFolder(id, null) keeps the OLD tab — a cross-tab root
          // move needs the tabId patched alongside parentId (cycle-safe at root)
          await useApp.getState().updateFolder(folder.id, { parentId: null, tabId: value.tabId });
        }
      }
      // The store's moveFolder patches only the moved folder row — cascade the
      // new tab onto the subtree's folders and the notebooks inside it so
      // tab-level operations (trashTab/restoreTab/purgeTab) stay consistent.
      const newTabId = value.folderId
        ? useApp.getState().folders.find((f) => f.id === value.folderId)?.tabId ?? null
        : value.tabId;
      for (const did of subtree.slice(1)) {
        const f = useApp.getState().folders.find((x) => x.id === did);
        if (f && f.tabId !== newTabId) await useApp.getState().updateFolder(did, { tabId: newTabId });
      }
      for (const n of useApp.getState().notebooks) {
        if (n.folderId && subtree.includes(n.folderId) && n.tabId !== newTabId) {
          await useApp.getState().updateNotebook(n.id, { tabId: newTabId });
        }
      }
      toast.success(t('library.folderMoved', 'Folder moved', 'تم نقل المجلد'));
      onOpenChange(false);
    } catch {
      toast.error(t('error.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('library.moveFolderTo', 'Move folder', 'نقل المجلد')}</DialogTitle>
          <DialogDescription className="truncate">{folder?.name}</DialogDescription>
        </DialogHeader>

        <TabFolderPicker
          tabs={liveTabs}
          folders={liveFolders}
          value={value}
          onChange={setValue}
          blockedFolderIds={blockedFolderIds}
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void move()} disabled={busy} className={cn('press-scale')}>
            {t('common.move')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
