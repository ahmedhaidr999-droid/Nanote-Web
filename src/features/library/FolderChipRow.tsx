'use client';
// Mobile folder navigation — horizontally scrollable breadcrumb chips plus a
// bottom Sheet for drilling into subfolders (with back navigation).
import { useMemo, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useApp, useT } from '@/lib/nanote/store';
import type { FolderRow } from '@/lib/nanote/types';
import { cn } from '@/lib/utils';
import { buildChildrenMap, folderChain, notebookCountsByFolder } from './folderUtils';

interface FolderChipRowProps {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export function FolderChipRow({ selectedId, onSelect }: FolderChipRowProps) {
  const { t } = useT();
  const folders = useApp((s) => s.folders);
  const notebooks = useApp((s) => s.notebooks);
  const [sheetId, setSheetId] = useState<string | null>(null);

  const liveFolders = useMemo(() => folders.filter((f) => f.deletedAt == null), [folders]);
  const childrenMap = useMemo(() => buildChildrenMap(liveFolders), [liveFolders]);
  const counts = useMemo(
    () => notebookCountsByFolder(notebooks.filter((n) => n.deletedAt == null)),
    [notebooks],
  );

  const chain = useMemo(() => folderChain(liveFolders, selectedId), [liveFolders, selectedId]);
  const leafChips = selectedId ? childrenMap.get(selectedId) ?? [] : childrenMap.get(null) ?? [];

  const tapChip = (f: FolderRow) => {
    onSelect(f.id);
    if ((childrenMap.get(f.id) ?? []).length > 0) setSheetId(f.id);
  };

  const sheetFolder = sheetId ? liveFolders.find((f) => f.id === sheetId) ?? null : null;
  const sheetChildren = sheetFolder ? childrenMap.get(sheetFolder.id) ?? [] : [];
  const sheetParent = sheetFolder?.parentId
    ? liveFolders.find((f) => f.id === sheetFolder.parentId) ?? null
    : null;

  return (
    <nav aria-label={t('library.folders')} className="border-b bg-background/80 px-3 py-2 backdrop-blur lg:hidden">
      <div className="flex items-center gap-1.5 overflow-x-auto nanote-scroll">
        <Chip active={!selectedId} onClick={() => onSelect(null)}>
          {t('library.allFolders')}
        </Chip>
        {chain.map((f) => (
          <Chip key={f.id} active={f.id === selectedId} onClick={() => onSelect(f.id)}>
            <span aria-hidden>{f.emoji}</span> {f.name}
          </Chip>
        ))}
        {leafChips.map((f) => (
          <Chip key={f.id} active={false} onClick={() => tapChip(f)}>
            <span aria-hidden>{f.emoji}</span> {f.name}
            {(childrenMap.get(f.id) ?? []).length > 0 ? (
              <ChevronRight className="h-3.5 w-3.5 opacity-70 rtl:rotate-180" aria-hidden />
            ) : null}
          </Chip>
        ))}
      </div>

      <Sheet
        open={!!sheetFolder}
        onOpenChange={(o) => {
          if (!o) setSheetId(null);
        }}
      >
        <SheetContent side="bottom" className="max-h-[75vh]">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              {sheetFolder ? <span aria-hidden>{sheetFolder.emoji}</span> : null}
              {sheetFolder?.name}
            </SheetTitle>
          </SheetHeader>
          <div className="max-h-96 overflow-y-auto nanote-scroll px-4 pb-6">
            {sheetParent ? (
              <button
                type="button"
                onClick={() => setSheetId(sheetParent.id)}
                className="mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-2.5 text-start text-sm text-muted-foreground transition-colors press-scale hover:bg-accent/60"
              >
                <ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden />
                {t('common.back')}
              </button>
            ) : null}
            {sheetChildren.map((f) => {
              const kids = childrenMap.get(f.id) ?? [];
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    onSelect(f.id);
                    setSheetId(kids.length > 0 ? f.id : null);
                  }}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-start text-sm transition-colors press-scale hover:bg-accent/60"
                >
                  <span className="shrink-0 text-base" aria-hidden>
                    {f.emoji}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  {(counts[f.id] ?? 0) > 0 ? (
                    <Badge variant="secondary" className="rounded-full px-2 text-xs tabular-nums">
                      {counts[f.id]}
                    </Badge>
                  ) : null}
                  {kids.length > 0 ? (
                    <ChevronRight className="h-4 w-4 text-muted-foreground rtl:rotate-180" aria-hidden />
                  ) : null}
                </button>
              );
            })}
            {sheetChildren.length === 0 ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">{t('library.empty.title')}</p>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </nav>
  );
}

// ---------------------------------------------------------------- chip

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition-colors press-scale',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'bg-card text-foreground hover:bg-accent/60',
      )}
    >
      {children}
    </button>
  );
}
