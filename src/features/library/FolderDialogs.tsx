'use client';
// Create / rename folder dialog — name + curated emoji grid + color swatches.
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useApp, useT } from '@/lib/nanote/store';
import type { FolderRow } from '@/lib/nanote/types';
import { cn } from '@/lib/utils';
import { FOLDER_COLORS, FOLDER_EMOJIS } from './constants';

export type FolderDialogState =
  | { mode: 'create'; parentId: string | null }
  | { mode: 'rename'; folder: FolderRow }
  | null;

interface FolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: FolderDialogState;
}

export function FolderDialog({ open, onOpenChange, state }: FolderDialogProps) {
  const { t } = useT();
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState<string>('📁');
  const [color, setColor] = useState<string>(FOLDER_COLORS[0]);
  const [busy, setBusy] = useState(false);

  const mode = state?.mode ?? 'create';
  const folder = state?.mode === 'rename' ? state.folder : null;
  const parentId = state?.mode === 'create' ? state.parentId : null;

  useEffect(() => {
    if (open) {
      setName(mode === 'rename' && folder ? folder.name : '');
      setEmoji(mode === 'rename' && folder ? folder.emoji : '📁');
      setColor(mode === 'rename' && folder ? folder.colorHex : FOLDER_COLORS[0]);
      setBusy(false);
    }
  }, [open, mode, folder]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      if (mode === 'create') {
        await useApp.getState().createFolder(trimmed, parentId, emoji, color);
        toast.success(t('library.folderCreated', 'Folder created', 'تم إنشاء المجلد'));
      } else if (folder) {
        await useApp.getState().updateFolder(folder.id, { name: trimmed, emoji, colorHex: color });
      }
      onOpenChange(false);
    } catch {
      toast.error(t('error.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === 'create' ? t('library.newFolder') : t('library.renameFolder')}
          </DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="nanote-folder-name">{t('library.newFolder.name')}</Label>
            <Input
              id="nanote-folder-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('library.newFolder.name')}
              maxLength={60}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>{t('library.newFolder.emoji')}</Label>
            <div className="grid grid-cols-8 gap-1 rounded-lg bg-surface-variant/70 p-2">
              {FOLDER_EMOJIS.map((em) => (
                <button
                  key={em}
                  type="button"
                  aria-label={em}
                  aria-pressed={emoji === em}
                  onClick={() => setEmoji(em)}
                  className={cn(
                    'flex h-9 items-center justify-center rounded-lg text-lg transition-transform press-scale',
                    emoji === em ? 'scale-110 bg-background shadow-ink-1' : 'hover:bg-background/60',
                  )}
                >
                  {em}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label>{t('common.color')}</Label>
            <div className="flex flex-wrap gap-2">
              {FOLDER_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  aria-pressed={color === c}
                  onClick={() => setColor(c)}
                  style={{ background: c }}
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full transition-transform press-scale',
                    color === c && 'scale-110 ring-2 ring-ring ring-offset-2 ring-offset-background',
                  )}
                >
                  {color === c ? (
                    <svg viewBox="0 0 24 24" className="h-4 w-4 text-white" aria-hidden>
                      <path
                        d="M20 6L9 17l-5-5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : null}
                </button>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!name.trim() || busy}>
              {mode === 'create' ? t('common.create') : t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
