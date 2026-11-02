'use client';
// Nanote Library — the app home. Header with view tabs (All / Favorites /
// Trash), TAB chips on the screen edge (the top-level grouping), in-place
// nested folder navigation with a breadcrumb, 4 view modes (grid / list /
// compact / large previews) with persisted sort + filter + layout prefs,
// content previews, multi-selection with batch operations, progressive
// rendering for huge libraries, trash, full-screen search and the create FAB.
// 100% client-side against the Zustand/IndexedDB store.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  FolderOpen, FolderPlus, Monitor, Moon, NotebookPen, NotebookText, Plus, Search,
  Settings as SettingsIcon, SlidersHorizontal, Star, Sun, Trash2, X,
} from 'lucide-react';
import { AppIcon } from '@/components/nanote/AppIcon';
import { EmptyState } from '@/components/nanote/EmptyState';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { recallNav, rememberNav } from '@/lib/nanote/pagemem';
import { useApp, useT } from '@/lib/nanote/store';
import type { FolderRow, NotebookRow, TabRow, ThemeMode } from '@/lib/nanote/types';
import { cn } from '@/lib/utils';
import { BreadcrumbBar } from './BreadcrumbBar';
import { ConfirmDialog } from './ConfirmDialog';
import { FabMenu } from './FabMenu';
import { FilterChips, SortMenu, ViewModeSelector, ViewSettingsButton } from './LibraryToolbar';
import { FolderCard } from './FolderCard';
import { FolderDialog, type FolderDialogState } from './FolderDialogs';
import { MoveDialog } from './MoveDialog';
import { MoveFolderDialog } from './MoveFolderDialog';
import { NotebookCard } from './NotebookCard';
import { NotebookListRow } from './NotebookListRow';
import { type NotebookDialogKind } from './NotebookMenu';
import { RenameNotebookDialog } from './NotebookDialogs';
import { SearchOverlay } from './SearchOverlay';
import { SelectionBar } from './SelectionBar';
import { TabChipRow } from './TabChipRow';
import { TabDialog, type TabDialogState } from './TabDialogs';
import { TagDialog } from './TagDialog';
import { TrashList } from './TrashList';
import { notebookCountsByFolder } from './folderUtils';

type HeaderTabId = 'all' | 'favorites' | 'trash';

/** progressive rendering: files mount in chunks so a library with thousands
 *  of notebooks never lays out thousands of DOM nodes on open */
const CHUNK = 60;
const RECENT_MS = 7 * 24 * 60 * 60 * 1000;   // "recent" = edited within 7 days
const STALE_MS = 30 * 24 * 60 * 60 * 1000;   // "older"  = untouched for 30 days

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
  const pages = useApp((s) => s.pages);
  const pageCounts = useApp((s) => s.pageCounts);
  const prefs = useApp((s) => s.libraryPrefs);
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
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);

  // ----- multi-selection state
  const [selMode, setSelMode] = useState(false);
  const [selNb, setSelNb] = useState<ReadonlySet<string>>(new Set());
  const [selFolders, setSelFolders] = useState<ReadonlySet<string>>(new Set());

  // ----- progressive rendering + responsive columns
  const [renderCount, setRenderCount] = useState(CHUNK);
  const [contentW, setContentW] = useState(0);
  const mainRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrollRatioRef = useRef(0);

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

  /** notebooks that contain a PDF document (stored original or PDF page
   *  backgrounds) — powers the PDF filter, badge and "type" sort */
  const pdfNbIds = useMemo(() => {
    const set = new Set<string>();
    for (const n of notebooks) if (n.pdfOriginalId != null) set.add(n.id);
    for (const p of pages) if (p.backgroundImageId) set.add(p.notebookId);
    return set;
  }, [notebooks, pages]);

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

  // -------------------------------------------------------- filtering + sort
  const coll = lang === 'ar' ? 'ar' : 'en';
  const sortDir = prefs.sortDir === 'asc' ? 1 : -1;

  const cmpFolders = useCallback((a: FolderRow, b: FolderRow): number => {
    switch (prefs.sortKey) {
      case 'created': return (a.createdAt - b.createdAt) * sortDir;
      case 'modified': return (a.updatedAt - b.updatedAt) * sortDir;
      case 'title': return a.name.localeCompare(b.name, coll) * sortDir;
      default: return a.name.localeCompare(b.name, coll);
    }
  }, [prefs.sortKey, sortDir, coll]);

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
      .sort(cmpFolders);
  }, [inTabView, effTabId, liveFolders, activeFolder, cmpFolders]);

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
    // content filter (works in every view mode + every context)
    const now = Date.now();
    switch (prefs.filter) {
      case 'notes': list = list.filter((n) => !pdfNbIds.has(n.id)); break;
      case 'pdf': list = list.filter((n) => pdfNbIds.has(n.id)); break;
      case 'favorites': list = list.filter((n) => n.isFavorite); break;
      case 'recent': list = list.filter((n) => now - n.updatedAt < RECENT_MS); break;
      case 'stale': list = list.filter((n) => now - n.updatedAt > STALE_MS); break;
      default: break;
    }
    if (tagFilter) list = list.filter((n) => n.tagIds.includes(tagFilter));
    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (prefs.sortKey) {
        case 'title': return a.title.localeCompare(b.title, coll) * sortDir;
        case 'created': return (a.createdAt - b.createdAt) * sortDir;
        case 'modified': return (a.updatedAt - b.updatedAt) * sortDir;
        case 'type':
          return ((pdfNbIds.has(a.id) ? 1 : 0) - (pdfNbIds.has(b.id) ? 1 : 0)) * sortDir
            || (b.lastOpenedAt - a.lastOpenedAt);
        case 'pages':
          return ((pageCounts[a.id] ?? 0) - (pageCounts[b.id] ?? 0)) * sortDir
            || (b.lastOpenedAt - a.lastOpenedAt);
        default: return (a.lastOpenedAt - b.lastOpenedAt) * sortDir; // 'opened'
      }
    });
    return sorted;
  }, [liveNotebooks, headerTab, inTabView, effTabId, activeFolder, prefs.filter, prefs.sortKey, sortDir, tagFilter, lang, pdfNbIds, pageCounts, coll]);

  const filterActive = prefs.filter !== 'all' || !!tagFilter;

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

  // -------------------------------------------------------- selection helpers
  const exitSelection = useCallback(() => {
    setSelMode(false);
    setSelNb(new Set());
    setSelFolders(new Set());
  }, []);

  const toggleSelectNb = useCallback((id: string) => {
    setSelNb((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const toggleSelectFolder = useCallback((id: string) => {
    setSelFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const startSelection = useCallback((kind: 'nb' | 'folder', id: string) => {
    setSelMode(true);
    if (kind === 'nb') setSelNb(new Set([id]));
    else setSelFolders(new Set([id]));
  }, []);

  // leave selection mode when the browsing context changes
  useEffect(() => {
    exitSelection();
  }, [activeFolderId, effTabId, headerTab, exitSelection]);

  // Escape leaves selection mode
  useEffect(() => {
    if (!selMode) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') exitSelection(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selMode, exitSelection]);

  const selCount = selNb.size + selFolders.size;
  const totalSelectable = visibleFolders.length + visible.length;

  const selectAll = () => {
    setSelFolders(new Set(visibleFolders.map((f) => f.id)));
    setSelNb(new Set(visible.map((n) => n.id)));
  };

  const batchDelete = async () => {
    try {
      await useApp.getState().trashFolders([...selFolders]);
      await useApp.getState().trashNotebooks([...selNb]);
      // items trashed from the current view drop out of `visible` naturally
      exitSelection();
    } catch {
      // deletion failures keep the selection so nothing is silently lost
    }
  };

  // -------------------------------------------------------- progressive mount
  // reset the chunk window when the RESULT SET identity changes (context,
  // filter, sort, view mode) — fresh contexts start from the top
  useEffect(() => {
    setRenderCount(CHUNK);
  }, [activeFolderId, effTabId, headerTab, prefs.filter, prefs.sortKey, prefs.sortDir, prefs.view, tagFilter]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setRenderCount((c) => (c < visible.length ? Math.min(c + CHUNK, visible.length) : c));
        }
      },
      { root: mainRef.current, rootMargin: '900px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible.length, renderCount]);

  // -------------------------------------------------------- responsive columns
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const w = el.clientWidth;
      setContentW((s) => (Math.abs(s - w) < 1 ? s : w));
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(measure); };
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    measure();
    return () => {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const gridish = prefs.view === 'grid' || prefs.view === 'preview';
  const gridGap = prefs.density === 'compact' ? 8 : prefs.density === 'roomy' ? 20 : 14;
  const rowGap = prefs.density === 'compact' ? 6 : prefs.density === 'roomy' ? 14 : 10;
  const columns = useMemo(() => {
    if (!gridish) return 0;
    if (!prefs.autoColumns) return prefs.columns;
    if (contentW < 2) return 4; // pre-measure placeholder
    return Math.max(2, Math.min(10, Math.floor((contentW + gridGap) / (prefs.cardSize + gridGap))));
  }, [gridish, prefs.autoColumns, prefs.columns, prefs.cardSize, contentW, gridGap]);

  // keep the scroll POSITION across view-mode switches: track the scroll
  // ratio continuously, restore it after the new layout settles (one paint)
  const onMainScroll = useCallback(() => {
    const el = mainRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    scrollRatioRef.current = max > 0 ? el.scrollTop / max : 0;
  }, []);
  const prevViewRef = useRef(prefs.view);
  useLayoutEffect(() => {
    const el = mainRef.current;
    if (!el || prevViewRef.current === prefs.view) return;
    prevViewRef.current = prefs.view;
    const max = el.scrollHeight - el.clientHeight;
    el.scrollTop = scrollRatioRef.current * max;
  }, [prefs.view]);

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
    if (headerTab === 'favorites' && !filterActive) {
      return <EmptyState icon={Star} title={t('library.empty.title')} hint={t('library.empty.favorites')} />;
    }
    if (filterActive) {
      return (
        <EmptyState
          icon={SlidersHorizontal}
          title={t('library.empty.title')}
          hint={t('library.empty.filter', 'No items match the current filters.', 'لا عناصر تطابق التصفية الحالية.')}
          action={
            <Button
              variant="outline"
              onClick={() => {
                useApp.getState().setLibraryFilter('all');
                setTagFilter(null);
              }}
              className="press-scale rounded-full"
            >
              <X className="h-4 w-4" aria-hidden /> {t('library.clearFilter', 'Clear filter', 'مسح التصفية')}
            </Button>
          }
        />
      );
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
  const listish = prefs.view === 'list' || prefs.view === 'compact';

  const countBadge = inTabView
    ? `${fmt(t('library.folderCount'), { count: visibleFolders.length })} · ${fmt(t('library.notebookCount'), { count: visible.length })}`
    : String(visible.length);

  const gridStyle = {
    display: 'grid',
    gridTemplateColumns: `repeat(${Math.max(2, columns)}, minmax(0, 1fr))`,
    gap: `${gridGap}px`,
  } as React.CSSProperties;

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

      {/* --------------------------------------------- multi-selection action bar */}
      {selMode && headerTab !== 'trash' ? (
        <SelectionBar
          nbIds={[...selNb]}
          folderIds={[...selFolders]}
          onExit={exitSelection}
          onSelectAll={selectAll}
          onDelete={() => setBatchDeleteOpen(true)}
          totalSelectable={totalSelectable}
        />
      ) : null}

      {/* -------------------------------------------------------- main area */}
      <main
        ref={mainRef}
        onScroll={onMainScroll}
        className="nanote-scroll min-h-0 min-w-0 flex-1 overflow-y-auto p-4 pb-24 sm:p-6 sm:pb-24 lg:pb-8"
      >
        {headerTab === 'trash' ? (
          <TrashList />
        ) : (
          <div ref={contentRef} className="min-w-0">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <h1 className="flex items-center gap-2 text-lg font-bold">
                {headingEmoji ? <span aria-hidden>{headingEmoji}</span> : null}
                {heading}
              </h1>
              <span className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
                {countBadge}
              </span>
            </div>

            {/* toolbar (hidden while selecting) */}
            {!selMode ? (
              <div className="mb-4 flex flex-wrap items-center gap-2" role="toolbar" aria-label={t('library.sort')}>
                <SortMenu />
                <ViewModeSelector />
                <ViewSettingsButton />
                <FilterChips />
              </div>
            ) : null}

            {/* tags */}
            {tags.length > 0 && !selMode ? (
              <div className="mb-4 flex min-w-0 flex-wrap items-center gap-1.5" role="group" aria-label={t('library.tags')}>
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

            {/* folders (inside a tab) */}
            {showFoldersSection ? (
              <section aria-label={t('library.folders')} className="mb-6">
                <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{t('library.folders')}</h2>
                {gridish ? (
                  <div style={gridStyle}>
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
                        showDate={prefs.showDates}
                        selectionMode={selMode}
                        selected={selFolders.has(f.id)}
                        onToggleSelect={toggleSelectFolder}
                        onLongPressSelect={(id) => startSelection('folder', id)}
                      />
                    ))}
                    {!selMode ? newFolderTileGrid : null}
                  </div>
                ) : (
                  <ul className="flex flex-col" style={{ gap: `${rowGap}px` }}>
                    {visibleFolders.map((f) => (
                      <FolderCard
                        key={f.id}
                        folder={f}
                        variant={prefs.view === 'compact' ? 'compact' : 'row'}
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
                        showDate={prefs.showDates}
                        selectionMode={selMode}
                        selected={selFolders.has(f.id)}
                        onToggleSelect={toggleSelectFolder}
                        onLongPressSelect={(id) => startSelection('folder', id)}
                      />
                    ))}
                    {!selMode ? newFolderTileRow : null}
                  </ul>
                )}
              </section>
            ) : null}

            {/* grid / list / compact / preview */}
            {visible.length === 0 ? (
              renderEmpty()
            ) : (
              <section
                aria-label={heading}
                className={cn(listish && 'mx-auto w-full max-w-3xl')}
              >
                {gridish ? (
                  <div style={gridStyle}>
                    {visible.slice(0, renderCount).map((nb) => (
                      <NotebookCard
                        key={nb.id}
                        notebook={nb}
                        folder={nb.folderId ? folderById.get(nb.folderId) ?? null : null}
                        onDialog={onNbDialog}
                        variant={prefs.view === 'preview' ? 'preview' : 'grid'}
                        preferPreview={prefs.showPreviewInGrid}
                        isPdf={pdfNbIds.has(nb.id)}
                        showDate={prefs.showDates}
                        showInfo={prefs.showInfo}
                        selectionMode={selMode}
                        selected={selNb.has(nb.id)}
                        onToggleSelect={toggleSelectNb}
                        onLongPressSelect={(id) => startSelection('nb', id)}
                      />
                    ))}
                  </div>
                ) : (
                  <ul className="flex flex-col" style={{ gap: `${rowGap}px` }}>
                    {visible.slice(0, renderCount).map((nb) => (
                      <NotebookListRow
                        key={nb.id}
                        notebook={nb}
                        folder={nb.folderId ? folderById.get(nb.folderId) ?? null : null}
                        tagsById={tagById}
                        onDialog={onNbDialog}
                        variant={prefs.view === 'compact' ? 'compact' : 'list'}
                        isPdf={pdfNbIds.has(nb.id)}
                        showDate={prefs.showDates}
                        showInfo={prefs.showInfo}
                        selectionMode={selMode}
                        selected={selNb.has(nb.id)}
                        onToggleSelect={toggleSelectNb}
                        onLongPressSelect={(id) => startSelection('nb', id)}
                      />
                    ))}
                  </ul>
                )}
                {/* progressive-mount sentinel: more chunks load as it approaches */}
                {renderCount < visible.length ? (
                  <div ref={sentinelRef} aria-hidden className="h-px w-full" />
                ) : null}
              </section>
            )}
          </div>
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
      <ConfirmDialog
        open={batchDeleteOpen}
        onOpenChange={setBatchDeleteOpen}
        title={t('common.delete')}
        description={fmt(
          t(
            'library.deleteMany.confirm',
            '{count} item(s) and their contents will be moved to trash.',
            'سيتم نقل {count} عنصرًا ومحتوياته إلى المحذوفات.',
          ),
          { count: selCount },
        )}
        confirmLabel={t('common.delete')}
        destructive
        onConfirm={batchDelete}
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
