// POST /api/langpack { lang: 'fr' } — generates (once per language, then
// disk-cached) an offline translation language pack: the CORE vocabulary list
// translated into the target language by the LLM, returned as
// { code, entries, phrases }.
//
// The browser app downloads this JSON from Settings → Languages and stores it
// in IndexedDB, where the on-device engine uses it fully offline afterwards.
// This is the "language library" backend — the only network touchpoint is the
// one-time download.
//
// Caching: packs land in .langpacks/<code>.json next to the project root. The
// first request pays the LLM generation (~seconds); every later request (any
// device) serves the identical cached file instantly.
//
// POST (not GET) on purpose: this project exports a static site (output:
// export) and only POST handlers are exempt from static rendering — same
// pattern as /api/translate.
import { NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import ZAI from 'z-ai-web-dev-sdk';
import { LANG_LIBRARY } from '@/lib/nanote/types';
import { coreVocabulary } from '@/lib/nanote/langpackCore';

// browser-only backend route; the independent APK platform decides its own
// offline-pack delivery when this feature wave is ported.
const CACHE_DIR = path.join(process.cwd(), '.langpacks');

const LANG_BY_CODE = new Map(LANG_LIBRARY.map((l) => [l.code, l]));

interface PackJson {
  code: string;
  name: string;
  nativeName: string;
  rtl: boolean;
  entries: Record<string, string>;
  phrases: Record<string, string>;
  wordCount: number;
  builtAt: number;
}

async function readCache(code: string): Promise<PackJson | null> {
  try {
    const raw = await fs.readFile(path.join(CACHE_DIR, `${code}.json`), 'utf8');
    return JSON.parse(raw) as PackJson;
  } catch {
    return null;
  }
}

async function writeCache(code: string, pack: PackJson): Promise<void> {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(path.join(CACHE_DIR, `${code}.json`), JSON.stringify(pack), 'utf8');
  } catch (e) {
    console.warn('[nanote] langpack cache write failed', e);
  }
}

/** Ask the LLM to translate a chunk of the vocabulary. The wire protocol is
 *  TSV ("english<TAB>translation" per line) — far more robust for LLM output
 *  than strict JSON — parsed by the layered parser below, which also accepts
 *  separator lines, alternating lines and positional answers. Chunked (80
 *  items per call) so a single response can never truncate. */
/** Layered chunk parser: LLMs obey output formats... creatively. We try, in
 *  order: TAB lines → "key : value" lines → alternating lines (english /\n/
 *  translation) → strict positional alignment. Whichever strategy covers the
 *  most input items wins. */
function parseChunkResponse(raw: string, items: string[]): Record<string, string> {
  const cleanKey = (k: string) => k
    .replace(/^[\s"'“”«»\-\d.)*(]+/, '')
    .replace(/[\s"'“”«»]+$/, '')
    .trim()
    .toLowerCase();
  const cleanVal = (v: string) => v
    .replace(/^[\s"'“”«»]+/, '')
    .replace(/[\s"'“”«»,;]+$/, '')
    .trim();

  const norm = raw
    .replace(/<br\s*\/?>/gi, '\n')   // models sometimes emit <BR> for lines
    .replace(/\r/g, '');
  const lines = norm
    .split('\n')
    .map((l) => l.replace(/```[a-z]*/gi, '').replace(/^\d+[.)\-]\s*/, '').trim())
    .filter(Boolean);

  const accept = (key: string, val: string, map: Record<string, string>) => {
    const k = cleanKey(key);
    const v = cleanVal(val);
    if (k && v && items.includes(k) && v.toLowerCase() !== k) map[k] = v;
  };

  const strategies: Array<() => Record<string, string>> = [
    // 1) TAB-separated lines: "english\ttranslation"
    () => {
      const map: Record<string, string> = {};
      for (const l of lines) {
        const t = l.indexOf('\t');
        if (t <= 0) continue;
        accept(l.slice(0, t), l.slice(t + 1), map);
      }
      return map;
    },
    // 2) separator lines: "english : translation" / "english => translation"
    () => {
      const map: Record<string, string> = {};
      for (const l of lines) {
        const m = l.match(/^(.+?)\s*(?:=>|=>|[:=])\s*(.+)$/);
        if (m) accept(m[1], m[2], map);
      }
      return map;
    },
    // 3) alternating lines: english / translation / english / …
    () => {
      const map: Record<string, string> = {};
      if (lines.length !== items.length * 2) return map;
      for (let i = 0; i < items.length; i++) {
        accept(lines[2 * i] ?? '', lines[2 * i + 1] ?? '', map);
      }
      return map;
    },
    // 4) strict positional: line i answers item i (order was requested)
    () => {
      const map: Record<string, string> = {};
      if (lines.length !== items.length) return map;
      for (let i = 0; i < items.length; i++) {
        const en = items[i];
        const l = lines[i];
        const lower = l.toLowerCase();
        if (lower.startsWith(en + '\t')) { accept(en, l.slice(en.length + 1), map); continue }
        if (lower.startsWith(en + ' ')) { accept(en, l.slice(en.length + 1), map); continue }
        if (lower.startsWith(en + ':') || lower.startsWith(en + ' =')) { accept(en, l.slice(en.length + 1).replace(/^\s*[=:]\s*/, ''), map); continue }
        // no visible key — trust the position when it's not the English word
        if (lower !== en) accept(en, l, map);
      }
      return map;
    },
    // 5) two-pointer alignment: scan forward for each item's own line (handles
    //    skipped/dropped keys without letting misalignment cascade), and
    //    accept a bare short line as the current item's dropped-key answer
    () => {
      const map: Record<string, string> = {};
      const isBare = (v: string) =>
        v.length > 0 && v.length < 40 && v.split(/\s+/).length <= 4 && !/[.!?:;]$/.test(v);
      let li = 0;
      for (const en of items) {
        let matched = false;
        for (let j = li; j < Math.min(lines.length, li + 4); j++) {
          const l = lines[j];
          const t = l.indexOf('\t');
          if (t > 0) {
            if (cleanKey(l.slice(0, t)) === en) { accept(en, l.slice(t + 1), map); li = j + 1; matched = true; break }
            continue; // a tab line for a DIFFERENT item — keep scanning
          }
          const m = l.match(/^(.+?)\s*(?:=>|[:=])\s*(.+)$/);
          if (m) {
            if (cleanKey(m[1]) === en) { accept(en, m[2], map); li = j + 1; matched = true; break }
            continue;
          }
          // bare line: the model dropped the key — treat as this item's answer
          const bare = cleanVal(l);
          if (isBare(bare) && bare.toLowerCase() !== en && !items.includes(bare.toLowerCase())) {
            accept(en, bare, map); li = j + 1; matched = true; break;
          }
        }
        if (!matched) continue; // untranslated item — do not consume a line
      }
      return map;
    },
  ];

  let best: Record<string, string> = {};
  for (const s of strategies) {
    const map = s();
    if (Object.keys(map).length > Object.keys(best).length) best = map;
    if (Object.keys(best).length >= items.length * 0.9) break; // good enough
  }
  return best;
}

// per-language few-shot anchors (format adherence is far better with a
// concrete example in the target script)
const EXAMPLE_PAIRS: Record<string, [string, string]> = {
  ar: ['apple\tتفاحة', 'water\tماء'],
  fr: ['apple\tpomme', 'water\teau'],
  de: ['apple\tApfel', 'water\tWasser'],
  es: ['apple\tmanzana', 'water\tagua'],
  tr: ['apple\telma', 'water\tsu'],
  ru: ['apple\tяблоко', 'water\tвода'],
  fa: ['apple\tسیب', 'water\tآب'],
  ur: ['apple\tسیب', 'water\tپانی'],
};

async function generatePack(meta: { code: string; name: string; nativeName: string; rtl: boolean }): Promise<PackJson> {
  const { words, phrases } = coreVocabulary();
  const zai = await ZAI.create();

  const translateChunk = async (items: string[], kind: 'word' | 'phrase', attempt: number): Promise<Record<string, string>> => {
    const call = async (): Promise<Record<string, string>> => {
    // few-shot example anchors the format (models garble it far less often);
    // retries switch to a NUMBERED format, which anchors alignment even harder
    const [exA, exB] = EXAMPLE_PAIRS[meta.code] ?? ['apple\tapple-in-' + meta.code, 'water\twater-in-' + meta.code];
    const numbered = attempt >= 2;
    const body = numbered
      ? items.map((it, i) => `${i + 1}. ${it}`).join('\n')
      : items.join('\n');
    const numRule = numbered
      ? 'Output one line per input item, KEEPING ITS NUMBER, formatted as:\n' +
        `1. english<TAB>translation\nExample output:\n1. ${exA}\n2. ${exB}\n`
      : `Example input:\napple\nwater\nExample output:\n${exA}\n${exB}\n`;
    const completion = await zai.chat.completions.create({
      messages: [
        {
          role: 'assistant',
          content:
            `You are building an offline dictionary. Translate each ${kind} from English into ${meta.name} (${meta.nativeName}). ` +
            'Rules: keep the same register; one best translation per item; keep it short; no transliteration unless the language normally transliterates; ' +
            'preserve diacritics/characters of the target script. ' +
            'Output EXACTLY one line per input item, in the same order, formatted as:\n' +
            'english<TAB>translation\n' +
            numRule +
            'No extra text, no commentary.',
        },
        { role: 'user', content: body },
      ],
      thinking: { type: 'disabled' },
    });
    const raw = completion.choices[0]?.message?.content?.trim() ?? '';
    const out = parseChunkResponse(raw, items);
    if (Object.keys(out).length < items.length * 0.5) {
      if (attempt < 3) {
        // LLM output is stochastic — a garbled chunk usually parses on a retry
        await new Promise((r) => setTimeout(r, 400));
        return translateChunk(items, kind, attempt + 1);
      }
      throw new Error(`chunk too sparse after retries: ${Object.keys(out).length}/${items.length}`);
    }
    return out;
    };

    // rate-limit resilience: back off and retry (the LLM service throttles
    // bursts; a pack download must survive them)
    for (let tryNo = 0; ; tryNo++) {
      try {
        return await call();
      } catch (e) {
        const msg = String((e as { message?: string })?.message ?? e);
        const throttled = /429|too many/i.test(msg);
        if (!throttled || tryNo >= 5) throw e;
        await new Promise((r) => setTimeout(r, 12000 * (tryNo + 1)));
      }
    }
  };

  const entries: Record<string, string> = {};
  const CHUNK = 50;
  for (let i = 0; i < words.length; i += CHUNK) {
    const chunk = words.slice(i, i + CHUNK);
    const map = await translateChunk(chunk, 'word', 1);
    for (const [k, v] of Object.entries(map)) {
      const key = k.trim().toLowerCase();
      const val = String(v ?? '').trim();
      if (key && val) entries[key] = val;
    }
    await new Promise((r) => setTimeout(r, 600)); // be gentle with the rate limit
  }

  const phr: Record<string, string> = {};
  for (let i = 0; i < phrases.length; i += CHUNK) {
    const chunk = phrases.slice(i, i + CHUNK);
    const map = await translateChunk(chunk, 'phrase', 1);
    for (const [k, v] of Object.entries(map)) {
      const key = k.trim().toLowerCase();
      const val = String(v ?? '').trim();
      if (key && val) phr[key] = val;
    }
  }

  const wordCount = Object.keys(entries).length + Object.keys(phr).length;
  if (wordCount < 100) throw new Error(`pack too small: ${wordCount}`);

  return {
    code: meta.code,
    name: meta.name,
    nativeName: meta.nativeName,
    rtl: meta.rtl,
    entries,
    phrases: phr,
    wordCount,
    builtAt: Date.now(),
  };
}

export async function POST(req: Request) {
  let body: { lang?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const code = (body.lang ?? '').toString().toLowerCase();
  const meta = LANG_BY_CODE.get(code);
  if (!meta) {
    return NextResponse.json({ error: 'unsupported language' }, { status: 400 });
  }
  // Arabic ships built-in inside the app; still serve the pack for completeness
  // (the client marks 'ar' as built-in and never needs this download).

  try {
    const cached = await readCache(code);
    if (cached) return NextResponse.json(cached);
    const pack = await generatePack(meta);
    await writeCache(code, pack);
    return NextResponse.json(pack);
  } catch (e) {
    console.warn('[nanote] langpack generation failed', e);
    return NextResponse.json({ error: 'pack generation failed' }, { status: 502 });
  }
}
