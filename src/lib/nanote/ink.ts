// Nanote ink codec — compact binary page-document format ("NINK v1").
//
// Layout (little-endian):
//   magic   "NINK"            4 bytes
//   version u16               2 bytes  (1)
//   flags   u16               2 bytes  (bit0: JSON section present)
//   strokeCount u32           4
//   strokes ...               strokeCount records:
//       idLen   u16
//       id      utf8 bytes
//       tool    u8
//       colorRGB u24 (3 bytes)
//       width   f32
//       z       f32
//       pointCount u32
//       points  pointCount × (f32 x, f32 y, f32 p, u32 tDelta)   — tDelta = t - prev t
//   jsonLen u32
//   json    utf8 bytes  { texts, shapes, images, sync, nextZ }
//
// Corrupted payloads throw on decode → caller quarantines the record and
// recovers the page as empty (never crashes the app).

import {
  ImageEl, InkPoint, PageDoc, PageElement, ShapeEl, StrokeEl, TextEl, AudioSyncMap, ToolId, ToolId as T,
} from './types';

const MAGIC = 0x4B4E494E; // "NINK" little-endian
const VERSION = 1;
const HEADER_LEN = 12; // magic(4) + version(2) + flags(2) + strokeCount(4)

const TOOL_IDS: ToolId[] = ['fountain', 'ballpoint', 'brush', 'fineliner', 'highlighter'];

interface JsonSection {
  texts: Omit<TextEl, 'kind'>[];
  shapes: Omit<ShapeEl, 'kind'>[];
  images: Omit<ImageEl, 'kind'>[];
  sync: AudioSyncMap;
  nextZ: number;
}

// ------------------------------------------------------------------ encode
export function encodeDoc(doc: PageDoc): ArrayBuffer {
  const strokes = doc.elements.filter((e): e is StrokeEl => e.kind === 'stroke');
  const texts = doc.elements.filter((e): e is TextEl => e.kind === 'text');
  const shapes = doc.elements.filter((e): e is ShapeEl => e.kind === 'shape');
  const images = doc.elements.filter((e): e is ImageEl => e.kind === 'image');
  const nextZ = doc.elements.reduce((m, e) => Math.max(m, e.z), 0) + 1;

  const enc = new TextEncoder();
  let json: Uint8Array;
  try {
    json = enc.encode(JSON.stringify({
      texts, shapes, images, sync: doc.sync ?? {}, nextZ,
    } satisfies JsonSection));
  } catch (e) {
    throw new Error(`ink-json-encode: ${String(e)}`);
  }

  // upper bound size
  const idBytes = strokes.map((s) => enc.encode(s.id));
  let strokeBytes = 0;
  strokes.forEach((s, i) => {
    strokeBytes += 2 + idBytes[i].length + 1 + 3 + 4 + 4 + 4 + s.points.length * 16;
  });

  const total = HEADER_LEN + strokeBytes + 4 + json.length;
  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let o = 0;

  view.setUint32(o, MAGIC, true); o += 4;
  view.setUint16(o, VERSION, true); o += 2;
  view.setUint16(o, json.length > 0 ? 1 : 0, true); o += 2;
  view.setUint32(o, strokes.length, true); o += 4;
  if (o !== HEADER_LEN) throw new Error(`ink: header ${o}`);

  strokes.forEach((s, i) => {
    const idb = idBytes[i];
    view.setUint16(o, idb.length, true); o += 2;
    u8.set(idb, o); o += idb.length;
    u8[o] = Math.max(0, TOOL_IDS.indexOf(s.tool)); o += 1;
    const hex = s.color.replace('#', '');
    const rgb = parseInt(hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex.slice(0, 6), 16);
    u8[o] = (rgb >> 16) & 255; u8[o + 1] = (rgb >> 8) & 255; u8[o + 2] = rgb & 255; o += 3;
    view.setFloat32(o, s.width, true); o += 4;
    view.setFloat32(o, s.z, true); o += 4;
    view.setUint32(o, s.points.length, true); o += 4;
    let prevT = 0;
    for (const p of s.points) {
      view.setFloat32(o, p.x, true); o += 4;
      view.setFloat32(o, p.y, true); o += 4;
      view.setFloat32(o, p.p, true); o += 4;
      const dt = Math.max(0, Math.min(0xFFFFFFFF, Math.round(p.t) - prevT));
      view.setUint32(o, dt, true); o += 4;
      prevT += dt;
    }
  });

  view.setUint32(o, json.length, true); o += 4;
  u8.set(json, o); o += json.length;

  if (o !== total) {
    // exact-size slice in the rare case of unicode quirks in id encoding width
    return buf.slice(0, o);
  }
  return buf;
}

// ------------------------------------------------------------------ decode
export function decodeDoc(buf: ArrayBuffer): PageDoc {
  if (!buf || buf.byteLength < HEADER_LEN) throw new Error('ink: too short');
  const view = new DataView(buf);
  const u8 = new Uint8Array(buf);
  if (view.getUint32(0, true) !== MAGIC) throw new Error('ink: bad magic');
  const version = view.getUint16(4, true);
  if (version !== VERSION) throw new Error(`ink: unsupported version ${version}`);
  const flags = view.getUint16(6, true);
  const strokeCount = view.getUint32(8, true);
  let o = HEADER_LEN;

  const dec = new TextDecoder();
  const elements: PageElement[] = [];
  let remaining = strokeCount;
  while (remaining-- > 0) {
    if (o + 2 > buf.byteLength) throw new Error('ink: truncated stroke header');
    const idLen = view.getUint16(o, true); o += 2;
    if (o + idLen + 16 > buf.byteLength) throw new Error('ink: truncated stroke id');
    const id = dec.decode(u8.subarray(o, o + idLen)); o += idLen;
    const toolIdx = u8[o]; o += 1;
    const tool: ToolId = TOOL_IDS[toolIdx] ?? 'fineliner';
    const rgb = (u8[o] << 16) | (u8[o + 1] << 8) | u8[o + 2]; o += 3;
    const color = `#${rgb.toString(16).padStart(6, '0')}`;
    const width = view.getFloat32(o, true); o += 4;
    const z = view.getFloat32(o, true); o += 4;
    const pointCount = view.getUint32(o, true); o += 4;
    if (o + pointCount * 16 > buf.byteLength) throw new Error('ink: truncated points');
    const points: InkPoint[] = new Array(pointCount);
    let t = 0;
    for (let i = 0; i < pointCount; i++) {
      const x = view.getFloat32(o, true); o += 4;
      const y = view.getFloat32(o, true); o += 4;
      const p = view.getFloat32(o, true); o += 4;
      t += view.getUint32(o, true); o += 4;
      points[i] = { x, y, p, t };
    }
    elements.push({ kind: 'stroke', id, tool, color, width, points, z });
  }

  const sync: AudioSyncMap = {};
  if (flags & 1) {
    if (o + 4 > buf.byteLength) throw new Error('ink: truncated json length');
    const jsonLen = view.getUint32(o, true); o += 4;
    if (o + jsonLen > buf.byteLength) throw new Error('ink: truncated json');
    const sec = JSON.parse(dec.decode(u8.subarray(o, o + jsonLen))) as JsonSection;
    for (const t of sec.texts ?? []) elements.push({ kind: 'text', ...t });
    for (const s of sec.shapes ?? []) elements.push({ kind: 'shape', ...s });
    for (const im of sec.images ?? []) elements.push({ kind: 'image', ...im });
    Object.assign(sync, sec.sync ?? {});
  }

  return { version: 1, elements, sync };
}

/** Re-encode + decode round-trip; used by the welcome-notebook generator to validate codec integrity at runtime. */
export function codecSelfCheck(): boolean {
  const doc: PageDoc = {
    version: 1,
    elements: [{
      kind: 'stroke', id: 'selfcheck', tool: 'fountain' as T, color: '#1E6FF2', width: 4, z: 1,
      points: [{ x: 1.5, y: 2.25, p: 0.7, t: 12 }, { x: 3.5, y: 4.25, p: 0.5, t: 30 }],
    }, {
      kind: 'text', id: 'sc-t', x: 8, y: 9, w: 40, text: 'مرحبا Nanote ✓', fontId: 'sans', size: 14,
      color: '#16233A', bold: true, italic: false, underline: false, align: 'center', z: 2,
    }],
    sync: { selfcheck: { recId: 'r1', tStart: 0, tEnd: 20 } },
  };
  const back = decodeDoc(encodeDoc(doc));
  const s0 = back.elements[0] as StrokeEl;
  const okStroke = s0.kind === 'stroke' && s0.color.toLowerCase() === '#1e6ff2' && s0.points.length === 2 && Math.abs(s0.points[1].t - 30) < 0.01;
  const okText = back.elements.some((e) => e.kind === 'text' && (e as TextEl).text.includes('مرحبا'));
  const okSync = back.sync['selfcheck']?.recId === 'r1';
  const result = okStroke && okText && okSync;
  if (!result) throw new Error('ink codec self-check failed');
  return true;
}
