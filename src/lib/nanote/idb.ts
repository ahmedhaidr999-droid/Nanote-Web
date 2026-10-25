// Nanote data layer — IndexedDB (the web equivalent of the spec's drift/SQLite schema).
// Stores map 1:1 to the spec's tables. Falls back to an in-memory adapter if
// IndexedDB is unavailable (e.g. storage blocked in an embedding context).
import { openDB, IDBPDatabase } from 'idb';
import {
  DEFAULT_SETTINGS, PageDoc, PageRow, PdfTextRec, RecordingRow, FolderRow, NotebookRow, Settings, TabRow, TagRow,
  TRASH_RETENTION_MS,
} from './types';
import { encodeDoc, decodeDoc } from './ink';
import { uid } from './util';

const DB_NAME = 'nanote';
const DB_VERSION = 2;

export interface ImageBlob { id: string; blob: Blob; w: number; h: number; name: string; createdAt: number }
export interface DocRec { pageId: string; data: ArrayBuffer }
export interface ThumbRec { pageId: string; dataUrl: string; updatedAt: number }
export interface QuarantineRec { id: string; pageId: string; size: number; at: number; reason: string }

let dbp: Promise<IDBPDatabase | null> | null = null;
let memoryMode = false;

// ------------------------------------------------------------------ fallback store
type Table = Map<string, unknown>;
const mem = {
  meta: new Map<string, unknown>(),
  folders: new Map<string, FolderRow>(),
  tabs: new Map<string, TabRow>(),
  notebooks: new Map<string, NotebookRow>(),
  pages: new Map<string, PageRow>(),
  pagedocs: new Map<string, DocRec>(),
  pdftext: new Map<string, PdfTextRec>(),
  thumbs: new Map<string, ThumbRec>(),
  images: new Map<string, ImageBlob>(),
  audio: new Map<string, { id: string; blob: Blob }>(),
  recordings: new Map<string, RecordingRow>(),
  tags: new Map<string, TagRow>(),
  quarantined: new Map<string, QuarantineRec>(),
};

export const isMemoryMode = () => memoryMode;

async function get(): Promise<IDBPDatabase | null> {
  if (memoryMode) return null;
  if (!dbp) {
    dbp = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        if (oldVersion < 1) {
          const f = db.createObjectStore('folders', { keyPath: 'id' });
          f.createIndex('deletedAt', 'deletedAt');
          const nb = db.createObjectStore('notebooks', { keyPath: 'id' });
          nb.createIndex('folderId', 'folderId');
          nb.createIndex('deletedAt', 'deletedAt');
          const pg = db.createObjectStore('pages', { keyPath: 'id' });
          pg.createIndex('notebookId', 'notebookId');
          db.createObjectStore('pagedocs', { keyPath: 'pageId' });
          db.createObjectStore('thumbs', { keyPath: 'pageId' });
          db.createObjectStore('images', { keyPath: 'id' });
          db.createObjectStore('audio', { keyPath: 'id' });
          const rc = db.createObjectStore('recordings', { keyPath: 'id' });
          rc.createIndex('pageId', 'pageId');
          db.createObjectStore('tags', { keyPath: 'id' });
          db.createObjectStore('quarantined', { keyPath: 'id' });
        }
        // v2: tabs (top-level library groupings) + cached PDF text layers.
        // NOTE: runs for fresh (v0) installs too — skipping it left brand-new
        // databases without 'tabs'/'pdftext', and boot()'s listTabs() then
        // threw NotFoundError and the app never finished booting.
        if (oldVersion < 2) {
          const tb = db.createObjectStore('tabs', { keyPath: 'id' });
          tb.createIndex('deletedAt', 'deletedAt');
          db.createObjectStore('pdftext', { keyPath: 'pageId' });
        }
      },
    }).catch((e) => { memoryMode = true; console.warn('[nanote] IndexedDB unavailable, using memory store', e); return null });
  }
  return dbp;
}

async function put<T>(store: keyof typeof mem, value: T & { id?: string }) {
  const d = await get();
  const key = (value as { id?: string }).id ?? (value as { pageId?: string }).pageId;
  if (d) {
    // 'meta' has no keyPath (out-of-line keys) — an explicit key is required;
    // every other store has a keyPath and must NOT receive one.
    if (store === 'meta') await d.put(store, value, key as string);
    else await d.put(store, value);
  } else {
    (mem[store] as Map<string, unknown>).set(key as string, value);
  }
}

async function del(store: keyof typeof mem, key: string) {
  const d = await get();
  if (d) await d.delete(store, key);
  else (mem[store] as Map<string, unknown>).delete(key);
}

async function getAll<T>(store: keyof typeof mem): Promise<T[]> {
  const d = await get();
  if (d) return (await d.getAll(store)) as T[];
  return [...(mem[store] as Map<string, T>).values()];
}

async function getOne<T>(store: keyof typeof mem, key: string): Promise<T | undefined> {
  const d = await get();
  if (d) return (await d.get(store, key)) as T | undefined;
  return (mem[store] as Map<string, T>).get(key);
}

// ------------------------------------------------------------------ settings (mirrored to localStorage for pre-hydration lang/dir/theme)
const LS_KEY = 'nanote.settings';

export async function loadSettings(): Promise<Settings> {
  let s = { ...DEFAULT_SETTINGS };
  const stored = await getOne<Settings>('meta', 'settings');
  if (stored) s = { ...s, ...stored };
  return s;
}

export async function saveSettings(s: Settings) {
  await put('meta', { id: 'settings', ...s } as unknown as { id: string });
  try { localStorage.setItem(LS_KEY, JSON.stringify({ lang: s.lang, theme: s.theme })) } catch { /* ignore */ }
}

export function readMirroredSettings(): { lang?: string; theme?: string } {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}') } catch { return {} }
}

/** small typed flags kept in the meta store (one-time migrations, feature marks) */
export async function getMetaFlag(key: string): Promise<boolean> {
  const rec = await getOne<{ id: string; value: boolean }>('meta', key);
  return rec?.value === true;
}
export async function putMetaFlag(key: string, value: boolean) {
  await put('meta', { id: key, value } as unknown as { id: string });
}

// ------------------------------------------------------------------ folders
export const listFolders = () => getAll<FolderRow>('folders');
export const putFolder = (f: FolderRow) => put('folders', f);
export const deleteFolderRow = (id: string) => del('folders', id);

// ------------------------------------------------------------------ tabs
export const listTabs = () => getAll<TabRow>('tabs');
export const putTab = (tb: TabRow) => put('tabs', tb);
export const deleteTabRow = (id: string) => del('tabs', id);

// ------------------------------------------------------------------ notebooks
export const listNotebooks = () => getAll<NotebookRow>('notebooks');
export const putNotebook = (n: NotebookRow) => put('notebooks', n);
export const deleteNotebookRow = (id: string) => del('notebooks', id);

// ------------------------------------------------------------------ pages
export const listPages = () => getAll<PageRow>('pages');
export const putPage = (p: PageRow) => put('pages', p);
export const deletePageRow = (id: string) => del('pages', id);

// ------------------------------------------------------------------ page docs (binary ink)
export async function getPageDoc(pageId: string): Promise<{ doc: PageDoc | null; quarantined: boolean }> {
  const rec = await getOne<DocRec>('pagedocs', pageId);
  if (!rec) return { doc: null, quarantined: false };
  try {
    const raw = rec.data as ArrayBufferLike;
    const buf: ArrayBuffer = raw instanceof ArrayBuffer ? raw : new Uint8Array(raw).slice().buffer;
    return { doc: decodeDoc(buf), quarantined: false };
  } catch (e) {
    await put('quarantined', { id: uid(), pageId, size: (rec.data as ArrayBuffer)?.byteLength ?? 0, at: Date.now(), reason: String(e) } satisfies QuarantineRec);
    await del('pagedocs', pageId);
    return { doc: null, quarantined: true };
  }
}

export async function putPageDoc(pageId: string, doc: PageDoc) {
  const data = encodeDoc(doc);
  await put('pagedocs', { pageId, data } as DocRec);
}

export async function putPageDocRaw(pageId: string, data: ArrayBuffer) {
  await put('pagedocs', { pageId, data } as DocRec);
}

export const getPageDocRaw = (pageId: string) => getOne<DocRec>('pagedocs', pageId);
export const deletePageDoc = (pageId: string) => del('pagedocs', pageId);

// ------------------------------------------------------------------ pdf text layers (cached, regenerable)
export const getPdfText = (pageId: string) => getOne<PdfTextRec>('pdftext', pageId);
export const putPdfText = (rec: PdfTextRec) => put('pdftext', rec);
export const deletePdfText = (pageId: string) => del('pdftext', pageId);

// ------------------------------------------------------------------ thumbnails
export const getThumb = (pageId: string) => getOne<ThumbRec>('thumbs', pageId);
export const putThumb = (t: ThumbRec) => put('thumbs', t);
export const deleteThumb = (pageId: string) => del('thumbs', pageId);
export async function clearThumbs() {
  const d = await get();
  if (d) { const tx = d.transaction('thumbs', 'readwrite'); await tx.objectStore('thumbs').clear(); }
  else mem.thumbs.clear();
}

// ------------------------------------------------------------------ images (covers, template customs, inserted images, pdf backgrounds + originals)
export const getImage = (id: string) => getOne<ImageBlob>('images', id);
export const listImages = () => getAll<ImageBlob>('images');
export const putImage = (img: ImageBlob) => put('images', img);
export const deleteImage = (id: string) => del('images', id);

// ------------------------------------------------------------------ audio
export const getAudio = (id: string) => getOne<{ id: string; blob: Blob }>('audio', id);
export const putAudio = (a: { id: string; blob: Blob }) => put('audio', a);
export const deleteAudio = (id: string) => del('audio', id);

// ------------------------------------------------------------------ recordings
export const listRecordings = () => getAll<RecordingRow>('recordings');
export const putRecording = (r: RecordingRow) => put('recordings', r);
export const deleteRecording = (id: string) => del('recordings', id);

// ------------------------------------------------------------------ tags
export const listTags = () => getAll<TagRow>('tags');
export const putTag = (t: TagRow) => put('tags', t);
export const deleteTag = (id: string) => del('tags', id);

// ------------------------------------------------------------------ trash purge + asset GC
export interface PurgeReport { notebooks: number; pages: number; folders: number }

export async function purgeTrash(): Promise<PurgeReport> {
  const now = Date.now();
  const report: PurgeReport = { notebooks: 0, pages: 0, folders: 0 };
  const notebooks = await listNotebooks();
  const pages = await listPages();
  const doomed = new Set<string>();
  for (const n of notebooks) {
    if (n.deletedAt != null && now - n.deletedAt > TRASH_RETENTION_MS) doomed.add(n.id);
  }
  if (doomed.size === 0) {
    // still GC folders whose parents are gone
  } else {
    const pageById = new Map(pages.map((p) => [p.id, p]));
    const audioIds = new Set<string>();
    const imageIds = new Set<string>();
    for (const p of pages) {
      if (doomed.has(p.notebookId)) {
        if (p.backgroundImageId) imageIds.add(p.backgroundImageId);
        if (p.customTemplateImageId) imageIds.add(p.customTemplateImageId);
        await del('pagedocs', p.id);
        await del('thumbs', p.id);
        const recs = (await listRecordings()).filter((r) => r.pageId === p.id);
        for (const r of recs) { audioIds.add(r.id); await del('recordings', r.id) }
        await del('pages', p.id);
        pageById.delete(p.id);
        report.pages++;
      }
    }
    for (const id of audioIds) await del('audio', id);
    for (const n of notebooks) {
      if (doomed.has(n.id)) {
        if (n.coverCustomId) imageIds.add(n.coverCustomId);
        await del('notebooks', n.id);
        report.notebooks++;
      }
    }
    for (const id of imageIds) await del('images', id);
  }
  // purge folders older than retention whose subtree no longer holds live notebooks
  const folders = await listFolders();
  const liveNotebooks = (await listNotebooks()).filter((n) => n.deletedAt == null);
  const liveFolders = new Set<string>();
  const keep = (id: string | null): boolean => {
    if (id == null) return false;
    if (liveFolders.has(id)) return true;
    const f = folders.find((x) => x.id === id);
    if (!f) return false;
    if (f.deletedAt == null) { liveFolders.add(id); return true }
    // trashed folder kept only if it still contains live content that references it
    if (liveNotebooks.some((n) => n.folderId === id)) { liveFolders.add(id); return true }
    return false;
  };
  for (const n of liveNotebooks) keep(n.folderId);
  // iterate to fixpoint for nested live folders
  for (let i = 0; i < 3; i++) for (const f of folders) if (keep(f.parentId)) keep(f.id);
  for (const f of folders) {
    if (f.deletedAt != null && now - f.deletedAt > TRASH_RETENTION_MS && !liveFolders.has(f.id)) {
      await del('folders', f.id);
      report.folders++;
    }
  }
  return report;
}

// ------------------------------------------------------------------ storage stats
export interface StorageStats { usage: number; quota: number; notebooks: number; pages: number; images: number; audio: number; recordings: number; thumbs: number; memoryMode: boolean }

export async function storageStats(): Promise<StorageStats> {
  const [notebooks, pages, images, audio, recordings] = await Promise.all([
    listNotebooks(), listPages(), getAll<ImageBlob>('images'), getAll<{ id: string; blob: Blob }>('audio'), listRecordings(),
  ]);
  let usage = 0, quota = 0;
  try {
    const est = await navigator.storage?.estimate?.();
    usage = est?.usage ?? 0;
    quota = est?.quota ?? 0;
  } catch { /* ignore */ }
  let thumbs = 0;
  for (const t of (await getAll<ThumbRec>('thumbs'))) thumbs += t.dataUrl.length;
  let audioBytes = 0;
  for (const a of audio) audioBytes += a.blob?.size ?? 0;
  if (usage === 0) {
    // memory mode or no estimate: compute a rough figure
    let docs = 0;
    for (const d of (await getAll<DocRec>('pagedocs'))) docs += d.data?.byteLength ?? 0;
    usage = docs + thumbs + audioBytes;
  }
  return {
    usage, quota,
    notebooks: notebooks.length, pages: pages.length,
    images: images.length, audio: recordings.length,
    recordings: recordings.length, thumbs, memoryMode,
  };
}

export async function estimateAudioBytes(): Promise<number> {
  const audio = await getAll<{ id: string; blob: Blob }>('audio');
  return audio.reduce((s, a) => s + (a.blob?.size ?? 0), 0);
}

// ------------------------------------------------------------------ full wipe (backup restore)
const STORE_NAMES: (keyof typeof mem)[] = [
  'meta', 'folders', 'notebooks', 'pages', 'pagedocs', 'thumbs',
  'images', 'audio', 'recordings', 'tags', 'quarantined',
];

export async function wipeAllData() {
  const d = await get();
  if (d) {
    const tx = d.transaction(STORE_NAMES as unknown as string[], 'readwrite');
    await Promise.all(STORE_NAMES.map((s) => tx.objectStore(s as unknown as string).clear()));
  } else {
    for (const s of STORE_NAMES) (mem[s] as Map<string, unknown>).clear();
  }
}
