'use client';
// Rename notebook dialog.
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useApp, useT } from '@/lib/nanote/store';
import type { NotebookRow } from '@/lib/nanote/types';

interface RenameNotebookDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notebook: NotebookRow | null;
}

export function RenameNotebookDialog({ open, onOpenChange, notebook }: RenameNotebookDialogProps) {
  const { t } = useT();
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(notebook?.title ?? '');
      setBusy(false);
    }
  }, [open, notebook]);

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed || !notebook) return;
    setBusy(true);
    try {
      await useApp.getState().renameNotebook(notebook.id, trimmed);
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
          <DialogTitle>{t('common.rename')}</DialogTitle>
          <DialogDescription className="truncate">{notebook?.title}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="nanote-rename-title">{t('common.title')}</Label>
            <Input
              id="nanote-rename-title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!title.trim() || busy}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
