// Welcome notebook — pre-drawn programmatically with REAL ink stroke data
// (no images, no mocks: actual stroke elements encoded through the NINK codec).
import * as db from './idb';
import { codecSelfCheck } from './ink';
import { translate } from './i18n';
import { InkPoint, NotebookRow, PageDoc, PageRow, StrokeEl, TextEl, ShapeEl, ToolId, emptyDoc } from './types';
import { uid } from './util';

// deterministic PRNG so the welcome page is stable
function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let z = 0;
const nextZ = () => ++z;

function rampStroke(x0: number, y: number, len: number, tool: ToolId, color: string, width: number, opts?: { waves?: number; amp?: number }): StrokeEl {
  const n = 64;
  const points: InkPoint[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // pressure ramps up then eases down
    const p = Math.min(1, Math.sin(Math.PI * Math.min(1, t * 1.15)) * 1.08);
    const x = x0 + t * len;
    const yy = y + Math.sin(t * Math.PI * 2 * (opts?.waves ?? 1.5)) * (opts?.amp ?? 0);
    points.push({ x, y: yy, p: Number(p.toFixed(3)), t: i * 16 });
  }
  return { kind: 'stroke', id: uid(), tool, color, width, points, z: nextZ() };
}

function straightStroke(x0: number, y0: number, x1: number, y1: number, tool: ToolId, color: string, width: number): StrokeEl {
  const n = 24;
  const points: InkPoint[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    points.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, p: 0.5, t: i * 16 });
  }
  return { kind: 'stroke', id: uid(), tool, color, width, points, z: nextZ() };
}

function spiralStroke(cx: number, cy: number, r0: number, r1: number, turns: number, tool: ToolId, color: string, width: number): StrokeEl {
  const n = 160;
  const points: InkPoint[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const ang = t * Math.PI * 2 * turns;
    const r = r0 + (r1 - r0) * t;
    const p = 0.35 + 0.6 * Math.sin(Math.PI * t);
    points.push({ x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r, p: Number(p.toFixed(3)), t: i * 16 });
  }
  return { kind: 'stroke', id: uid(), tool, color, width, points, z: nextZ() };
}

function dashStroke(x0: number, y0: number, x1: number, y1: number, color: string, width: number): StrokeEl {
  return straightStroke(x0, y0, x1, y1, 'fountain', color, width);
}

function text(x: number, y: number, w: number, text: string, size: number, color: string, opts?: Partial<TextEl>): TextEl {
  return {
    kind: 'text', id: uid(), x, y, w, text, fontId: 'sans', size, color,
    bold: false, italic: false, underline: false, align: 'start', z: nextZ(), ...opts,
  };
}

export async function seedWelcomeNotebook(lang: 'en' | 'ar' = 'en'): Promise<string> {
  codecSelfCheck(); // runtime validation of the ink codec on first launch
  z = 0;
  const now = Date.now();
  const title = lang === 'ar' ? 'دفتر الترحيب' : 'Welcome to Nanote';
  const notebook: NotebookRow = {
    id: uid(),
    folderId: null,
    tabId: null,
    pdfOriginalId: null,
    title,
    coverId: 'nanote-blue',
    coverCustomId: null,
    defaultTemplate: 'blank',
    pageSize: 'a4p',
    backgroundHex: '#FFFFFF',
    createdAt: now, updatedAt: now, lastOpenedAt: now,
    isFavorite: true, deletedAt: null, sortOrder: 0, tagIds: [],
  };
  await db.putNotebook(notebook);

  const t = (k: string) => translate(lang, k);

  // ---------------- page 1: tour of pens
  const p1: PageRow = {
    id: uid(), notebookId: notebook.id, pageIndex: 0,
    template: 'blank', backgroundHex: '#FFFFFF',
    customTemplateImageId: null, backgroundImageId: null,
    isBookmarked: true,
    labels: [{ id: uid(), title: t('onb.welcome') }],
    createdAt: now, updatedAt: now, textIndex: '', height: 1123,
  };
  const doc1: PageDoc = emptyDoc();
  doc1.elements.push(
    text(60, 56, 620, lang === 'ar' ? 'مرحبًا بك في نانوت' : 'Welcome to Nanote', 36, '#1E6FF2', { bold: true }),
    rampStroke(64, 130, 420, 'fountain', '#1E6FF2', 4.5, { waves: 1.5, amp: 5 }),
    straightStroke(56, 168, 500, 168, 'highlighter', '#FFD84D', 26), // highlighter band behind tagline
    text(60, 150, 620, t('app.tagline'), 20, '#16233A'),
  );
  const pens: { tool: ToolId; color: string; width: number }[] = [
    { tool: 'fountain', color: '#1E6FF2', width: 5 },
    { tool: 'ballpoint', color: '#16233A', width: 2.4 },
    { tool: 'brush', color: '#9333EA', width: 9 },
    { tool: 'fineliner', color: '#16233A', width: 1.8 },
  ];
  let y = 300;
  for (const pen of pens) {
    doc1.elements.push(
      text(60, y - 8, 180, t(`tool.${pen.tool}`), 17, '#5A6B85'),
      rampStroke(230, y, 480, pen.tool, pen.color, pen.width, { waves: pen.tool === 'brush' ? 2 : 1.5, amp: pen.tool === 'brush' ? 8 : 4 }),
    );
    y += 95;
  }
  doc1.elements.push(
    text(60, y - 20, 180, t('tool.highlighter'), 17, '#5A6B85'),
    straightStroke(230, y - 6, 710, y - 6, 'highlighter', '#6FE38B', 24),
    straightStroke(230, y + 22, 710, y + 22, 'highlighter', '#7CC4FF', 24),
    text(60, y + 80, 660, lang === 'ar'
      ? 'جرّب الممحاة وحبل التحديد والأشكال والنصوص والأصوات… كل شيء يعمل دون اتصال.'
      : 'Try the eraser, lasso, shapes, text, images and audio — everything works offline.', 19, '#16233A'),
  );

  // ---------------- page 2: you did it
  const p2: PageRow = {
    id: uid(), notebookId: notebook.id, pageIndex: 1,
    template: 'dotgrid', backgroundHex: '#FFFFFF',
    customTemplateImageId: null, backgroundImageId: null,
    isBookmarked: false,
    labels: [{ id: uid(), title: lang === 'ar' ? 'أحسنت!' : 'You did it!' }],
    createdAt: now, updatedAt: now, textIndex: '', height: 1123,
  };
  const doc2: PageDoc = emptyDoc();
  const star: ShapeEl = {
    kind: 'shape', id: uid(), shape: 'star', x: 560, y: 70, w: 150, h: 150,
    stroke: '#FF9F1C', strokeWidth: 4, fill: null, z: nextZ(),
  };
  doc2.elements.push(
    text(60, 70, 500, lang === 'ar' ? 'أحسنت!' : 'You did it!', 42, '#22A06B', { bold: true }),
    star,
    spiralStroke(300, 400, 20, 170, 3, 'brush', '#9333EA', 8),
    text(60, 620, 660, lang === 'ar'
      ? 'أنشئ دفترك الخاص من زر «+» في المكتبة، ونظّم ملاحظاتك في مجلدات ووسوم.'
      : 'Create your own notebook with the + button in the Library, and organize with folders and tags.', 20, '#16233A'),
  );
  const rnd = mulberry32(42);
  const confettiColors = ['#1E6FF2', '#22A06B', '#FF9F1C', '#E5484D', '#9333EA', '#DB2777'];
  for (let i = 0; i < 26; i++) {
    const cx = 80 + rnd() * 640;
    const cy = 740 + rnd() * 300;
    const len = 14 + rnd() * 26;
    const ang = rnd() * Math.PI;
    const col = confettiColors[Math.floor(rnd() * confettiColors.length)];
    doc2.elements.push(dashStroke(cx, cy, cx + Math.cos(ang) * len, cy + Math.sin(ang) * len, col, 3 + rnd() * 2));
  }

  await db.putPage(p1);
  await db.putPage(p2);
  await db.putPageDoc(p1.id, doc1);
  await db.putPageDoc(p2.id, doc2);
  return notebook.id;
}
