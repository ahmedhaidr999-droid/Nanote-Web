'use client';
// Batch "Move N notebooks" — the same two-level tab/folder picker as the
// single-item MoveDialog, driving the store's batch moveNotebooks action.
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useApp, useT } from '@/lib/nanote/store';
import { liveTabsSorted } from './folderUtils';
import { TabFolderPicker, type TabFolderPickerValue } from './TabFolderPicker';

export function BatchMoveDialog({
  open,
  onOpenChange,
  nbIds,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nbIds: string[];
  onDone?: () => void;
}) {
  const { t, fmt, lang } = useT();
  const tabs = useApp((s) => s.tabs);
  const folders = useApp((s) => s.folders);
  const [value, setValue] = useState<TabFolderPickerValue>({ tabId: null, folderId: null });
  const [busy, setBusy] = useState(false);

  const liveFolders = useMemo(() => folders.filter((f) => f.deletedAt == null), [folders]);
  const liveTabs = useMemo(() => liveTabsSorted(tabs, lang), [tabs, lang]);

  useEffect(() => {
    if (open) {
      setValue({ tabId: null, folderId: null });
      setBusy(false);
    }
  }, [open]);

  const move = async () => {
    if (!nbIds.length) return;
    setBusy(true);
    try {
      await useApp.getState().moveNotebooks(nbIds, value.folderId, value.tabId);
      toast.success(
        fmt(t('library.moveMany.done', 'Moved {count} notebooks', 'تم نقل {count} دفترًا'), { count: nbIds.length }),
      );
      onOpenChange(false);
      onDone?.();
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
          <DialogTitle>
            {fmt(t('library.moveMany.title', 'Move {count} notebooks', 'نقل {count} دفترًا'), { count: nbIds.length })}
          </DialogTitle>
          <DialogDescription>{t('library.moveTo.folder')}</DialogDescription>
        </DialogHeader>

        <TabFolderPicker tabs={liveTabs} folders={liveFolders} value={value} onChange={setValue} allowNoTab />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void move()} disabled={busy} className="press-scale">
            {t('common.move')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
