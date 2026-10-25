'use client';
// "Move notebook" — two-level picker: pick a TAB (lands at its root via
// moveNotebookToTab) or drill into one of its FOLDERS (moveNotebook, which
// carries the notebook into that folder's tab).
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useApp, useT } from '@/lib/nanote/store';
import type { NotebookRow } from '@/lib/nanote/types';
import { cn } from '@/lib/utils';
import { liveTabsSorted } from './folderUtils';
import { TabFolderPicker, type TabFolderPickerValue } from './TabFolderPicker';

interface MoveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notebook: NotebookRow | null;
}

export function MoveDialog({ open, onOpenChange, notebook }: MoveDialogProps) {
  const { t, lang } = useT();
  const tabs = useApp((s) => s.tabs);
  const folders = useApp((s) => s.folders);
  const [value, setValue] = useState<TabFolderPickerValue>({ tabId: null, folderId: null });
  const [busy, setBusy] = useState(false);

  const liveFolders = useMemo(() => folders.filter((f) => f.deletedAt == null), [folders]);
  const liveTabs = useMemo(() => liveTabsSorted(tabs, lang), [tabs, lang]);

  useEffect(() => {
    if (open) {
      setValue({ tabId: notebook?.tabId ?? null, folderId: notebook?.folderId ?? null });
      setBusy(false);
    }
  }, [open, notebook]);

  const move = async () => {
    if (!notebook) return;
    setBusy(true);
    try {
      if (value.folderId) {
        await useApp.getState().moveNotebook(notebook.id, value.folderId);
      } else {
        await useApp.getState().moveNotebookToTab(notebook.id, value.tabId);
      }
      toast.success(t('library.moved', 'Notebook moved', 'تم نقل الدفتر'));
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
          <DialogTitle>{t('library.moveTo.tab')}</DialogTitle>
          <DialogDescription className="truncate">{notebook?.title}</DialogDescription>
        </DialogHeader>

        <TabFolderPicker
          tabs={liveTabs}
          folders={liveFolders}
          value={value}
          onChange={setValue}
          allowNoTab
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
