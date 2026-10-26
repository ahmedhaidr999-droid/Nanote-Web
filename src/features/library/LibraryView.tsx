'use client';
// Nanote Library — the app home. Header with view tabs (All / Favorites /
// Trash), TAB chips on the screen edge (the top-level grouping), in-place
// nested folder navigation with a breadcrumb, notebook grid/list with
// sort/tag filters, trash, favorites, full-screen search and the create FAB.
// 100% client-side against the Zustand/IndexedDB store.
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpDown, ChevronDown, FolderOpen, FolderPlus, LayoutGrid, List as ListIcon, Monitor,
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
import { recallNav, rememberNav } from '@/lib/nanote/pagemem';
import { useApp, useT } from '@/lib/nanote/store';
import type { FolderRow, NotebookRow, TabRow, ThemeMode } from '@/lib/nanote/types';
import { cn } from '@/lib/utils';
import { BreadcrumbBar } from './BreadcrumbBar';
import { ConfirmDialog } from './ConfirmDialog';
import { FabMenu } from './FabMenu';
import { FolderCard } from './FolderCard';
import { FolderDialog, type FolderDialogState } from './FolderDialogs';
import { MoveDialog } from './MoveDialog';
import { MoveFolderDialog } from './MoveFolderDialog';
import { NotebookCard } from './NotebookCard';
import { NotebookListRow } from './NotebookListRow';
import { type NotebookDialogKind } from './NotebookMenu';
import { RenameNotebookDialog } from './NotebookDialogs';
import { SearchOverlay } from './SearchOverlay';
import { TabChipRow } from './TabChipRow';
import { TabDialog, type TabDialogState } from './TabDialogs';
import { TagDialog } from './TagDialog';
import { TrashList } from './TrashList';
import { notebookCountsByFolder } from './folderUtils';

type HeaderTabId = 'all' | 'favorites' | 'trash';
type SortId = 'recent' | 'title' | 'created';

// Module-scope memory of the last tab/folder context so returning from the
// editor (or settings) drops the user back where they were browsing.
// Seeded from localStorage (pagemem.recallNav) so the place ALSO survives a
// full app restart — the user finds their notes exactly where they left them.
let lastNav: { tabId: string | null; folderId: string | null } = recallNav();

export default function LibraryView() {
  const { t, fmt, lang } = useT();

  // ----- store selectors
  const notebooks = useApp((s) => s.notebooks);
  const folders = useApp((s) => s.folders);
  const tabs = useApp((s) => s.tabs);
  const tags = useApp((s) => s.tags);
  const sort = useApp((s) => s.sort);
  const libraryView = useApp((s) => s.libraryView);
  const settings = useApp((s) => s.settings);
  const theme = settings.theme;

  // ----- local UI state
  const [headerTab, setHeaderTab] = useState<HeaderTabId>('all');
  const [activeTabId, setActiveTabId] = useState<string | null>(() => lastNav.tabId);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(() => lastNav.folderId);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [nbDialog, setNbDialog] = useState<{ kind: NotebookDialogKind; nb: NotebookRow } | null>(null);
  const [folderDialog, setFolderDialog] = useState<FolderDialogState>(null);
  const [tabDialog, setTabDialog] = useState<TabDialogState>(null);
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<FolderRow | null>(null);
  const [deleteTabTarget, setDeleteTabTarget] = useState<TabRow | null>(null);
  const [moveFolderTarget, setMoveFolderTarget] = useState<FolderRow | null>(null);

  // ----- derived data
  const liveNotebooks = useMemo(() => notebooks.filter((n) => n.deletedAt == null), [notebooks]);
  const liveFolders = useMemo(() => folders.filter((f) => f.deletedAt == null), [folders]);
  const liveTabs = useMemo(
    () => tabs.filter((tb) => tb.deletedAt == null).sort((a, b) => a.name.localeCompare(b.name)),
    [tabs],
  );
  const folderById = useMemo(() => new Map(liveFolders.map((f) => [f.id, f])), [liveFolders]);
  const tabById = useMemo(() => new Map(liveTabs.map((tb) => [tb.id, tb])), [liveTabs]);
  const tagById = useMemo(() => new Map(tags.map((tg) => [tg.id, tg])), [tags]);

  // NOTE: the selection self-heals during render — ids of trashed rows resolve
  // to null below, and a folder moved into another tab carries the active tab
  // with it via the effTabId derivation (no state-syncing effects needed).
  const activeTab = activeTabId && tabById.has(activeTabId) ? tabById.get(activeTabId) ?? null : null;
  const activeFolder = activeFolderId && folderById.has(activeFolderId) ? folderById.get(activeFolderId) ?? null : null;
  const effTabId = activeFolder ? activeFolder.tabId : activeTab ? activeTab.id : null;
  const effTab = effTabId ? tabById.get(effTabId) ?? null : null;
  const inTabView = headerTab === 'all' && effTab != null;

  // remember the browsing context for back-navigation (module memory) and
  // persist it so the next app launch reopens this exact tab/folder
  useEffect(() => {
    lastNav = { tabId: effTabId, folderId: activeFolder?.id ?? null };
    rememberNav(lastNav.tabId, lastNav.folderId);
  }, [effTabId, activeFolder]);

  const visibleFolders = useMemo(() => {
    if (!inTabView || !effTabId) return [];
    // inside a folder the parentId chain is the truth; at the tab root the
    // stored tabId decides (kept consistent by every store action)
    const parentId = activeFolder?.id ?? null;
    return liveFolders
      .filter((f) =>
        parentId != null
          ? f.parentId === parentId
          : f.tabId === effTabId && f.parentId == null,
      )
      .sort((a, b) => a.name.localeCompare(b.name, lang === 'ar' ? 'ar' : 'en'));
  }, [inTabView, effTabId, liveFolders, activeFolder, lang]);

  const folderNbCounts = useMemo(() => notebookCountsByFolder(liveNotebooks), [liveNotebooks]);
  const childFolderCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const f of liveFolders) {
      if (f.parentId) m[f.parentId] = (m[f.parentId] ?? 0) + 1;
    }
    return m;
  }, [liveFolders]);

  const visible = useMemo(() => {
    let list = liveNotebooks;
    if (headerTab === 'favorites') list = list.filter((n) => n.isFavorite);
    else if (inTabView && effTabId) {
      list = activeFolder
        ? // inside a folder: folderId is the source of truth
          list.filter((n) => (n.folderId ?? null) === activeFolder.id)
        : // tab root: stored tabId + no folder
          list.filter((n) => n.tabId === effTabId && n.folderId == null);
    }
    if (tagFilter) list = list.filter((n) => n.tagIds.includes(tagFilter));
    const sorted = [...list];
    if (sort === 'recent') sorted.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
    else if (sort === 'title') sorted.sort((a, b) => a.title.localeCompare(b.title, lang === 'ar' ? 'ar' : 'en'));
    else sorted.sort((a, b) => b.createdAt - a.createdAt);
    return sorted;
  }, [liveNotebooks, headerTab, inTabView, effTabId, activeFolder, tagFilter, sort, lang]);

  const sortLabel =
    sort === 'recent' ? t('library.sort.recent') : sort === 'title' ? t('library.sort.title') : t('library.sort.created');

  const heading =
    headerTab === 'favorites'
      ? t('library.tab.favorites')
      : headerTab === 'trash'
        ? t('library.tab.trash')
        : activeFolder
          ? activeFolder.name
          : effTab
            ? effTab.name
            : t('library.tab.all');
  const headingEmoji =
    headerTab === 'all' ? (activeFolder ? activeFolder.emoji : effTab && !activeFolder ? effTab.emoji : null) : null;

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
    useApp.getState().navigate({
      name: 'create-notebook',
      folderId: activeFolder?.id ?? null,
      tabId: effTabId,
    });
  };

  const selectTab = (tabId: string | null) => {
    setActiveTabId(tabId);
    setActiveFolderId(null);
    setHeaderTab('all');
  };

  const openFolder = (f: FolderRow) => {
    setActiveFolderId(f.id);
    setActiveTabId(f.tabId);
    setHeaderTab('all');
  };

  const newFolderHere = () => {
    setFolderDialog({ mode: 'create', parentId: activeFolder?.id ?? null, tabId: effTabId });
  };

  // ----- empty states
  const renderEmpty = () => {
    if (headerTab === 'favorites') {
      return <EmptyState icon={Star} title={t('library.empty.title')} hint={t('library.empty.favorites')} />;
    }
    if (inTabView) {
      return (
        <EmptyState
          icon={FolderOpen}
          title={t('library.empty.title')}
          hint={
            activeFolder
              ? t('library.empty.folder', 'No notebooks in this folder yet.', 'لا دفاتر في هذا المجلد بعد.')
              : t(
                  'library.empty.tab',
                  'Create a folder or a notebook to start organizing this tab.',
                  'أنشئ مجلدًا أو دفترًا لبدء تنظيم هذا التبويب.',
                )
          }
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button onClick={newFolderHere} variant="outline" className="press-scale rounded-full">
                <FolderPlus className="h-4 w-4" aria-hidden /> {t('library.newFolder')}
              </Button>
              <Button onClick={createNotebook} className="press-scale rounded-full">
                <Plus className="h-4 w-4" aria-hidden /> {t('library.newNotebook')}
              </Button>
            </div>
          }
        />
      );
    }
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

  // ----- folder tiles (grid + list variants share the "new folder" affordance)
  const newFolderTileGrid = (
    <button
      type="button"
      onClick={newFolderHere}
      aria-label={t('library.newFolder')}
      className="flex min-h-28 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed p-4 text-muted-foreground transition-colors press-scale hover:border-primary/50 hover:bg-accent/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
    >
      <FolderPlus className="h-6 w-6" aria-hidden />
      <span className="text-sm font-medium">{t('library.newFolder')}</span>
    </button>
  );
  const newFolderTileRow = (
    <li>
      <button
        type="button"
        onClick={newFolderHere}
        aria-label={t('library.newFolder')}
        className="flex w-full items-center gap-3 rounded-xl border border-dashed p-3 text-muted-foreground transition-colors press-scale hover:border-primary/50 hover:bg-accent/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
      >
        <span aria-hidden className="flex aspect-[3/4] w-12 shrink-0 items-center justify-center rounded-md bg-surface-variant/60">
          <FolderPlus className="h-5 w-5" aria-hidden />
        </span>
        <span className="text-sm font-medium">{t('library.newFolder')}</span>
      </button>
    </li>
  );

  const showFoldersSection = inTabView;

  const countBadge = inTabView
    ? `${fmt(t('library.folderCount'), { count: visibleFolders.length })} · ${fmt(t('library.notebookCount'), { count: visible.length })}`
    : String(visible.length);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      {/* ------------------------------------------------------------ header */}
      <header className="sticky top-0 z-40 flex h-14 items-center gap-1.5 border-b bg-background/80 px-2 backdrop-blur sm:px-4">
        <div className="flex shrink-0 items-center gap-2 pe-1">
          <AppIcon size={28} />
          <span className="hidden font-bold tracking-tight sm:inline">{t('app.name')}</span>
        </div>

        <Tabs
          value={headerTab}
          onValueChange={(v) => setHeaderTab(v as HeaderTabId)}
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

      {/* ------------------------------------------------------ edge tab chips */}
      <TabChipRow
        activeTabId={activeTabId}
        chipsActive={headerTab === 'all'}
        onSelect={selectTab}
        onNewTab={() => setTabDialog({ mode: 'create' })}
        onRenameTab={(tb) => setTabDialog({ mode: 'rename', tab: tb })}
        onNewFolderInTab={(tb) => {
          setActiveTabId(tb.id);
          setActiveFolderId(null);
          setHeaderTab('all');
          setFolderDialog({ mode: 'create', parentId: null, tabId: tb.id });
        }}
        onDeleteTab={(tb) => setDeleteTabTarget(tb)}
      />

      {/* breadcrumb strip while inside a folder */}
      {inTabView && effTab && activeFolder ? (
        <BreadcrumbBar
          tab={effTab}
          folderId={activeFolder.id}
          folders={liveFolders.filter((f) => f.tabId === effTabId)}
          onGoToTab={() => setActiveFolderId(null)}
          onGoToFolder={(id) => setActiveFolderId(id)}
        />
      ) : null}

      {/* -------------------------------------------------------- main area */}
      <main className="nanote-scroll min-h-0 min-w-0 flex-1 overflow-y-auto p-4 pb-24 sm:p-6 sm:pb-24 lg:pb-8">
        {headerTab === 'trash' ? (
          <TrashList />
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <h1 className="flex items-center gap-2 text-lg font-bold">
                {headingEmoji ? <span aria-hidden>{headingEmoji}</span> : null}
                {heading}
              </h1>
              <span className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
                {countBadge}
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

            {/* folders (inside a tab) */}
            {showFoldersSection ? (
              <section aria-label={t('library.folders')} className="mb-6">
                <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{t('library.folders')}</h2>
                {libraryView === 'grid' ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                    {visibleFolders.map((f) => (
                      <FolderCard
                        key={f.id}
                        folder={f}
                        variant="grid"
                        counts={{
                          notebooks: folderNbCounts[f.id] ?? 0,
                          folders: childFolderCounts[f.id] ?? 0,
                        }}
                        onOpen={openFolder}
                        onRename={(folder) => setFolderDialog({ mode: 'rename', folder })}
                        onMove={(folder) => setMoveFolderTarget(folder)}
                        onNewChild={(folder) =>
                          setFolderDialog({ mode: 'create', parentId: folder.id, tabId: folder.tabId })
                        }
                        onDelete={(folder) => setDeleteFolderTarget(folder)}
                      />
                    ))}
                    {newFolderTileGrid}
                  </div>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {visibleFolders.map((f) => (
                      <FolderCard
                        key={f.id}
                        folder={f}
                        variant="row"
                        counts={{
                          notebooks: folderNbCounts[f.id] ?? 0,
                          folders: childFolderCounts[f.id] ?? 0,
                        }}
                        onOpen={openFolder}
                        onRename={(folder) => setFolderDialog({ mode: 'rename', folder })}
                        onMove={(folder) => setMoveFolderTarget(folder)}
                        onNewChild={(folder) =>
                          setFolderDialog({ mode: 'create', parentId: folder.id, tabId: folder.tabId })
                        }
                        onDelete={(folder) => setDeleteFolderTarget(folder)}
                      />
                    ))}
                    {newFolderTileRow}
                  </ul>
                )}
              </section>
            ) : null}

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

      {/* --------------------------------------------------------------- FAB */}
      <FabMenu
        activeTabId={inTabView ? effTabId : null}
        activeFolderId={inTabView ? activeFolder?.id ?? null : null}
        onNewFolder={(parentId, tabId) => setFolderDialog({ mode: 'create', parentId, tabId })}
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
      <TabDialog
        open={!!tabDialog}
        onOpenChange={(o) => {
          if (!o) setTabDialog(null);
        }}
        state={tabDialog}
      />
      <MoveFolderDialog
        open={!!moveFolderTarget}
        onOpenChange={(o) => {
          if (!o) setMoveFolderTarget(null);
        }}
        folder={moveFolderTarget}
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
            .folders.some((f) => f.id === activeFolderId && f.deletedAt == null);
          if (!stillLive) setActiveFolderId(null);
        }}
      />
      <ConfirmDialog
        open={!!deleteTabTarget}
        onOpenChange={(o) => {
          if (!o) setDeleteTabTarget(null);
        }}
        title={t('library.deleteTab')}
        description={
          deleteTabTarget
            ? fmt(t('library.deleteTab.confirm'), { name: deleteTabTarget.name })
            : undefined
        }
        confirmLabel={t('common.delete')}
        destructive
        onConfirm={async () => {
          const target = deleteTabTarget;
          if (!target) return;
          await useApp.getState().trashTab(target.id);
        }}
      />

      {/* ------------------------------------------------------ search overlay */}
      {searchOpen ? (
        <SearchOverlay
          onClose={() => setSearchOpen(false)}
          onSelectFolder={(id) => {
            const f = folderById.get(id);
            if (f) {
              setActiveFolderId(f.id);
              setActiveTabId(f.tabId);
            }
            setHeaderTab('all');
          }}
          onSelectTab={(id) => {
            setActiveTabId(id);
            setActiveFolderId(null);
            setHeaderTab('all');
          }}
          onSelectTag={(id) => {
            setTagFilter(id);
            setHeaderTab('all');
          }}
        />
      ) : null}
    </div>
  );
}
