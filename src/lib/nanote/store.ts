'use client';
// Nanote app store (Zustand) — navigation, library, editor session, undo/redo,
// autosave and settings. This is the single source of truth for app state.
import { create } from 'zustand';
import * as db from './idb';
import {
  DEFAULT_SETTINGS, DEFAULT_TOOL_STATES, EditorTool, EraserMode, FINGER_GESTURES_DEFAULT, FolderRow, ImageEl, INFINITE_GROW_MARGIN, INFINITE_GROW_STEP, migratePenShortcuts, NotebookRow,
  PageDoc, PageElement, PageRow, PageSizeId, PdfTextRec, RecordingRow, Settings, ShapeType, StrokeEl, TabRow, TagRow,
  TemplateId, ToolId, ToolState, UNDO_LIMIT, emptyDoc,
} from './types';
import { uid } from './util';
import { elementBBox } from './geometry';
import { translate, fmt } from './i18n';
import { useCallback } from 'react';
import { seedWelcomeNotebook } from './sample';
import { recallPage, recallSession, rememberPage, rememberSession, clearSession } from './pagemem';
import { setPenProfile } from './penengine';

export type View =
  | { name: 'boot' }
  | { name: 'onboarding' }
  | { name: 'library' }
  | { name: 'create-notebook'; folderId: string | null; tabId?: string | null }
  | { name: 'editor'; notebookId: string }
  | { name: 'settings' };

export interface Cmd { label: string; run(): void; revert(): void; pages?: string[] }

export interface TextDefaults {
  fontId: string; size: number; color: string; bold: boolean; italic: boolean; underline: boolean; align: 'start' | 'center' | 'end';
}

export interface NewNotebookInput {
  title: string;
  folderId: string | null;
  tabId?: string | null;
  coverId: string;
  coverCustomId: string | null;
  template: TemplateId;
  pageSize: PageSizeId;
  backgroundHex: string;
  customTemplateImageId?: string | null;
}

interface AppState {
  booted: boolean;
  view: View;
  history: View[]; // simple back stack

  // ----- settings
  settings: Settings;

  // ----- library
  folders: FolderRow[];
  tabs: TabRow[];
  notebooks: NotebookRow[];
  tags: TagRow[];
  pages: PageRow[]; // all pages (rows only; docs live in IDB)
  pageCounts: Record<string, number>;
  libraryView: 'grid' | 'list';
  sort: 'recent' | 'title' | 'created';
  searchQuery: string;

  // ----- editor
  editor: {
    notebookId: string;
    pages: PageRow[];
    activePageId: string | null;
    docs: Record<string, PageDoc>;
    docVersions: Record<string, number>;
    quarantine: Record<string, boolean>;
    tool: EditorTool;
    lastPen: ToolId;
    toolStates: Record<ToolId, ToolState>;
    eraser: { mode: EraserMode; size: number };
    shape: { type: ShapeType; filled: boolean; color: string; width: number };
    highlighterStraight: boolean;
    textDefaults: TextDefaults;
    recentColors: string[];
    selection: { pageId: string; ids: string[] } | null;
    clipboard: PageElement[] | null;
    undoStack: Cmd[];
    redoStack: Cmd[];
    recordings: RecordingRow[];
    rulerVisible: boolean;
    /** pen-shortcut "toggle toolbar": hides/shows the tool dock (session state) */
    toolbarHidden: boolean;
    activeRecording: { recId: string; startedAt: number } | null;
    audio: { recId: string | null; playing: boolean; tMs: number; sync: boolean; replay: boolean };
  };

  // ----- actions
  boot(): Promise<void>;
  navigate(v: View): void;
  goBack(): void;

  setSettings(patch: Partial<Settings>): Promise<void>;

  refreshLibrary(): Promise<void>;
  setLibraryView(v: 'grid' | 'list'): void;
  setSort(s: 'recent' | 'title' | 'created'): void;
  setSearchQuery(q: string): void;

  createTab(name: string, emoji: string, colorHex: string): Promise<string>;
  updateTab(id: string, patch: Partial<TabRow>): Promise<void>;
  renameTab(id: string, name: string): Promise<void>;
  trashTab(id: string): Promise<void>;
  restoreTab(id: string): Promise<void>;
  purgeTab(id: string): Promise<void>;

  createFolder(name: string, parentId: string | null, emoji: string, colorHex: string, tabId: string | null): Promise<string>;
  updateFolder(id: string, patch: Partial<FolderRow>): Promise<void>;
  renameFolder(id: string, name: string): Promise<void>;
  moveFolder(id: string, parentId: string | null): Promise<void>;
  trashFolder(id: string): Promise<void>;
  restoreFolder(id: string): Promise<void>;
  purgeFolder(id: string): Promise<void>;

  createNotebook(input: NewNotebookInput): Promise<string>;
  updateNotebook(id: string, patch: Partial<NotebookRow>): Promise<void>;
  renameNotebook(id: string, title: string): Promise<void>;
  moveNotebook(id: string, folderId: string | null): Promise<void>;
  moveNotebookToTab(id: string, tabId: string | null): Promise<void>;
  toggleFavoriteNotebook(id: string): Promise<void>;
  duplicateNotebook(id: string): Promise<string>;
  trashNotebook(id: string): Promise<void>;
  restoreNotebook(id: string): Promise<void>;
  purgeNotebook(id: string): Promise<void>;

  createTag(name: string, colorHex: string): Promise<TagRow>;
  deleteTag(id: string): Promise<void>;
  setNotebookTags(notebookId: string, tagIds: string[]): Promise<void>;

  openEditor(notebookId: string): Promise<void>;
  closeEditor(): void;
  /** Persist every pending page save without leaving the editor (background). */
  flushSaves(): void;
  ensureDoc(pageId: string): Promise<PageDoc>;

  setTool(tool: EditorTool): void;
  setToolState(tool: ToolId, patch: Partial<ToolState>): void;
  setEraser(patch: Partial<{ mode: EraserMode; size: number }>): void;
  setShape(patch: Partial<{ type: ShapeType; filled: boolean; color: string; width: number }>): void;
  setHighlighterStraight(v: boolean): void;
  setTextDefaults(patch: Partial<TextDefaults>): void;
  pushRecentColor(hex: string): void;
  toggleRuler(): void;
  toggleToolbar(): void;
  setActivePage(pageId: string): void;

  addElements(pageId: string, els: PageElement[], opts?: { undoable?: boolean }): void;
  removeElements(pageId: string, ids: string[]): void;
  patchElements(pageId: string, patches: { id: string; before: PageElement; after: PageElement }[], label?: string): void;
  clearPage(pageId: string): void;
  setSelection(sel: { pageId: string; ids: string[] } | null): void;
  copySelection(): void;
  cutSelection(): void;
  pasteClipboard(pageId: string, at?: { x: number; y: number }): boolean;
  deleteSelection(): void;
  duplicateSelection(): void;
  recolorSelection(hex: string): void;
  undo(): void;
  redo(): void;
  pushCmd(cmd: Cmd, pages: string[]): void;

  saveDocNow(pageId: string): Promise<void>;
  markDirty(pageId: string): void;

  updatePage(pageId: string, patch: Partial<PageRow>): Promise<void>;
  /** infinity paper: grow the sheet so `els` (just added/moved) stay on paper —
   *  in ALL four directions (up/left via pads, right/down via width/height). */
  growInfinitePage(pageId: string, els: PageElement[]): Promise<void>;
  /** persist the current pan/zoom on the notebook so reopening restores it */
  saveNotebookVp(notebookId: string, vp: { scale: number; tx: number; ty: number }): Promise<void>;
  insertPage(afterIndex: number, template: TemplateId, backgroundHex?: string, backgroundImageId?: string | null, customTemplateImageId?: string | null): Promise<string>;
  deletePage(pageId: string): Promise<void>;
  duplicatePage(pageId: string): Promise<string>;
  reorderPages(orderedIds: string[]): Promise<void>;

  loadRecordings(pageId: string): Promise<void>;
  addRecording(rec: RecordingRow, blob: Blob): Promise<void>;
  removeRecording(id: string): Promise<void>;
  setActiveRecording(rec: { recId: string; startedAt: number } | null): void;
  setAudioState(patch: Partial<{ recId: string | null; playing: boolean; tMs: number; sync: boolean; replay: boolean }>): void;
  noteStrokeTimes(strokeId: string, absStart: number, absEnd: number): void;

  completeOnboarding(): Promise<void>;
}

// ---------------------------------------------------------------- autosave plumbing (module scope)
const dirtyPages = new Set<string>();
const saveTimers: Record<string, ReturnType<typeof setTimeout>> = {};
let saveWarned = false;

async function persistDoc(get: () => AppState, pageId: string) {
  const { editor } = get();
  const doc = editor.docs[pageId];
  const page = editor.pages.find((p) => p.id === pageId) ?? get().pages.find((p) => p.id === pageId);
  if (!doc || !page) return;
  try {
    await db.putPageDoc(pageId, doc);
    const textIndex = doc.elements
      .filter((e): e is Extract<PageElement, { kind: 'text' }> => e.kind === 'text')
      .map((e) => e.text).join(' \n ');
    const labels = page.labels.map((l) => l.title).join(' ');
    const updated: PageRow = { ...page, textIndex: `${textIndex} ${labels}`.trim(), updatedAt: Date.now() };
    await db.putPage(updated);
    // update in-memory copies
    const st = get();
    if (st.editor.pages.some((p) => p.id === pageId)) {
      useApp.setState({ editor: { ...st.editor, pages: st.editor.pages.map((p) => (p.id === pageId ? updated : p)) } });
    }
    const st2 = get();
    if (st2.pages.some((p) => p.id === pageId)) {
      useApp.setState({ pages: st2.pages.map((p) => (p.id === pageId ? updated : p)) });
    }
  } catch (e) {
    console.warn('[nanote] save failed', e);
    if (!saveWarned && e instanceof Error && /quota/i.test(e.message)) {
      saveWarned = true;
      import('sonner').then(({ toast }) => toast.error(translate(get().settings.lang, 'error.storageFull')));
    }
  }
}

const docClone = (doc: PageDoc): PageDoc => ({ version: 1, elements: [...doc.elements], sync: { ...doc.sync } });

// ---------------------------------------------------------------- v2 migration (one-time)
// Old model: flat top-level folders as the only grouping. New model: TABS are
// the top-level edge chips; folders nest inside tabs (folder→folder→notebooks).
// Migration: every existing folder becomes a tab; its notebooks move with it.
// Also links pre-v2 PDF imports to their stored original file (same-createdAt
// heuristic) so text selection can reach the text content later.
async function migrateTabsV2(): Promise<void> {
  const flag = await db.getMetaFlag('tabsV2');
  if (flag) return;
  const [folders, notebooks, pages, images] = await Promise.all([
    db.listFolders(), db.listNotebooks(), db.listPages(), db.listImages(),
  ]);
  for (const f of folders) {
    const tab: TabRow = {
      id: f.id, name: f.name, colorHex: f.colorHex, emoji: f.emoji,
      createdAt: f.createdAt, updatedAt: f.updatedAt, deletedAt: f.deletedAt,
    };
    await db.putTab(tab);
    for (const n of notebooks) {
      if (n.folderId === f.id) await db.putNotebook({ ...n, folderId: null, tabId: f.id });
    }
    await db.deleteFolderRow(f.id);
  }
  for (const nb of notebooks) {
    if (nb.pdfOriginalId != null) continue;
    const hasPdfPages = pages.some((p) => p.notebookId === nb.id && p.backgroundImageId);
    if (!hasPdfPages) continue;
    const orig = images.find((im) => im.createdAt === nb.createdAt && /\.pdf$/i.test(im.name));
    if (orig) await db.putNotebook({ ...nb, pdfOriginalId: orig.id });
  }
  await db.putMetaFlag('tabsV2', true);
}

export const useApp = create<AppState>((set, get) => ({

  booted: false,
  view: { name: 'boot' },
  history: [],

  settings: { ...DEFAULT_SETTINGS },

  folders: [],
  tabs: [],
  notebooks: [],
  tags: [],
  pages: [],
  pageCounts: {},
  libraryView: 'grid',
  sort: 'recent',
  searchQuery: '',

  editor: {
    notebookId: '',
    pages: [],
    activePageId: null,
    docs: {},
    docVersions: {},
    quarantine: {},
    tool: 'fountain',
    lastPen: 'fountain',
    toolStates: JSON.parse(JSON.stringify(DEFAULT_TOOL_STATES)),
    eraser: { mode: 'stroke', size: 24 },
    shape: { type: 'rect' as ShapeType, filled: false, color: '#16233A', width: 3 },
    highlighterStraight: false,
    textDefaults: { fontId: 'sans', size: 22, color: '#16233A', bold: false, italic: false, underline: false, align: 'start' },
    recentColors: ['#1E6FF2', '#16233A'],
    selection: null,
    clipboard: null,
    undoStack: [],
    redoStack: [],
    recordings: [],
    rulerVisible: false,
    toolbarHidden: false,
    activeRecording: null,
    audio: { recId: null, playing: false, tMs: 0, sync: true, replay: false },
  },

  // ------------------------------------------------------------ boot / nav
  async boot() {
    const settings = await db.loadSettings();
    // schema migrations for persisted prefs (v1 pen shortcuts → per-pattern
    // bindings; legacy laser/finger objects are normalized too)
    const migrated: Settings = {
      ...DEFAULT_SETTINGS,
      ...settings,
      penShortcuts: migratePenShortcuts(settings.penShortcuts),
      fingerGestures: { ...FINGER_GESTURES_DEFAULT, ...(settings.fingerGestures ?? {}) },
    };
    set({ settings: migrated });
    // manual pen profile override → pen engine (label + capability hints)
    setPenProfile(migrated.penProfileId ?? 'auto');
    try { await migrateTabsV2() } catch (e) { console.warn('[nanote] migration failed', e) }
    try { await db.purgeTrash() } catch (e) { console.warn('[nanote] purge failed', e) }
    // UNLIMITED STORAGE: ask the platform to mark our quota as persistent —
    // the browser/WebView then treats the app's data as exempt from
    // automatic eviction, with no size cap beyond the device's own disk.
    try { void navigator.storage?.persist?.().catch(() => {}) } catch { /* best-effort */ }
    const [folders, tabs, notebooks, tags, pages] = await Promise.all([
      db.listFolders(), db.listTabs(), db.listNotebooks(), db.listTags(), db.listPages(),
    ]);
    const pageCounts: Record<string, number> = {};
    for (const p of pages) if (!p.notebookId) continue; else pageCounts[p.notebookId] = (pageCounts[p.notebookId] ?? 0) + 1;
    set({
      booted: true,
      folders: folders.sort((a, b) => a.name.localeCompare(b.name)),
      tabs: tabs.sort((a, b) => a.name.localeCompare(b.name)),
      notebooks: notebooks.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt),
      tags,
      pages,
      pageCounts,
      libraryView: migrated.defaultView,
      view: migrated.onboarded ? { name: 'library' } : { name: 'onboarding' },
      history: [],
    });
    // Session restore: if the app died while a notebook was open (killed in the
    // background, tab discarded, page refresh), reopen that notebook — the
    // user comes back to the PDF they were reading, not the library.
    if (settings.onboarded) {
      const sessionId = recallSession();
      const sessionNb = sessionId ? notebooks.find((n) => n.id === sessionId && !n.deletedAt) : undefined;
      if (sessionNb) await get().openEditor(sessionNb.id);
    }
  },

  navigate(v) {
    const { view, history } = get();
    if (view.name === v.name && JSON.stringify(view) === JSON.stringify(v)) return;
    set({ view: v, history: [...history, view].slice(-20) });
  },

  goBack() {
    const { history } = get();
    if (history.length) {
      const prev = history[history.length - 1];
      set({ view: prev, history: history.slice(0, -1) });
    } else {
      set({ view: { name: 'library' }, history: [] });
    }
  },

  // ------------------------------------------------------------ settings
  async setSettings(patch) {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    await db.saveSettings(settings);
  },

  // ------------------------------------------------------------ library
  async refreshLibrary() {
    const [folders, tabs, notebooks, tags, pages] = await Promise.all([
      db.listFolders(), db.listTabs(), db.listNotebooks(), db.listTags(), db.listPages(),
    ]);
    const pageCounts: Record<string, number> = {};
    for (const p of pages) pageCounts[p.notebookId] = (pageCounts[p.notebookId] ?? 0) + 1;
    set({
      folders: folders.sort((a, b) => a.name.localeCompare(b.name)),
      tabs: tabs.sort((a, b) => a.name.localeCompare(b.name)),
      notebooks: notebooks.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt),
      tags, pages, pageCounts,
    });
  },

  setLibraryView(v) { set({ libraryView: v }) },
  setSort(s) { set({ sort: s }) },
  setSearchQuery(q) { set({ searchQuery: q }) },

  // ------------------------------------------------------------ tabs
  async createTab(name, emoji, colorHex) {
    const now = Date.now();
    const tab: TabRow = { id: uid(), name, colorHex, emoji, createdAt: now, updatedAt: now, deletedAt: null };
    await db.putTab(tab);
    await get().refreshLibrary();
    return tab.id;
  },

  async updateTab(id, patch) {
    const tb = get().tabs.find((x) => x.id === id);
    if (!tb) return;
    await db.putTab({ ...tb, ...patch, updatedAt: Date.now() });
    await get().refreshLibrary();
  },

  async renameTab(id, name) { await get().updateTab(id, { name }) },

  async trashTab(id) {
    const now = Date.now();
    const { folders, notebooks } = get();
    const tb = get().tabs.find((x) => x.id === id);
    if (!tb) return;
    await db.putTab({ ...tb, deletedAt: now, updatedAt: now });
    // the whole subtree goes with it: folders of this tab + notebooks of this tab
    for (const f of folders) {
      if (f.tabId === id && f.deletedAt == null) await db.putFolder({ ...f, deletedAt: now, updatedAt: now });
    }
    for (const n of notebooks) {
      if (n.tabId === id && n.deletedAt == null) await db.putNotebook({ ...n, deletedAt: now, updatedAt: now });
    }
    await get().refreshLibrary();
  },

  async restoreTab(id) {
    const { folders, notebooks } = get();
    const now = Date.now();
    const tb = get().tabs.find((x) => x.id === id);
    if (!tb) return;
    if (tb.deletedAt != null) await db.putTab({ ...tb, deletedAt: null, updatedAt: now });
    for (const f of folders) {
      if (f.tabId === id && f.deletedAt != null) await db.putFolder({ ...f, deletedAt: null, updatedAt: now });
    }
    for (const n of notebooks) {
      if (n.tabId === id && n.deletedAt != null) await db.putNotebook({ ...n, deletedAt: null, updatedAt: now });
    }
    await get().refreshLibrary();
  },

  async purgeTab(id) {
    const { folders, notebooks } = get();
    for (const n of notebooks) {
      if (n.tabId === id) await get().purgeNotebook(n.id);
    }
    for (const f of folders) {
      if (f.tabId === id) await db.deleteFolderRow(f.id);
    }
    await db.deleteTabRow(id);
    await get().refreshLibrary();
  },

  async createFolder(name, parentId, emoji, colorHex, tabId) {
    const now = Date.now();
    // nested folders inherit their tab from the parent folder
    const parent = parentId ? get().folders.find((f) => f.id === parentId) : undefined;
    const folder: FolderRow = {
      id: uid(), name, parentId, tabId: parent ? parent.tabId : tabId,
      colorHex, emoji, createdAt: now, updatedAt: now, isFavorite: false, deletedAt: null,
    };
    await db.putFolder(folder);
    await get().refreshLibrary();
    return folder.id;
  },

  async updateFolder(id, patch) {
    const f = get().folders.find((x) => x.id === id);
    if (!f) return;
    const next = { ...f, ...patch, updatedAt: Date.now() };
    await db.putFolder(next);
    await get().refreshLibrary();
  },

  async renameFolder(id, name) { await get().updateFolder(id, { name }) },
  async moveFolder(id, parentId) {
    // never allow cycles: a folder cannot be moved into its own subtree
    const { folders } = get();
    let cur: string | null = parentId;
    while (cur) {
      if (cur === id) return; // would create a cycle
      cur = folders.find((f) => f.id === cur)?.parentId ?? null;
    }
    const target = parentId ? folders.find((f) => f.id === parentId) : undefined;
    // moving into a folder of another tab carries the subtree into that tab
    const own = folders.find((f) => f.id === id);
    await get().updateFolder(id, { parentId, tabId: target ? target.tabId : own?.tabId ?? null });
  },

  async trashFolder(id) {
    const now = Date.now();
    const { folders, notebooks } = get();
    const descend = (fid: string, acc: string[]) => {
      acc.push(fid);
      for (const f of folders) if (f.parentId === fid) descend(f.id, acc);
      return acc;
    };
    const ids = descend(id, []);
    for (const fid of ids) {
      const f = folders.find((x) => x.id === fid);
      if (f) await db.putFolder({ ...f, deletedAt: now, updatedAt: now });
    }
    for (const n of notebooks) {
      if (n.folderId && ids.includes(n.folderId) && n.deletedAt == null) {
        await db.putNotebook({ ...n, deletedAt: now, updatedAt: now });
      }
    }
    await get().refreshLibrary();
  },

  async restoreFolder(id) {
    const { folders, notebooks } = get();
    const now = Date.now();
    const descend = (fid: string, acc: string[]) => {
      acc.push(fid);
      for (const f of folders) if (f.parentId === fid) descend(f.id, acc);
      return acc;
    };
    const ids = descend(id, []);
    for (const fid of ids) {
      const f = folders.find((x) => x.id === fid);
      if (f && f.deletedAt != null) await db.putFolder({ ...f, deletedAt: null, updatedAt: now });
    }
    for (const n of notebooks) {
      if (n.folderId && ids.includes(n.folderId) && n.deletedAt != null) {
        await db.putNotebook({ ...n, deletedAt: null, updatedAt: now });
      }
    }
    await get().refreshLibrary();
  },

  async purgeFolder(id) {
    const { folders, notebooks } = get();
    const descend = (fid: string, acc: string[]) => {
      acc.push(fid);
      for (const f of folders) if (f.parentId === fid) descend(f.id, acc);
      return acc;
    };
    const ids = descend(id, []);
    const doomedNb = notebooks.filter((n) => n.folderId && ids.includes(n.folderId));
    for (const n of doomedNb) await get().purgeNotebook(n.id);
    for (const fid of ids) await db.deleteFolderRow(fid);
    await get().refreshLibrary();
  },

  // ------------------------------------------------------------ notebooks
  async createNotebook(input) {
    const now = Date.now();
    const notebook: NotebookRow = {
      id: uid(),
      folderId: input.folderId,
      tabId: input.tabId ?? null,
      pdfOriginalId: null,
      title: input.title,
      coverId: input.coverId,
      coverCustomId: input.coverCustomId,
      defaultTemplate: input.template,
      pageSize: input.pageSize,
      backgroundHex: input.backgroundHex,
      createdAt: now, updatedAt: now, lastOpenedAt: now,
      isFavorite: false, deletedAt: null,
      sortOrder: get().notebooks.length,
      tagIds: [],
    };
    await db.putNotebook(notebook);
    const page: PageRow = {
      id: uid(),
      notebookId: notebook.id,
      pageIndex: 0,
      template: input.template,
      backgroundHex: input.backgroundHex,
      customTemplateImageId: input.customTemplateImageId ?? null,
      backgroundImageId: null,
      isBookmarked: false,
      labels: [],
      createdAt: now, updatedAt: now,
      textIndex: '',
      height: input.pageSize === 'infinite' ? 1123 : (input.pageSize === 'a4l' ? 794 : input.pageSize === 'letter' ? 1054 : 1123),
      // infinity paper starts as a wide square canvas and keeps growing while you write
      width: input.pageSize === 'infinite' ? 1123 : null,
    };
    await db.putPage(page);
    await db.putPageDoc(page.id, emptyDoc());
    await get().refreshLibrary();
    return notebook.id;
  },

  async updateNotebook(id, patch) {
    // IMPORTANT: fall back to IndexedDB when the row is not in the in-memory
    // list yet. PDF imports (and any future writer that goes straight to IDB)
    // create notebooks the Zustand cache has never seen — without this
    // fallback, moves/patches silently no-op'd and imported PDFs "fell out"
    // of the tab/folder they were imported into.
    let n = get().notebooks.find((x) => x.id === id);
    if (!n) n = (await db.getNotebook(id)) ?? undefined;
    if (!n) return;
    const next = { ...n, ...patch, updatedAt: Date.now() };
    await db.putNotebook(next);
    await get().refreshLibrary();
  },

  async renameNotebook(id, title) { await get().updateNotebook(id, { title }) },

  async moveNotebook(id, folderId) {
    // moving into a folder also moves the notebook into that folder's tab
    const { folders } = get();
    const target = folderId ? folders.find((f) => f.id === folderId) : undefined;
    await get().updateNotebook(id, {
      folderId,
      tabId: target ? target.tabId : get().notebooks.find((n) => n.id === id)?.tabId ?? null,
    });
  },

  async moveNotebookToTab(id, tabId) {
    // moving to a tab lands at that tab's root (no folder)
    await get().updateNotebook(id, { tabId, folderId: null });
  },

  async toggleFavoriteNotebook(id) {
    const n = get().notebooks.find((x) => x.id === id);
    if (!n) return;
    await get().updateNotebook(id, { isFavorite: !n.isFavorite });
  },

  async duplicateNotebook(id) {
    const src = get().notebooks.find((x) => x.id === id);
    if (!src) return '';
    const pages = get().pages.filter((p) => p.notebookId === id).sort((a, b) => a.pageIndex - b.pageIndex);
    const now = Date.now();
    const copy: NotebookRow = {
      ...src, id: uid(), title: `${src.title} — ${get().settings.lang === 'ar' ? 'نسخة' : 'copy'}`,
      createdAt: now, updatedAt: now, lastOpenedAt: now, deletedAt: null,
      sortOrder: get().notebooks.length,
    };
    await db.putNotebook(copy);
    for (const p of pages) {
      const np: PageRow = { ...p, id: uid(), notebookId: copy.id, createdAt: now, updatedAt: now };
      const { doc } = await db.getPageDoc(p.id);
      await db.putPage(np);
      if (doc) await db.putPageDoc(np.id, doc);
      const thumb = await db.getThumb(p.id);
      if (thumb) await db.putThumb({ pageId: np.id, dataUrl: thumb.dataUrl, updatedAt: now });
    }
    await get().refreshLibrary();
    return copy.id;
  },

  async trashNotebook(id) {
    const n = get().notebooks.find((x) => x.id === id);
    if (!n) return;
    await db.putNotebook({ ...n, deletedAt: Date.now(), updatedAt: Date.now() });
    await get().refreshLibrary();
  },

  async restoreNotebook(id) {
    const n = get().notebooks.find((x) => x.id === id);
    if (!n) return;
    await db.putNotebook({ ...n, deletedAt: null, updatedAt: Date.now() });
    // restore the parent chain: folders, then the tab the notebook belongs to
    const { folders, tabs } = get();
    let pid = n.folderId;
    while (pid) {
      const f = folders.find((x) => x.id === pid);
      if (!f || f.deletedAt == null) break;
      await db.putFolder({ ...f, deletedAt: null, updatedAt: Date.now() });
      pid = f.parentId;
    }
    const tb = tabs.find((x) => x.id === n.tabId);
    if (tb && tb.deletedAt != null) {
      await db.putTab({ ...tb, deletedAt: null, updatedAt: Date.now() });
      for (const f of folders) {
        if (f.tabId === tb.id && f.deletedAt != null) await db.putFolder({ ...f, deletedAt: null, updatedAt: Date.now() });
      }
    }
    await get().refreshLibrary();
  },

  async purgeNotebook(id) {
    const pages = get().pages.filter((p) => p.notebookId === id);
    const recs = await db.listRecordings();
    for (const p of pages) {
      if (p.backgroundImageId) await db.deleteImage(p.backgroundImageId);
      if (p.customTemplateImageId) await db.deleteImage(p.customTemplateImageId);
      await db.deletePageDoc(p.id);
      await db.deletePdfText(p.id);
      await db.deleteThumb(p.id);
      await db.deletePageRow(p.id);
      const { evictCachedRasters } = await import('./rastercache');
      void evictCachedRasters(p.id);
    }
    const nb = get().notebooks.find((x) => x.id === id);
    if (nb?.coverCustomId) await db.deleteImage(nb.coverCustomId);
    if (nb?.pdfOriginalId) await db.deleteImage(nb.pdfOriginalId);
    for (const r of recs) {
      if (r.notebookId === id) {
        await db.deleteAudio(r.id);
        await db.deleteRecording(r.id);
      }
    }
    await db.deleteNotebookRow(id);
    await get().refreshLibrary();
  },

  // ------------------------------------------------------------ tags
  async createTag(name, colorHex) {
    const tag: TagRow = { id: uid(), name, colorHex };
    await db.putTag(tag);
    await get().refreshLibrary();
    return tag;
  },

  async deleteTag(id) {
    await db.deleteTag(id);
    const { notebooks } = get();
    for (const n of notebooks) {
      if (n.tagIds.includes(id)) await db.putNotebook({ ...n, tagIds: n.tagIds.filter((t) => t !== id), updatedAt: Date.now() });
    }
    await get().refreshLibrary();
  },

  async setNotebookTags(notebookId, tagIds) {
    await get().updateNotebook(notebookId, { tagIds });
  },

  // ------------------------------------------------------------ editor session
  async openEditor(notebookId) {
    // IDB fallback for notebooks created outside the in-memory cache (imports)
    let nb = get().notebooks.find((x) => x.id === notebookId);
    if (!nb) nb = (await db.getNotebook(notebookId)) ?? undefined;
    if (!nb) return;
    await db.putNotebook({ ...nb, lastOpenedAt: Date.now(), updatedAt: Date.now() });
    const pages = get().pages.filter((p) => p.notebookId === notebookId).sort((a, b) => a.pageIndex - b.pageIndex);
    // Per-file reading memory: reopen on the last page the user was reading.
    const remembered = pages.find((p) => p.id === recallPage(notebookId));
    const startPage = remembered ?? pages[0];
    if (startPage) rememberPage(notebookId, startPage.id);
    rememberSession(notebookId);
    set({
      editor: {
        ...get().editor,
        notebookId,
        pages,
        activePageId: startPage?.id ?? null,
        docs: {},
        docVersions: {},
        quarantine: {},
        selection: null,
        clipboard: null,
        undoStack: [],
        redoStack: [],
        recordings: [],
        rulerVisible: false,
        toolbarHidden: false,
        highlighterStraight: false,
        activeRecording: null,
        audio: { recId: null, playing: false, tMs: 0, sync: true, replay: false },
        textDefaults: { ...get().editor.textDefaults },
      },
    });
    if (startPage) await get().ensureDoc(startPage.id);
    get().navigate({ name: 'editor', notebookId });
  },

  closeEditor() {
    get().flushSaves();
    // an explicit exit ends the session — the next cold boot shows the library
    clearSession();
    get().navigate({ name: 'library' });
  },

  flushSaves() {
    const ids = [...dirtyPages];
    for (const id of ids) {
      const timer = saveTimers[id];
      if (timer) { clearTimeout(timer); delete saveTimers[id] }
      void persistDoc(get, id);
      dirtyPages.delete(id);
    }
  },

  async ensureDoc(pageId) {
    const { editor } = get();
    if (editor.docs[pageId]) return editor.docs[pageId];
    const { doc, quarantined } = await db.getPageDoc(pageId);
    const resolved = doc ?? emptyDoc();
    set({
      editor: {
        ...get().editor,
        docs: { ...get().editor.docs, [pageId]: resolved },
        quarantine: { ...get().editor.quarantine, [pageId]: quarantined },
      },
    });
    return resolved;
  },

  // ------------------------------------------------------------ tool state
  setTool(tool) {
    const ed = get().editor;
    const penTools: ToolId[] = ['fountain', 'ballpoint', 'brush', 'fineliner'];
    const lastPen = penTools.includes(tool as ToolId) ? (tool as ToolId) : ed.lastPen;
    set({ editor: { ...ed, tool, lastPen, selection: tool === 'lasso' ? ed.selection : null } });
  },

  setToolState(tool, patch) {
    const ed = get().editor;
    set({ editor: { ...ed, toolStates: { ...ed.toolStates, [tool]: { ...ed.toolStates[tool], ...patch } } } });
  },

  setEraser(patch) {
    const ed = get().editor;
    set({ editor: { ...ed, eraser: { ...ed.eraser, ...patch } } });
  },

  setShape(patch) {
    const ed = get().editor;
    set({ editor: { ...ed, shape: { ...ed.shape, ...patch } } });
  },

  setHighlighterStraight(v) {
    const ed = get().editor;
    set({ editor: { ...ed, highlighterStraight: v } });
  },

  setTextDefaults(patch) {
    const ed = get().editor;
    set({ editor: { ...ed, textDefaults: { ...ed.textDefaults, ...patch } } });
  },

  pushRecentColor(hex) {
    const ed = get().editor;
    const recent = [hex, ...ed.recentColors.filter((c) => c !== hex)].slice(0, 8);
    set({ editor: { ...ed, recentColors: recent } });
  },

  toggleRuler() {
    const ed = get().editor;
    set({ editor: { ...ed, rulerVisible: !ed.rulerVisible } });
  },

  toggleToolbar() {
    const ed = get().editor;
    set({ editor: { ...ed, toolbarHidden: !ed.toolbarHidden } });
  },

  setActivePage(pageId) {
    const ed = get().editor;
    if (ed.activePageId === pageId) return;
    set({ editor: { ...ed, activePageId: pageId } });
    // per-file memory: remember where the user is reading
    if (ed.notebookId) rememberPage(ed.notebookId, pageId);
  },

  // ------------------------------------------------------------ doc mutation + undo
  pushCmd(cmd, pages) {
    const ed = get().editor;
    // remember the affected pages ON the command — undo()/redo() must re-mark
    // them dirty or the reverted state would never persist (data loss on reload)
    const full: Cmd = { ...cmd, pages };
    const undoStack = [...ed.undoStack, full].slice(-UNDO_LIMIT);
    full.run();
    set({ editor: { ...get().editor, undoStack, redoStack: [] } });
    for (const p of pages) get().markDirty(p);
  },

  addElements(pageId, els, opts) {
    const undoable = opts?.undoable ?? true;
    const ed = get().editor;
    const doc = ed.docs[pageId];
    if (!doc) return;
    const add = () => {
      const d = docClone(get().editor.docs[pageId]);
      d.elements = [...d.elements, ...els.map((e) => ({ ...e }))];
      set({ editor: { ...get().editor, docs: { ...get().editor.docs, [pageId]: d }, docVersions: { ...get().editor.docVersions, [pageId]: (get().editor.docVersions[pageId] ?? 0) + 1 } } });
    };
    const remove = () => {
      const d = docClone(get().editor.docs[pageId]);
      const ids = new Set(els.map((e) => e.id));
      d.elements = d.elements.filter((e) => !ids.has(e.id));
      set({ editor: { ...get().editor, docs: { ...get().editor.docs, [pageId]: d }, docVersions: { ...get().editor.docVersions, [pageId]: (get().editor.docVersions[pageId] ?? 0) + 1 } } });
    };
    if (undoable) get().pushCmd({ label: 'add', run: add, revert: remove }, [pageId]);
    else { add(); get().markDirty(pageId) }
    // dev-only probe: lets E2E verification observe what was committed
    // (element kinds, stroke timestamps…) without touching production builds
    if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
      (window as unknown as { __nanoteProbe?: (info: { pageId: string; els: PageElement[] }) => void })
        .__nanoteProbe?.({ pageId, els });
    }
    // infinity paper: the sheet chases the content in ALL four directions —
    // strokes, text, shapes, images and pastes can all grow it (up/left pads,
    // right/down width/height). Covers every commit path in one place.
    void get().growInfinitePage(pageId, els);
  },

  removeElements(pageId, ids) {
    const ed = get().editor;
    const doc = ed.docs[pageId];
    if (!doc) return;
    const removed = doc.elements.filter((e) => ids.includes(e.id));
    if (!removed.length) return;
    const remove = () => {
      const d = docClone(get().editor.docs[pageId]);
      const s = new Set(ids);
      d.elements = d.elements.filter((e) => !s.has(e.id));
      set({ editor: { ...get().editor, docs: { ...get().editor.docs, [pageId]: d }, docVersions: { ...get().editor.docVersions, [pageId]: (get().editor.docVersions[pageId] ?? 0) + 1 } } });
    };
    const restore = () => {
      const d = docClone(get().editor.docs[pageId]);
      d.elements = [...d.elements, ...removed.map((e) => ({ ...e }))];
      set({ editor: { ...get().editor, docs: { ...get().editor.docs, [pageId]: d }, docVersions: { ...get().editor.docVersions, [pageId]: (get().editor.docVersions[pageId] ?? 0) + 1 } } });
    };
    get().pushCmd({ label: 'remove', run: remove, revert: restore }, [pageId]);
    const sel = get().editor.selection;
    if (sel && sel.pageId === pageId) set({ editor: { ...get().editor, selection: null } });
  },

  patchElements(pageId, patches, label) {
    const ed = get().editor;
    const doc = ed.docs[pageId];
    if (!doc || !patches.length) return;
    const forward = () => {
      const d = docClone(get().editor.docs[pageId]);
      const map = new Map(patches.map((p) => [p.id, p.after]));
      d.elements = d.elements.map((e) => (map.has(e.id) ? { ...(map.get(e.id) as PageElement) } : e));
      set({ editor: { ...get().editor, docs: { ...get().editor.docs, [pageId]: d }, docVersions: { ...get().editor.docVersions, [pageId]: (get().editor.docVersions[pageId] ?? 0) + 1 } } });
    };
    const backward = () => {
      const d = docClone(get().editor.docs[pageId]);
      const map = new Map(patches.map((p) => [p.id, p.before]));
      d.elements = d.elements.map((e) => (map.has(e.id) ? { ...(map.get(e.id) as PageElement) } : e));
      set({ editor: { ...get().editor, docs: { ...get().editor.docs, [pageId]: d }, docVersions: { ...get().editor.docVersions, [pageId]: (get().editor.docVersions[pageId] ?? 0) + 1 } } });
    };
    get().pushCmd({ label: label ?? 'patch', run: forward, revert: backward }, [pageId]);
    // lasso moves / duplicates can drag content into fresh territory — the
    // endless sheet grows to keep every element on paper
    void get().growInfinitePage(pageId, patches.map((p) => p.after));
  },

  clearPage(pageId) {
    const ed = get().editor;
    const doc = ed.docs[pageId];
    if (!doc || !doc.elements.length) return;
    const snapshot = doc.elements.map((e) => ({ ...e }) as PageElement);
    const syncSnapshot = { ...doc.sync };
    const clear = () => {
      const d: PageDoc = { version: 1, elements: [], sync: { ...syncSnapshot } };
      set({ editor: { ...get().editor, docs: { ...get().editor.docs, [pageId]: d }, docVersions: { ...get().editor.docVersions, [pageId]: (get().editor.docVersions[pageId] ?? 0) + 1 } } });
    };
    const restore = () => {
      const d: PageDoc = { version: 1, elements: snapshot.map((e) => ({ ...e }) as PageElement), sync: { ...syncSnapshot } };
      set({ editor: { ...get().editor, docs: { ...get().editor.docs, [pageId]: d }, docVersions: { ...get().editor.docVersions, [pageId]: (get().editor.docVersions[pageId] ?? 0) + 1 } } });
    };
    get().pushCmd({ label: 'clear', run: clear, revert: restore }, [pageId]);
  },

  setSelection(sel) {
    set({ editor: { ...get().editor, selection: sel } });
  },

  copySelection() {
    const { selection, docs } = get().editor;
    if (!selection) return;
    const doc = docs[selection.pageId];
    if (!doc) return;
    const els = doc.elements.filter((e) => selection.ids.includes(e.id)).map((e) => ({ ...e }) as PageElement);
    set({ editor: { ...get().editor, clipboard: els } });
  },

  cutSelection() {
    const { selection } = get().editor;
    if (!selection) return;
    get().copySelection();
    get().removeElements(selection.pageId, selection.ids);
  },

  pasteClipboard(pageId, at) {
    const { clipboard, docs } = get().editor;
    const doc = docs[pageId];
    if (!clipboard || !doc || !clipboard.length) return false;
    // paste centered at `at` if given
    let dx = 24, dy = 24;
    if (at) {
      const bboxes = clipboard.map((e) => elementBBoxLocal(e));
      const xs = bboxes.flatMap((b) => [b.x0, b.x1]);
      const ys = bboxes.flatMap((b) => [b.y0, b.y1]);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      dx = at.x - cx; dy = at.y - cy;
    }
    let z = doc.elements.reduce((m, e) => Math.max(m, e.z), 0);
    const pasted = clipboard.map((e) => {
      const copy = moveElLocal({ ...e } as PageElement, dx, dy);
      copy.id = uid();
      copy.z = ++z;
      return copy;
    });
    get().addElements(pageId, pasted);
    set({ editor: { ...get().editor, selection: { pageId, ids: pasted.map((e) => e.id) } } });
    return true;
  },

  deleteSelection() {
    const { selection } = get().editor;
    if (!selection) return;
    get().removeElements(selection.pageId, selection.ids);
  },

  duplicateSelection() {
    const { selection, docs } = get().editor;
    if (!selection) return;
    const doc = docs[selection.pageId];
    if (!doc) return;
    const els = doc.elements.filter((e) => selection.ids.includes(e.id));
    if (!els.length) return;
    let z = doc.elements.reduce((m, e) => Math.max(m, e.z), 0);
    const copies = els.map((e) => {
      const copy = moveElLocal({ ...e } as PageElement, 24, 24);
      copy.id = uid();
      copy.z = ++z;
      return copy;
    });
    get().addElements(selection.pageId, copies);
    set({ editor: { ...get().editor, selection: { pageId: selection.pageId, ids: copies.map((e) => e.id) } } });
  },

  recolorSelection(hex) {
    const { selection, docs } = get().editor;
    if (!selection) return;
    const doc = docs[selection.pageId];
    if (!doc) return;
    const patches: { id: string; before: PageElement; after: PageElement }[] = [];
    for (const e of doc.elements) {
      if (!selection.ids.includes(e.id)) continue;
      if (e.kind === 'stroke' || e.kind === 'text') {
        if (e.color !== hex) patches.push({ id: e.id, before: e, after: { ...e, color: hex } });
      } else if (e.kind === 'shape') {
        const after = e.fill != null ? { ...e, stroke: hex, fill: hex } : { ...e, stroke: hex };
        patches.push({ id: e.id, before: e, after });
      }
    }
    if (patches.length) get().patchElements(selection.pageId, patches, 'recolor');
  },

  undo() {
    const ed = get().editor;
    if (!ed.undoStack.length) return;
    const cmd = ed.undoStack[ed.undoStack.length - 1];
    cmd.revert();
    // the reverted doc must reach disk — without this, undoing an erase and
    // reloading brought the erased state back (real data loss)
    for (const p of cmd.pages ?? []) get().markDirty(p);
    set({ editor: { ...get().editor, undoStack: ed.undoStack.slice(0, -1), redoStack: [...get().editor.redoStack, cmd] } });
  },

  redo() {
    const ed = get().editor;
    if (!ed.redoStack.length) return;
    const cmd = ed.redoStack[ed.redoStack.length - 1];
    cmd.run();
    for (const p of cmd.pages ?? []) get().markDirty(p);
    set({ editor: { ...get().editor, redoStack: ed.redoStack.slice(0, -1), undoStack: [...get().editor.undoStack, cmd] } });
  },

  // ------------------------------------------------------------ autosave
  markDirty(pageId) {
    dirtyPages.add(pageId);
    const ms = get().settings.autosaveMs || 0;
    const existing = saveTimers[pageId];
    if (existing) clearTimeout(existing);
    if (ms === 0) {
      void persistDoc(get, pageId);
      dirtyPages.delete(pageId);
    } else {
      saveTimers[pageId] = setTimeout(() => {
        delete saveTimers[pageId];
        dirtyPages.delete(pageId);
        void persistDoc(get, pageId);
      }, ms);
    }
  },

  async saveDocNow(pageId) {
    const t = saveTimers[pageId];
    if (t) { clearTimeout(t); delete saveTimers[pageId] }
    dirtyPages.delete(pageId);
    await persistDoc(get, pageId);
  },

  // ------------------------------------------------------------ pages
  async updatePage(pageId, patch) {
    const ed = get().editor;
    const inEditor = ed.pages.find((p) => p.id === pageId);
    const target = inEditor ?? get().pages.find((p) => p.id === pageId);
    if (!target) return;
    const updated = { ...target, ...patch, updatedAt: Date.now() };
    await db.putPage(updated);
    set({
      pages: get().pages.map((p) => (p.id === pageId ? updated : p)),
      editor: { ...get().editor, pages: ed.pages.map((p) => (p.id === pageId ? updated : p)) },
    });
  },

  async growInfinitePage(pageId, els) {
    const st = get();
    const nb = st.notebooks.find((n) => n.id === st.editor.notebookId);
    if (nb?.pageSize !== 'infinite' || !els.length) return;
    const page = st.editor.pages.find((p) => p.id === pageId);
    if (!page || page.notebookId !== nb.id) return;
    // bounds of the freshly committed elements (existing content is already
    // inside the sheet — checking only the newcomers keeps this O(new), so
    // even huge documents grow instantly)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const el of els) {
      const b = elementBBox(el);
      if (b.x0 < minX) minX = b.x0;
      if (b.y0 < minY) minY = b.y0;
      if (b.x1 > maxX) maxX = b.x1;
      if (b.y1 > maxY) maxY = b.y1;
    }
    if (minX === Infinity) return;
    const M = INFINITE_GROW_MARGIN;
    const step = INFINITE_GROW_STEP;
    const padX0 = page.padX ?? 0;
    const padY0 = page.padY ?? 0;
    const w0 = page.width ?? 1123;
    const h0 = page.height ?? 1123;
    const patch: Partial<PageRow> = {};
    // up / left — the sheet extends past the origin into negative space
    if (minY - M < -padY0) patch.padY = Math.max(padY0 + step, Math.ceil((-(minY - M)) / step) * step);
    if (minX - M < -padX0) patch.padX = Math.max(padX0 + step, Math.ceil((-(minX - M)) / step) * step);
    // down / right — classic growth, but sized to actually cover far runs
    if (maxY + M > h0) patch.height = Math.max(h0 + step, Math.ceil((maxY + M) / step) * step);
    if (maxX + M > w0) patch.width = Math.max(w0 + step, Math.ceil((maxX + M) / step) * step);
    if (patch.padY !== undefined || patch.padX !== undefined || patch.height !== undefined || patch.width !== undefined) {
      await get().updatePage(pageId, patch);
    }
  },

  async saveNotebookVp(notebookId, vp) {
    let nb = get().notebooks.find((x) => x.id === notebookId);
    if (!nb) nb = (await db.getNotebook(notebookId)) ?? undefined;
    if (!nb) return;
    await db.putNotebook({ ...nb, lastVp: vp });
    set({ notebooks: get().notebooks.map((n) => (n.id === notebookId ? { ...n, lastVp: vp } : n)) });
  },

  async insertPage(afterIndex, template, backgroundHex, backgroundImageId, customTemplateImageId) {
    const ed = get().editor;
    const nb = get().notebooks.find((x) => x.id === ed.notebookId);
    if (!nb) return '';
    const now = Date.now();
    const pages = [...ed.pages].sort((a, b) => a.pageIndex - b.pageIndex);
    const templateLike = pages[Math.min(afterIndex, pages.length - 1)];
    const page: PageRow = {
      id: uid(),
      notebookId: nb.id,
      pageIndex: afterIndex + 1,
      template,
      backgroundHex: backgroundHex ?? templateLike?.backgroundHex ?? nb.backgroundHex,
      customTemplateImageId: customTemplateImageId ?? null,
      backgroundImageId: backgroundImageId ?? null,
      isBookmarked: false,
      labels: [],
      createdAt: now, updatedAt: now,
      textIndex: '',
      height: templateLike?.height ?? (nb.pageSize === 'a4l' ? 794 : nb.pageSize === 'letter' ? 1054 : 1123),
    };
    // reindex
    const shifted = pages.map((p) => (p.pageIndex > afterIndex ? { ...p, pageIndex: p.pageIndex + 1 } : p));
    for (const p of shifted) if (p.pageIndex !== pages.find((o) => o.id === p.id)!.pageIndex) await db.putPage(p);
    await db.putPage(page);
    await db.putPageDoc(page.id, emptyDoc());
    const newPages = [...shifted, page].sort((a, b) => a.pageIndex - b.pageIndex);
    set({
      pages: get().pages.map((p) => {
        const np = newPages.find((x) => x.id === p.id);
        return np ?? p;
      }).concat(get().pages.some((p) => p.id === page.id) ? [] : [page]),
      editor: { ...get().editor, pages: newPages },
      pageCounts: { ...get().pageCounts, [nb.id]: newPages.length },
    });
    await get().ensureDoc(page.id);
    // bump docVersions so the thumbnail pipeline renders the fresh page
    set((s) => ({ editor: { ...s.editor, docVersions: { ...s.editor.docVersions, [page.id]: (s.editor.docVersions[page.id] ?? 0) + 1 } } }));
    return page.id;
  },

  async deletePage(pageId) {
    const ed = get().editor;
    const pages = [...ed.pages].sort((a, b) => a.pageIndex - b.pageIndex);
    if (pages.length <= 1) return;
    const idx = pages.findIndex((p) => p.id === pageId);
    const target = pages[idx];
    if (target.backgroundImageId) await db.deleteImage(target.backgroundImageId);
    if (target.customTemplateImageId) await db.deleteImage(target.customTemplateImageId);
    const recs = await db.listRecordings();
    for (const r of recs) {
      if (r.pageId === pageId) { await db.deleteAudio(r.id); await db.deleteRecording(r.id) }
    }
    await db.deletePageRow(pageId);
    await db.deletePageDoc(pageId);
    await db.deletePdfText(pageId);
    await db.deleteThumb(pageId);
    const { evictCachedRasters } = await import('./rastercache');
    void evictCachedRasters(pageId);
    const remaining = pages.filter((p) => p.id !== pageId).map((p, i) => ({ ...p, pageIndex: i }));
    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i].pageIndex !== pages[i].pageIndex || remaining[i].id !== pages[i].id) await db.putPage(remaining[i]);
    }
    set({
      pages: get().pages.filter((p) => p.id !== pageId).map((p) => {
        const np = remaining.find((x) => x.id === p.id);
        return np ? { ...p, pageIndex: np.pageIndex } : p;
      }),
      editor: { ...get().editor, pages: remaining, activePageId: ed.activePageId === pageId ? remaining[Math.max(0, idx - 1)].id : ed.activePageId },
      pageCounts: { ...get().pageCounts, [ed.notebookId]: remaining.length },
    });
  },

  async duplicatePage(pageId) {
    const ed = get().editor;
    const src = ed.pages.find((p) => p.id === pageId);
    if (!src) return '';
    const pages = [...ed.pages].sort((a, b) => a.pageIndex - b.pageIndex);
    const now = Date.now();
    const copy: PageRow = { ...src, id: uid(), pageIndex: src.pageIndex + 1, createdAt: now, updatedAt: now };
    const shifted = pages.map((p) => (p.pageIndex > src.pageIndex ? { ...p, pageIndex: p.pageIndex + 1 } : p));
    for (const p of shifted) if (p.pageIndex !== pages.find((o) => o.id === p.id)!.pageIndex) await db.putPage(p);
    await db.putPage(copy);
    const { doc } = await db.getPageDoc(src.id);
    if (doc) await db.putPageDoc(copy.id, doc);
    const thumb = await db.getThumb(src.id);
    if (thumb) await db.putThumb({ pageId: copy.id, dataUrl: thumb.dataUrl, updatedAt: now });
    const newPages = [...shifted, copy].sort((a, b) => a.pageIndex - b.pageIndex);
    set({
      pages: [...get().pages.filter((p) => p.id !== pageId || true).map((p) => {
        const np = newPages.find((x) => x.id === p.id);
        return np ? { ...p, pageIndex: np.pageIndex } : p;
      }), ...(get().pages.some((p) => p.id === copy.id) ? [] : [copy])],
      editor: { ...get().editor, pages: newPages },
      pageCounts: { ...get().pageCounts, [ed.notebookId]: newPages.length },
    });
    await get().ensureDoc(copy.id);
    return copy.id;
  },

  async reorderPages(orderedIds) {
    const ed = get().editor;
    const pages = [...ed.pages].sort((a, b) => a.pageIndex - b.pageIndex);
    const byId = new Map(pages.map((p) => [p.id, p]));
    const reordered = orderedIds.map((id, i) => ({ ...(byId.get(id) as PageRow), pageIndex: i }));
    for (let i = 0; i < reordered.length; i++) {
      if (reordered[i].id !== pages[i].id || reordered[i].pageIndex !== pages[i].pageIndex) await db.putPage(reordered[i]);
    }
    set({
      pages: get().pages.map((p) => {
        const np = reordered.find((x) => x.id === p.id);
        return np ? { ...p, pageIndex: np.pageIndex } : p;
      }),
      editor: { ...get().editor, pages: reordered },
    });
  },

  // ------------------------------------------------------------ audio / recordings
  async loadRecordings(pageId) {
    const recs = (await db.listRecordings()).filter((r) => r.pageId === pageId);
    set({ editor: { ...get().editor, recordings: recs.sort((a, b) => b.createdAt - a.createdAt) } });
  },

  async addRecording(rec, blob) {
    await db.putAudio({ id: rec.id, blob });
    await db.putRecording(rec);
    set({ editor: { ...get().editor, recordings: [rec, ...get().editor.recordings] } });
  },

  async removeRecording(id) {
    await db.deleteAudio(id);
    await db.deleteRecording(id);
    set({ editor: { ...get().editor, recordings: get().editor.recordings.filter((r) => r.id !== id) } });
    const audio = get().editor.audio;
    if (audio.recId === id) set({ editor: { ...get().editor, audio: { ...audio, recId: null, playing: false, tMs: 0 } } });
  },

  setActiveRecording(rec) {
    set({ editor: { ...get().editor, activeRecording: rec } });
  },

  setAudioState(patch) {
    set({ editor: { ...get().editor, audio: { ...get().editor.audio, ...patch } } });
  },

  noteStrokeTimes(strokeId, absStart, absEnd) {
    const ed = get().editor;
    const rec = ed.activeRecording;
    if (!rec) return;
    const pageId = ed.activePageId;
    if (!pageId) return;
    const doc = ed.docs[pageId];
    if (!doc) return;
    const tStart = Math.max(0, absStart - rec.startedAt);
    const tEnd = Math.max(tStart, absEnd - rec.startedAt);
    const d = docClone(doc);
    d.sync[strokeId] = { recId: rec.recId, tStart, tEnd };
    set({ editor: { ...get().editor, docs: { ...get().editor.docs, [pageId]: d } } });
    get().markDirty(pageId);
  },

  // ------------------------------------------------------------ onboarding
  async completeOnboarding() {
    await get().setSettings({ onboarded: true });
    try {
      await seedWelcomeNotebook();
      await get().refreshLibrary();
    } catch (e) {
      console.warn('[nanote] seed failed', e);
    }
    get().navigate({ name: 'library' });
  },
}));

// ---------------------------------------------------------------- local helpers
function elementBBoxLocal(el: PageElement): { x0: number; y0: number; x1: number; y1: number } {
  // minimal bbox without importing geometry (avoid cycle) — full version in geometry.ts
  if (el.kind === 'stroke') {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of el.points) {
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
    }
    return { x0, y0, x1, y1 };
  }
  if (el.kind === 'text') {
    const lines = el.text.split('\n').length || 1;
    const h = lines * el.size * 1.35;
    return { x0: el.x, y0: el.y, x1: el.x + el.w, y1: el.y + h };
  }
  const x0 = Math.min(el.x, el.x + el.w), x1 = Math.max(el.x, el.x + el.w);
  const y0 = Math.min(el.y, el.y + el.h), y1 = Math.max(el.y, el.y + el.h);
  return { x0, y0, x1, y1 };
}

function moveElLocal<T extends PageElement>(el: T, dx: number, dy: number): T {
  if (el.kind === 'stroke') {
    return { ...el, points: el.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })) } as T;
  }
  return { ...el, x: el.x + dx, y: el.y + dy } as T;
}

// ---------------------------------------------------------------- hooks
export function useT() {
  const lang = useApp((s) => s.settings.lang);
  const t = useCallback(
    (key: string, enFallback?: string, arFallback?: string) => translate(lang, key, enFallback, arFallback),
    [lang],
  );
  return { t, lang, dir: (lang === 'ar' ? 'rtl' : 'ltr') as 'rtl' | 'ltr', isRTL: lang === 'ar', fmt };
}

export type { StrokeEl, ImageEl };
