'use client';
// "Move to folder" tree picker — includes a "No folder" option.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Check, FolderX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useApp, useT } from '@/lib/nanote/store';
import type { NotebookRow } from '@/lib/nanote/types';
import { cn } from '@/lib/utils';
import { buildChildrenMap } from './folderUtils';

interface MoveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notebook: NotebookRow | null;
}

export function MoveDialog({ open, onOpenChange, notebook }: MoveDialogProps) {
  const { t } = useT();
  const folders = useApp((s) => s.folders);
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const liveFolders = useMemo(() => folders.filter((f) => f.deletedAt == null), [folders]);
  const childrenMap = useMemo(() => buildChildrenMap(liveFolders), [liveFolders]);

  useEffect(() => {
    if (open) {
      setSel(notebook?.folderId ?? null);
      setBusy(false);
    }
  }, [open, notebook]);

  const move = async () => {
    if (!notebook) return;
    setBusy(true);
    try {
      await useApp.getState().moveNotebook(notebook.id, sel);
      toast.success(t('library.moved', 'Notebook moved', 'تم نقل الدفتر'));
      onOpenChange(false);
    } catch {
      toast.error(t('error.generic'));
    } finally {
      setBusy(false);
    }
  };

  const renderTree = (parentId: string | null, depth: number, visited: Set<string>): ReactNode =>
    (childrenMap.get(parentId) ?? []).map((f) => {
      if (visited.has(f.id)) return null;
      const next = new Set(visited);
      next.add(f.id);
      return (
        <div key={f.id} className="flex flex-col">
          <button
            type="button"
            onClick={() => setSel(f.id)}
            aria-pressed={sel === f.id}
            style={{ paddingInlineStart: depth * 12 + 8 }}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-start text-sm transition-colors hover:bg-accent/60"
          >
            <span className="shrink-0 text-base leading-none" aria-hidden>
              {f.emoji}
            </span>
            <span className="min-w-0 flex-1 truncate">{f.name}</span>
            {sel === f.id ? <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden /> : null}
          </button>
          {renderTree(f.id, depth + 1, next)}
        </div>
      );
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('library.moveTo')}</DialogTitle>
          <DialogDescription className="truncate">{notebook?.title}</DialogDescription>
        </DialogHeader>

        <div className="max-h-96 overflow-y-auto nanote-scroll rounded-lg border p-1">
          <button
            type="button"
            onClick={() => setSel(null)}
            aria-pressed={sel === null}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-start text-sm transition-colors hover:bg-accent/60"
          >
            <FolderX className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{t('library.noFolder')}</span>
            {sel === null ? <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden /> : null}
          </button>
          {renderTree(null, 0, new Set())}
        </div>

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
