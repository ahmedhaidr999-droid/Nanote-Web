'use client';
// Full-screen instant search overlay — notebooks, folders, tags and indexed
// page text (text boxes + outline labels). Debounced 120 ms, min 1 character.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FileText, Folder, Info, Search, SearchX, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/nanote/EmptyState';
import { NotebookCover } from '@/components/nanote/NotebookCover';
import { useApp, useT } from '@/lib/nanote/store';
import type { FolderRow, NotebookRow, PageRow } from '@/lib/nanote/types';
import { useImageURL } from './useImageURL';

interface SearchOverlayProps {
  onClose: () => void;
  onSelectFolder: (folderId: string) => void;
  onSelectTab: (tabId: string) => void;
  onSelectTag: (tagId: string) => void;
}

export function SearchOverlay({ onClose, onSelectFolder, onSelectTab, onSelectTag }: SearchOverlayProps) {
  const { t, fmt } = useT();
  const notebooks = useApp((s) => s.notebooks);
  const folders = useApp((s) => s.folders);
  const tabs = useApp((s) => s.tabs);
  const tags = useApp((s) => s.tags);
  const pages = useApp((s) => s.pages);

  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q.trim()), 120);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const liveIds = useMemo(
    () => new Set(notebooks.filter((n) => n.deletedAt == null).map((n) => n.id)),
    [notebooks],
  );
  const notebookById = useMemo(() => new Map(notebooks.map((n) => [n.id, n])), [notebooks]);
  const folderById = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);

  const results = useMemo(() => {
    const needle = debouncedQ.toLowerCase();
    if (!needle) return null;

    const nbHits = notebooks
      .filter((n) => n.deletedAt == null && n.title.toLowerCase().includes(needle))
      .slice(0, 12);
    const tabHits = tabs
      .filter((tb) => tb.deletedAt == null && tb.name.toLowerCase().includes(needle))
      .slice(0, 6);
    const folderHits = folders
      .filter((f) => f.deletedAt == null && f.name.toLowerCase().includes(needle))
      .slice(0, 8);
    const tagHits = tags.filter((tg) => tg.name.toLowerCase().includes(needle)).slice(0, 8);

    const pageHits: { page: PageRow; display: string }[] = [];
    for (const p of pages) {
      if (!liveIds.has(p.notebookId)) continue;
      const display = `${p.textIndex} ${p.labels.map((l) => l.title).join(' ')}`.replace(/\s+/g, ' ').trim();
      if (!display) continue;
      if (display.toLowerCase().includes(needle)) {
        pageHits.push({ page: p, display });
        if (pageHits.length >= 20) break;
      }
    }
    return { nbHits, tabHits, folderHits, tagHits, pageHits };
  }, [debouncedQ, notebooks, folders, tabs, tags, pages, liveIds]);

  const openNotebook = (id: string) => {
    onClose();
    void useApp.getState().openEditor(id);
  };

  const isEmpty =
    results !== null &&
    results.nbHits.length === 0 &&
    results.tabHits.length === 0 &&
    results.folderHits.length === 0 &&
    results.tagHits.length === 0 &&
    results.pageHits.length === 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('common.search')}
      className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur"
    >
      <div className="w-full px-4 pt-5 sm:pt-8">
        <div className="mx-auto w-full max-w-2xl">
          <div className="relative">
            <Search
              className="pointer-events-none absolute start-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              ref={inputRef}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') onClose();
              }}
              placeholder={t('library.search.placeholder')}
              aria-label={t('common.search')}
              className="h-12 rounded-xl bg-card ps-10 pe-11 text-base shadow-ink-1"
            />
            <button
              type="button"
              onClick={onClose}
              aria-label={t('common.close')}
              className="absolute end-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors press-scale hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto mt-4 w-full max-w-2xl flex-1 overflow-y-auto nanote-scroll px-4 pb-8">
        {isEmpty ? (
          <EmptyState icon={SearchX} title={t('library.search.noResults')} className="py-12" />
        ) : (
          <>
            {results && results.nbHits.length > 0 ? (
              <Group label={t('library.notebooks', 'Notebooks', 'الدفاتر')}>
                {results.nbHits.map((nb) => (
                  <NotebookHit
                    key={nb.id}
                    notebook={nb}
                    folder={nb.folderId ? folderById.get(nb.folderId) ?? null : null}
                    onOpen={() => openNotebook(nb.id)}
                  />
                ))}
              </Group>
            ) : null}

            {results && results.tabHits.length > 0 ? (
              <Group label={t('library.tabs')}>
                {results.tabHits.map((tb) => (
                  <button
                    key={tb.id}
                    type="button"
                    onClick={() => {
                      onSelectTab(tb.id);
                      onClose();
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-start text-sm transition-colors press-scale hover:bg-accent/60"
                  >
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-base"
                      style={{ background: `${tb.colorHex}1F` }}
                      aria-hidden
                    >
                      {tb.emoji}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">{tb.name}</span>
                    <span className="shrink-0 rounded-full bg-surface-variant px-2 py-0.5 text-xs text-muted-foreground">
                      {fmt(t('library.insideTab'), {
                        count: notebooks.filter((n) => n.deletedAt == null && n.tabId === tb.id).length,
                      })}
                    </span>
                  </button>
                ))}
              </Group>
            ) : null}

            {results && results.folderHits.length > 0 ? (
              <Group label={t('library.folders')}>
                {results.folderHits.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => {
                      onSelectFolder(f.id);
                      onClose();
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-start text-sm transition-colors press-scale hover:bg-accent/60"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-variant text-base" aria-hidden>
                      {f.emoji}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">{f.name}</span>
                    {f.tabId != null ? (
                      <span className="shrink-0 truncate text-xs text-muted-foreground">
                        {tabs.find((tb) => tb.id === f.tabId)?.name ?? ''}
                      </span>
                    ) : null}
                    <Folder className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  </button>
                ))}
              </Group>
            ) : null}

            {results && results.tagHits.length > 0 ? (
              <Group label={t('library.tags')}>
                {results.tagHits.map((tg) => (
                  <button
                    key={tg.id}
                    type="button"
                    onClick={() => {
                      onSelectTag(tg.id);
                      onClose();
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-start text-sm transition-colors press-scale hover:bg-accent/60"
                  >
                    <span
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ background: tg.colorHex }}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate font-medium">{tg.name}</span>
                  </button>
                ))}
              </Group>
            ) : null}

            {results && results.pageHits.length > 0 ? (
              <Group label={t('library.inPages', 'In pages', 'داخل الصفحات')}>
                {results.pageHits.map(({ page, display }) => {
                  const nb = notebookById.get(page.notebookId);
                  return (
                    <button
                      key={page.id}
                      type="button"
                      onClick={() => openNotebook(page.notebookId)}
                      className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-start transition-colors press-scale hover:bg-accent/60"
                    >
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="min-w-0 truncate text-sm font-medium">
                            {nb?.title ?? ''}
                          </span>
                          <span className="shrink-0 rounded-full bg-surface-variant px-2 py-0.5 text-xs text-muted-foreground">
                            {fmt(t('editor.page'), { n: page.pageIndex + 1 })}
                          </span>
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          <Snippet text={display} needle={debouncedQ} />
                        </span>
                      </span>
                    </button>
                  );
                })}
              </Group>
            ) : null}
          </>
        )}

        <p className="mt-6 flex items-start gap-2 px-2 text-xs leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          {t('library.search.resultsNote')}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- pieces

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="mb-4">
      <h2 className="mb-1 px-3 text-sm font-semibold text-muted-foreground">{label}</h2>
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

function NotebookHit({
  notebook,
  folder,
  onOpen,
}: {
  notebook: NotebookRow;
  folder: FolderRow | null;
  onOpen: () => void;
}) {
  const imgUrl = useImageURL(notebook.coverCustomId);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-start transition-colors press-scale hover:bg-accent/60"
    >
      <NotebookCover
        coverId={notebook.coverId}
        customUrl={imgUrl}
        className="aspect-[3/4] w-10 shrink-0 rounded-md"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{notebook.title}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {folder ? `${folder.emoji} ${folder.name}` : ''}
        </span>
      </span>
    </button>
  );
}

/** Truncates to ±40 chars around the first match and highlights it. */
function Snippet({ text, needle }: { text: string; needle: string }) {
  const i = text.toLowerCase().indexOf(needle.toLowerCase());
  if (i < 0) return <>{text}</>;
  const start = Math.max(0, i - 40);
  const end = i + needle.length + 40;
  return (
    <>
      {start > 0 ? '…' : ''}
      {text.slice(start, i)}
      <mark className="rounded-sm bg-warning/40 px-0.5 text-inherit">
        {text.slice(i, i + needle.length)}
      </mark>
      {text.slice(i + needle.length, Math.min(end, text.length))}
      {end < text.length ? '…' : ''}
    </>
  );
}
