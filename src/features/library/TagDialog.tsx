'use client';
// "Tags…" dialog for a notebook — check/uncheck existing tags, create new tags
// (name + color from a fixed palette), delete tags (with confirm), Save applies.
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useApp, useT } from '@/lib/nanote/store';
import type { NotebookRow, TagRow } from '@/lib/nanote/types';
import { cn } from '@/lib/utils';
import { TAG_COLORS } from './constants';
import { ConfirmDialog } from './ConfirmDialog';

interface TagDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notebook: NotebookRow | null;
}

export function TagDialog({ open, onOpenChange, notebook }: TagDialogProps) {
  const { t, fmt } = useT();
  const tags = useApp((s) => s.tags);
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(TAG_COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [tagToDelete, setTagToDelete] = useState<TagRow | null>(null);

  useEffect(() => {
    if (open) {
      setSelected(notebook?.tagIds ?? []);
      setName('');
      setColor(TAG_COLORS[0]);
      setBusy(false);
      setTagToDelete(null);
    }
  }, [open, notebook]);

  const toggle = (id: string) => {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  const createTag = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const tag = await useApp.getState().createTag(trimmed, color);
      setSelected((s) => [...s, tag.id]);
      setName('');
    } catch {
      toast.error(t('error.generic'));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!notebook) return;
    setBusy(true);
    try {
      await useApp.getState().setNotebookTags(notebook.id, selected);
      onOpenChange(false);
    } catch {
      toast.error(t('error.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('library.tags')}</DialogTitle>
            <DialogDescription className="truncate">{notebook?.title}</DialogDescription>
          </DialogHeader>

          <div className="max-h-96 overflow-y-auto nanote-scroll">
            {tags.length === 0 ? (
              <p className="px-1 py-3 text-sm text-muted-foreground">
                {t('library.tags.none', 'No tags yet', 'لا وسوم بعد')}
              </p>
            ) : (
              <div className="flex flex-col">
                {tags.map((tag) => {
                  const checked = selected.includes(tag.id);
                  return (
                    <div key={tag.id} className="flex items-center gap-2.5 rounded-lg px-1 py-1.5">
                      <Checkbox
                        id={`nanote-tag-${tag.id}`}
                        checked={checked}
                        onCheckedChange={() => toggle(tag.id)}
                      />
                      <Label
                        htmlFor={`nanote-tag-${tag.id}`}
                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm font-normal"
                      >
                        <span
                          className="h-3 w-3 shrink-0 rounded-full"
                          style={{ background: tag.colorHex }}
                          aria-hidden
                        />
                        <span className="truncate">{tag.name}</span>
                      </Label>
                      <button
                        type="button"
                        aria-label={t('common.delete')}
                        onClick={() => setTagToDelete(tag)}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors press-scale hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <Separator />

          <div className="flex flex-col gap-2">
            <Label htmlFor="nanote-new-tag" className="text-sm font-medium">
              {t('library.tags.newTag', 'New tag', 'وسم جديد')}
            </Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="nanote-new-tag"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('common.name')}
                className="min-w-32 flex-1"
                maxLength={30}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void createTag();
                  }
                }}
              />
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('common.color')}>
                {TAG_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={c}
                    aria-pressed={color === c}
                    onClick={() => setColor(c)}
                    style={{ background: c }}
                    className={cn(
                      'h-6 w-6 rounded-full transition-transform press-scale',
                      color === c && 'scale-110 ring-2 ring-ring ring-offset-1 ring-offset-background',
                    )}
                  />
                ))}
              </div>
              <Button
                type="button"
                size="icon"
                aria-label={t('common.add')}
                onClick={() => void createTag()}
                disabled={!name.trim() || busy}
                className="press-scale"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void save()} disabled={busy}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!tagToDelete}
        onOpenChange={(o) => {
          if (!o) setTagToDelete(null);
        }}
        title={t('common.delete')}
        description={
          tagToDelete
            ? fmt(
                t(
                  'library.tags.deleteConfirm',
                  'Delete tag “{name}”? It will be removed from all notebooks.',
                  'حذف الوسم «{name}»؟ سيُزال من جميع الدفاتر.',
                ),
                { name: tagToDelete.name },
              )
            : undefined
        }
        confirmLabel={t('common.delete')}
        destructive
        onConfirm={async () => {
          if (!tagToDelete) return;
          await useApp.getState().deleteTag(tagToDelete.id);
          setSelected((s) => s.filter((x) => x !== tagToDelete.id));
          toast.success(t('common.done'));
        }}
      />
    </>
  );
}
