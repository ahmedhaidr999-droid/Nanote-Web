'use client';
// Nanote Library — the app home. Header with tabs, desktop folder sidebar +
// mobile chip row, notebook grid/list with sort/tag filters, trash, favorites,
// full-screen search and the create FAB. 100% client-side against the
// Zustand/IndexedDB store.
import { useMemo, useState } from 'react';
import {
  ArrowUpDown, ChevronDown, FolderOpen, LayoutGrid, List as ListIcon, Monitor,
  Moon, NotebookPen, NotebookText, Plus, Search, Settings as SettingsIcon,
  Star, Sun, Trash2, X,
} from 'lucide-react';
import { AppIcon } from '@/components/nanote/AppIcon';
import { EmptyState } from '@/components/nanote/EmptyState';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useApp, useT } from '@/lib/nanote/store';
import type { FolderRow, NotebookRow, ThemeMode } from '@/lib/nanote/types';
import { cn } from '@/lib/utils';
import { FabMenu } from './FabMenu';
import { FolderChipRow } from './FolderChipRow';
import { FolderDialog, type FolderDialogState } from './FolderDialogs';
import { FolderTree } from './FolderTree';
import { MoveDialog } from './MoveDialog';
import { NotebookCard } from './NotebookCard';
import { NotebookListRow } from './NotebookListRow';
import { type NotebookDialogKind } from './NotebookMenu';
import { RenameNotebookDialog } from './NotebookDialogs';
import { SearchOverlay } from './SearchOverlay';
import { TagDialog } from './TagDialog';
import { TrashList } from './TrashList';
import { ConfirmDialog } from './ConfirmDialog';

type TabId = 'all' | 'favorites' | 'trash';
type SortId = 'recent' | 'title' | 'created';

export default function LibraryView() {
  const { t, fmt } = useT();

  // ----- store selectors
  const notebooks = useApp((s) => s.notebooks);
  const folders = useApp((s) => s.folders);
  const tags = useApp((s) => s.tags);
  const sort = useApp((s) => s.sort);
  const libraryView = useApp((s) => s.libraryView);
  const settings = useApp((s) => s.settings);
  const lang = settings.lang;
  const theme = settings.theme;

  // ----- local UI state
  const [tab, setTab] = useState<TabId>('all');
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [nbDialog, setNbDialog] = useState<{ kind: NotebookDialogKind; nb: NotebookRow } | null>(null);
  const [folderDialog, setFolderDialog] = useState<FolderDialogState>(null);
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<FolderRow | null>(null);

  // ----- derived data
  const liveNotebooks = useMemo(() => notebooks.filter((n) => n.deletedAt == null), [notebooks]);
  const folderById = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);
  const tagById = useMemo(() => new Map(tags.map((tg) => [tg.id, tg])), [tags]);
  const selectedFolder = selectedFolderId ? folderById.get(selectedFolderId) ?? null : null;

  const visible = useMemo(() => {
    let list = liveNotebooks;
    if (tab === 'favorites') list = list.filter((n) => n.isFavorite);
    else if (tab === 'all' && selectedFolderId) list = list.filter((n) => n.folderId === selectedFolderId);
    if (tagFilter) list = list.filter((n) => n.tagIds.includes(tagFilter));
    const sorted = [...list];
    if (sort === 'recent') sorted.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
    else if (sort === 'title') sorted.sort((a, b) => a.title.localeCompare(b.title, lang === 'ar' ? 'ar' : 'en'));
    else sorted.sort((a, b) => b.createdAt - a.createdAt);
    return sorted;
  }, [liveNotebooks, tab, selectedFolderId, tagFilter, sort, lang]);

  const sortLabel =
    sort === 'recent' ? t('library.sort.recent') : sort === 'title' ? t('library.sort.title') : t('library.sort.created');

  const heading =
    tab === 'favorites'
      ? t('library.tab.favorites')
      : tab === 'trash'
        ? t('library.tab.trash')
        : selectedFolder
          ? selectedFolder.name
          : t('library.tab.all');

  // ----- header actions
  const cycleTheme = () => {
    const next: ThemeMode = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
    void useApp.getState().setSettings({ theme: next });
  };
  const toggleLang = () => {
    void useApp.getState().setSettings({ lang: lang === 'en' ? 'ar' : 'en' });
  };
  const ThemeIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;

  const onNbDialog = (kind: NotebookDialogKind, nb: NotebookRow) => setNbDialog({ kind, nb });

  const createNotebook = () => {
    useApp.getState().navigate({ name: 'create-notebook', folderId: selectedFolderId });
  };

  // ----- empty states
  const renderEmpty = () => {
    if (liveNotebooks.length === 0) {
      return (
        <EmptyState
          icon={NotebookPen}
          title={t('library.empty.title')}
          hint={t('library.empty.all')}
          action={
            <Button onClick={createNotebook} className="press-scale rounded-full">
              <Plus className="h-4 w-4" aria-hidden /> {t('library.newNotebook')}
            </Button>
          }
        />
      );
    }
    if (tab === 'favorites') {
      return <EmptyState icon={Star} title={t('library.empty.title')} hint={t('library.empty.favorites')} />;
    }
    if (selectedFolder) {
      return (
        <EmptyState
          icon={FolderOpen}
          title={t('library.empty.title')}
          hint={t('library.empty.folder', 'No notebooks in this folder yet.', 'لا دفاتر في هذا المجلد بعد.')}
          action={
            <Button onClick={createNotebook} className="press-scale rounded-full">
              <Plus className="h-4 w-4" aria-hidden /> {t('library.newNotebook')}
            </Button>
          }
        />
      );
    }
    // tag filter with no matches
    return (
      <EmptyState
        icon={NotebookText}
        title={t('library.empty.title')}
        hint={t('library.empty.tag', 'No notebooks with this tag yet.', 'لا دفاتر بهذا الوسم بعد.')}
        action={
          tagFilter ? (
            <Button variant="outline" onClick={() => setTagFilter(null)} className="press-scale rounded-full">
              <X className="h-4 w-4" aria-hidden /> {t('library.clearFilter', 'Clear filter', 'مسح التصفية')}
            </Button>
          ) : undefined
        }
      />
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      {/* ------------------------------------------------------------ header */}
      <header className="sticky top-0 z-40 flex h-14 items-center gap-1.5 border-b bg-background/80 px-2 backdrop-blur sm:px-4">
        <div className="flex shrink-0 items-center gap-2 pe-1">
          <AppIcon size={28} />
          <span className="hidden font-bold tracking-tight sm:inline">{t('app.name')}</span>
        </div>

        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as TabId)}
          className="gap-0 ps-0.5"
          aria-label={t('library.title')}
        >
          <TabsList className="h-10">
            <TabsTrigger value="all" aria-label={t('library.tab.all')} className="gap-1.5 px-2.5 sm:px-3">
              <NotebookText className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">{t('library.tab.all')}</span>
            </TabsTrigger>
            <TabsTrigger value="favorites" aria-label={t('library.tab.favorites')} className="gap-1.5 px-2.5 sm:px-3">
              <Star className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">{t('library.tab.favorites')}</span>
            </TabsTrigger>
            <TabsTrigger value="trash" aria-label={t('library.tab.trash')} className="gap-1.5 px-2.5 sm:px-3">
              <Trash2 className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">{t('library.tab.trash')}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="ms-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('common.search')}
            onClick={() => setSearchOpen(true)}
            className="h-10 w-10 press-scale"
          >
            <Search className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('settings.theme')}
            onClick={cycleTheme}
            className="h-10 w-10 press-scale"
          >
            <ThemeIcon className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('settings.language')}
            onClick={toggleLang}
            className="h-10 w-10 text-sm font-bold press-scale"
          >
            <span aria-hidden>{lang === 'en' ? 'ع' : 'EN'}</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('settings.title')}
            onClick={() => useApp.getState().navigate({ name: 'settings' })}
            className="h-10 w-10 press-scale"
          >
            <SettingsIcon className="h-5 w-5" />
          </Button>
        </div>
      </header>

      {/* ------------------------------------------------- mobile folder chips */}
      <FolderChipRow selectedId={selectedFolderId} onSelect={setSelectedFolderId} />

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* ------------------------------------------------ desktop folder tree */}
        <nav
          aria-label={t('library.folders')}
          className="nanote-scroll hidden w-64 shrink-0 flex-col border-e bg-background p-4 lg:sticky lg:top-14 lg:block lg:max-h-[calc(100vh-3.5rem)] lg:overflow-y-auto"
        >
          <FolderTree
            selectedId={selectedFolderId}
            onSelect={setSelectedFolderId}
            onNewFolder={(parentId) => setFolderDialog({ mode: 'create', parentId })}
            onRename={(folder) => setFolderDialog({ mode: 'rename', folder })}
            onDelete={(folder) => setDeleteFolderTarget(folder)}
          />
        </nav>

        {/* -------------------------------------------------------- main area */}
        <main className="min-w-0 flex-1 p-4 pb-24 sm:p-6 sm:pb-24 lg:pb-8">
          {tab === 'trash' ? (
            <TrashList />
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <h1 className="flex items-center gap-2 text-lg font-bold">
                  {tab === 'all' && selectedFolder ? (
                    <span aria-hidden>{selectedFolder.emoji}</span>
                  ) : null}
                  {heading}
                </h1>
                <span className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
                  {visible.length}
                </span>
              </div>

              {/* toolbar */}
              <div className="mb-4 flex flex-wrap items-center gap-2" role="toolbar" aria-label={t('library.sort')}>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" aria-label={t('library.sort')} className="press-scale gap-1.5">
                      <ArrowUpDown className="h-4 w-4" aria-hidden />
                      {sortLabel}
                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuRadioGroup
                      value={sort}
                      onValueChange={(v) => useApp.getState().setSort(v as SortId)}
                    >
                      <DropdownMenuRadioItem value="recent">{t('library.sort.recent')}</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="title">{t('library.sort.title')}</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="created">{t('library.sort.created')}</DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>

                <div
                  className="flex items-center rounded-lg border bg-card p-0.5"
                  role="group"
                  aria-label={t('settings.defaultView')}
                >
                  <button
                    type="button"
                    aria-label={t('library.view.grid')}
                    aria-pressed={libraryView === 'grid'}
                    onClick={() => useApp.getState().setLibraryView('grid')}
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-md transition-colors press-scale',
                      libraryView === 'grid'
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:bg-accent/60',
                    )}
                  >
                    <LayoutGrid className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={t('library.view.list')}
                    aria-pressed={libraryView === 'list'}
                    onClick={() => useApp.getState().setLibraryView('list')}
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-md transition-colors press-scale',
                      libraryView === 'list'
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:bg-accent/60',
                    )}
                  >
                    <ListIcon className="h-4 w-4" aria-hidden />
                  </button>
                </div>

                {tags.length > 0 ? (
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5" role="group" aria-label={t('library.tags')}>
                    {tags.map((tag) => {
                      const active = tagFilter === tag.id;
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setTagFilter(active ? null : tag.id)}
                          className={cn(
                            'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors press-scale',
                            active
                              ? 'border-primary/60 bg-primary/10 text-primary'
                              : 'bg-card text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                          )}
                        >
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ background: tag.colorHex }}
                            aria-hidden
                          />
                          {tag.name}
                          {active ? <X className="h-3 w-3 shrink-0" aria-hidden /> : null}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>

              {/* grid / list */}
              {visible.length === 0 ? (
                renderEmpty()
              ) : (
                <section aria-label={heading} className={cn(libraryView === 'list' && 'mx-auto w-full max-w-3xl')}>
                  {libraryView === 'grid' ? (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                      {visible.map((nb) => (
                        <NotebookCard
                          key={nb.id}
                          notebook={nb}
                          folder={nb.folderId ? folderById.get(nb.folderId) ?? null : null}
                          onDialog={onNbDialog}
                        />
                      ))}
                    </div>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {visible.map((nb) => (
                        <NotebookListRow
                          key={nb.id}
                          notebook={nb}
                          folder={nb.folderId ? folderById.get(nb.folderId) ?? null : null}
                          tagsById={tagById}
                          onDialog={onNbDialog}
                        />
                      ))}
                    </ul>
                  )}
                </section>
              )}
            </>
          )}
        </main>
      </div>

      {/* --------------------------------------------------------------- FAB */}
      <FabMenu
        selectedFolderId={selectedFolderId}
        onNewFolder={(parentId) => setFolderDialog({ mode: 'create', parentId })}
      />

      {/* ----------------------------------------------------------- dialogs */}
      <RenameNotebookDialog
        open={nbDialog?.kind === 'rename'}
        onOpenChange={(o) => {
          if (!o) setNbDialog(null);
        }}
        notebook={nbDialog?.kind === 'rename' ? nbDialog.nb : null}
      />
      <MoveDialog
        open={nbDialog?.kind === 'move'}
        onOpenChange={(o) => {
          if (!o) setNbDialog(null);
        }}
        notebook={nbDialog?.kind === 'move' ? nbDialog.nb : null}
      />
      <TagDialog
        open={nbDialog?.kind === 'tags'}
        onOpenChange={(o) => {
          if (!o) setNbDialog(null);
        }}
        notebook={nbDialog?.kind === 'tags' ? nbDialog.nb : null}
      />
      <FolderDialog
        open={!!folderDialog}
        onOpenChange={(o) => {
          if (!o) setFolderDialog(null);
        }}
        state={folderDialog}
      />
      <ConfirmDialog
        open={!!deleteFolderTarget}
        onOpenChange={(o) => {
          if (!o) setDeleteFolderTarget(null);
        }}
        title={t('library.deleteFolder')}
        description={
          deleteFolderTarget
            ? fmt(t('library.deleteFolder.confirm'), { name: deleteFolderTarget.name })
            : undefined
        }
        confirmLabel={t('common.delete')}
        destructive
        onConfirm={async () => {
          const target = deleteFolderTarget;
          if (!target) return;
          await useApp.getState().trashFolder(target.id);
          // drop the selection if it lived inside the trashed subtree
          const stillLive = useApp
            .getState()
            .folders.some((f) => f.id === selectedFolderId && f.deletedAt == null);
          if (!stillLive) setSelectedFolderId(null);
        }}
      />

      {/* ------------------------------------------------------ search overlay */}
      {searchOpen ? (
        <SearchOverlay
          onClose={() => setSearchOpen(false)}
          onSelectFolder={(id) => {
            setSelectedFolderId(id);
            setTab('all');
          }}
          onSelectTag={(id) => {
            setTagFilter(id);
            setTab('all');
          }}
        />
      ) : null}
    </div>
  );
}
