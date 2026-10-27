// Nanote backup codec — single-file .nanote archives.
// Format: JSON with a versioned header; binary ink payloads + blobs as base64.
import * as db from './idb';
import { decodeDoc, encodeDoc } from './ink';
import { clearRasterCache } from './rastercache';
import { FolderRow, NotebookRow, PageRow, RecordingRow, TabRow, TagRow, Settings } from './types';

const MAGIC = 'NANOTE-BACKUP';
const BACKUP_VERSION = 1;

interface BackupFile {
  magic: string;
  version: number;
  exportedAt: string;
  app: string;
  folders: FolderRow[];
  tabs?: TabRow[]; // v2+ — absent in v1 backups
  notebooks: NotebookRow[];
  pages: PageRow[];
  tags: TagRow[];
  docs: Record<string, string>;          // pageId → base64(NINK binary)
  images: { id: string; w: number; h: number; name: string; createdAt: number; data: string }[];
  recordings: RecordingRow[];
  audio: Record<string, string>;         // recordingId → base64 blob (when included)
  settings: Pick<Settings, 'defaultView' | 'pressureCurve'> | null;
}

// ---------------------------------------------------------------- base64 helpers
async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBlob(b64: string, mime: string): Blob {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function abToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function b64ToAb(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// ---------------------------------------------------------------- build
export async function buildNanoteBackup(includeAudio: boolean): Promise<Blob> {
  const [folders, tabs, notebooks, pages, tags, recordings, settings] = await Promise.all([
    db.listFolders(), db.listTabs(), db.listNotebooks(), db.listPages(), db.listTags(),
    db.listRecordings(), db.loadSettings(),
  ]);
  // collect all images referenced anywhere (covers, templates, backgrounds, inserted images)
  const imageIds = new Set<string>();
  for (const n of notebooks) {
    if (n.coverCustomId) imageIds.add(n.coverCustomId);
    if (n.pdfOriginalId) imageIds.add(n.pdfOriginalId);
  }
  for (const p of pages) {
    if (p.backgroundImageId) imageIds.add(p.backgroundImageId);
    if (p.customTemplateImageId) imageIds.add(p.customTemplateImageId);
  }
  // image blobs inside page docs
  const allDocs: Record<string, string> = {};
  for (const p of pages) {
    const rec = await db.getPageDocRaw(p.id);
    if (rec?.data) allDocs[p.id] = abToB64(rec.data);
    const { doc } = await db.getPageDoc(p.id);
    for (const el of doc?.elements ?? []) if (el.kind === 'image' && el.imageId) imageIds.add(el.imageId);
  }

  const imagePayloads: BackupFile['images'] = [];
  for (const id of imageIds) {
    const rec = await db.getImage(id);
    if (!rec?.blob) continue;
    imagePayloads.push({ id, w: rec.w, h: rec.h, name: rec.name, createdAt: rec.createdAt, data: await blobToBase64(rec.blob) });
  }

  const audioPayload: Record<string, string> = {};
  if (includeAudio) {
    for (const r of recordings) {
      const rec = await db.getAudio(r.id);
      if (rec?.blob) audioPayload[r.id] = await blobToBase64(rec.blob);
    }
  }

  const payload: BackupFile = {
    magic: MAGIC,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    app: 'Nanote 1.0.0',
    folders, notebooks, pages, tags, tabs,
    docs: allDocs,
    images: imagePayloads,
    recordings,
    audio: audioPayload,
    settings: { defaultView: settings.defaultView, pressureCurve: settings.pressureCurve },
  };
  return new Blob([JSON.stringify(payload)], { type: 'application/x-nanote' });
}

// ---------------------------------------------------------------- restore
export async function restoreNanoteBackup(file: File): Promise<{ notebooks: number; pages: number }> {
  const text = await file.text();
  let payload: BackupFile;
  try {
    payload = JSON.parse(text) as BackupFile;
  } catch {
    throw new Error('invalid');
  }
  if (payload?.magic !== MAGIC) throw new Error('invalid');
  if (payload.version > BACKUP_VERSION) throw new Error('version');

  await db.wipeAllData();
  // restored pages reuse their original ids — drop every cached raster so a
  // restore can never repaint the PRE-restore content from the cache
  try { await clearRasterCache(); } catch { /* best effort */ }

  for (const f of payload.folders ?? []) await db.putFolder(f);
  for (const tb of payload.tabs ?? []) await db.putTab(tb);
  for (const n of payload.notebooks ?? []) await db.putNotebook(n);
  for (const t of payload.tags ?? []) await db.putTag(t);
  for (const p of payload.pages ?? []) await db.putPage(p);
  for (const [pageId, b64] of Object.entries(payload.docs ?? {})) {
    await db.putPageDocRaw(pageId, b64ToAb(b64));
  }
  for (const im of payload.images ?? []) {
    const mime = im.name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
    await db.putImage({ id: im.id, w: im.w, h: im.h, name: im.name, createdAt: im.createdAt, blob: base64ToBlob(im.data, mime) });
  }
  for (const r of payload.recordings ?? []) {
    await db.putRecording(r);
    const b64 = payload.audio?.[r.id];
    if (b64) await db.putAudio({ id: r.id, blob: base64ToBlob(b64, r.mimeType || 'audio/webm') });
  }

  // validate codec round-trip for the first doc
  const firstPage = (payload.pages ?? [])[0];
  if (firstPage && payload.docs?.[firstPage.id]) {
    try { decodeDoc(b64ToAb(payload.docs[firstPage.id])) } catch { throw new Error('corrupt') }
  }

  return { notebooks: payload.notebooks?.length ?? 0, pages: payload.pages?.length ?? 0 };
}

// re-encode helper (used by tests-by-use in onboarding flow)
export function roundTrip(doc: Parameters<typeof encodeDoc>[0]) {
  return decodeDoc(encodeDoc(doc));
}
