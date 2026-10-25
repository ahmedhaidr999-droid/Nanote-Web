// Offline translation engine — used when the online engine is unreachable.
// Pure dictionary + light-morphology translation; quality is deliberately
// labeled by the UI (badge) so the user knows the source.
//
// Two layers:
//  1. BUILT-IN AR↔EN dictionary (ships in the binary, no download needed).
//  2. DOWNLOADED LANGUAGE PACKS (Settings → Languages): English-keyed packs
//     cached from IndexedDB; any direction pivots through English, e.g.
//     FR→AR = packReverse(FR→EN) then builtin(EN→AR); AR→FR = builtin(AR→EN)
//     then pack(EN→FR).
//
// Public API:
//   offlineTranslate(text, 'ar' | 'en') → { translation, coverage } | null   (sync, built-in)
//   translateOffline(text, target) → { translation, coverage, via } | null   (async, packs + built-in)
//     returns null when there is nothing translatable (or coverage < 15%).

import { EN_AR, AR_EN_EXTRA, PHRASES } from './offlineDict';
import type { LangPack } from './types';

export interface OfflineTranslation {
  translation: string;
  coverage: number; // 0..1 — translated eligible tokens / total eligible tokens
}

export interface OfflineResult extends OfflineTranslation {
  via: 'builtin' | 'pack' | 'pack-pivot';
}

// ------------------------------------------------------------------ normalization

const AR_RE = /[\u0600-\u06FF]/;
const TASHKEEL = /[\u064B-\u0652\u0670\u0640]/g; // harakat + dagger alif + tatweel

function normWord(tok: string): string {
  if (AR_RE.test(tok)) return tok.replace(TASHKEEL, '');
  return tok.toLowerCase();
}

function normPhrase(p: string): string {
  return p.trim().toLowerCase().replace(TASHKEEL, '').replace(/\s+/g, ' ');
}

const TOKEN_RE = /[\p{L}\p{M}\p{N}]+(?:['’\-][\p{L}\p{M}\p{N}]+)*|[^\s\p{L}\p{M}\p{N}]+/gu;
const OPENERS = new Set(['(', '[', '{', '«', '“', '‘', '"', "'", '¿', '¡', '<']);

// ------------------------------------------------------------------ maps

// AR→EN = reverse of EN→AR (first definition wins) + curated extras (override).
const AR_EN: Record<string, string> = {};
for (const [en, ar] of Object.entries(EN_AR)) {
  if (ar && !AR_EN[ar]) AR_EN[ar] = en;
}
Object.assign(AR_EN, AR_EN_EXTRA);

// phrase maps per direction — detect which side of the pair is Latin.
const PH_TO_AR: Record<string, string> = {};
const PH_TO_EN: Record<string, string> = {};
for (const pair of PHRASES) {
  const [a, b] = pair as [string, string];
  if (AR_RE.test(a)) { PH_TO_EN[normPhrase(a)] = b; PH_TO_AR[normPhrase(b)] = a; }
  else { PH_TO_AR[normPhrase(a)] = b; PH_TO_EN[normPhrase(b)] = a; }
}
const MAX_PHRASE = 4;

function isWord(t: string): boolean {
  return /[\p{L}\p{M}\p{N}]/u.test(t);
}
function hasArabic(t: string): boolean {
  return AR_RE.test(t);
}
function hasLatin(t: string): boolean {
  return /[a-z]/i.test(t);
}

// ------------------------------------------------------------------ lookups

function lookupEn(w: string): string | null {
  const hit = (k: string): string | null => (k in EN_AR ? EN_AR[k] : null);
  let r: string | null;
  if ((r = hit(w)) !== null) return r;

  const tryWord = (k: string): string | null => (k.length >= 2 ? hit(k) : null);

  // plurals / 3rd-person -s
  if (w.endsWith('ies') && w.length > 4) { if ((r = tryWord(w.slice(0, -3) + 'y')) !== null) return r; }
  if (w.endsWith('ses') && w.length > 5) { if ((r = tryWord(w.slice(0, -2))) !== null) return r; }
  if (w.endsWith('es') && w.length > 4) {
    if ((r = tryWord(w.slice(0, -1))) !== null) return r; // loves → love
    if ((r = tryWord(w.slice(0, -2))) !== null) return r;
  }
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) {
    if ((r = tryWord(w.slice(0, -1))) !== null) return r;
  }
  // past -ed
  if (w.endsWith('ied') && w.length > 4) { if ((r = tryWord(w.slice(0, -3) + 'y')) !== null) return r; }
  if (w.endsWith('ed') && w.length > 4) {
    if ((r = tryWord(w.slice(0, -1))) !== null) return r; // loved → love
    if ((r = tryWord(w.slice(0, -2))) !== null) return r; // walked → walk
    if ((r = tryWord(w.slice(0, -2).replace(/(.)\1$/, '$1'))) !== null) return r; // stopped → stop
  }
  // gerund -ing
  if (w.endsWith('ing') && w.length > 5) {
    const base = w.slice(0, -3);
    if ((r = tryWord(base)) !== null) return r; // reading → read
    if ((r = tryWord(base.replace(/(.)\1$/, '$1'))) !== null) return r; // running → run
    if ((r = tryWord(base + 'e')) !== null) return r; // writing → write
  }
  // adverb -ly
  if (w.endsWith('ly') && w.length > 4) {
    const base = w.slice(0, -2);
    if ((r = tryWord(base)) !== null) return r; // quick → quick-ly
    if ((r = tryWord(base.slice(0, -1) + 'y')) !== null) return r; // happily → happy
  }
  // comparative / superlative
  if (w.endsWith('est') && w.length > 5) {
    if ((r = tryWord(w.slice(0, -2))) !== null) return r; // largest → large
    if ((r = tryWord(w.slice(0, -3))) !== null) return r;
    if ((r = tryWord(w.slice(0, -3).replace(/(.)\1$/, '$1'))) !== null) return r; // biggest → big
  }
  if (w.endsWith('er') && w.length > 4) {
    if ((r = tryWord(w.slice(0, -1))) !== null) return r; // larger → large
    if ((r = tryWord(w.slice(0, -2))) !== null) return r;
    if ((r = tryWord(w.slice(0, -2).replace(/(.)\1$/, '$1'))) !== null) return r; // bigger → big
  }
  return null;
}

// Arabic prefixes (conjunction/preposition + ال) and common suffixes.
const AR_PREFIXES = ['', 'و', 'ف', 'ب', 'ل', 'ك', 'ال', 'وال', 'فال', 'بال', 'لل'];
const AR_SUFFIXES = ['', 'ات', 'ون', 'ين', 'ها', 'هم', 'هن', 'كم', 'نا', 'ية', 'ها', 'ه', 'ك', 'ي', 'ت'];

function lookupAr(w: string): string | null {
  if (w in AR_EN) return AR_EN[w];
  for (const p of AR_PREFIXES) {
    if (!p) continue;
    if (!w.startsWith(p)) continue;
    const base = w.slice(p.length);
    if (base.length < 2) continue;
    if (base in AR_EN) return AR_EN[base];
    for (const s of AR_SUFFIXES) {
      if (!s) continue;
      if (!base.endsWith(s)) continue;
      const cand = base.slice(0, base.length - s.length);
      if (cand.length < 2) continue;
      if (cand in AR_EN) return AR_EN[cand];
    }
  }
  // suffix-only fallback (no prefix)
  for (const s of AR_SUFFIXES) {
    if (!s) continue;
    if (!w.endsWith(s)) continue;
    const cand = w.slice(0, w.length - s.length);
    if (cand.length < 3) continue;
    if (cand in AR_EN) return AR_EN[cand];
  }
  return null;
}

// ------------------------------------------------------------------ engine

export function offlineTranslate(text: string, target: 'ar' | 'en'): OfflineTranslation | null {
  if (!text) return null;
  const tokens = text.match(TOKEN_RE);
  if (!tokens || tokens.length === 0) return null;

  const words = tokens.map(isWord); // parallel: token i is a word?
  const normTokens: string[] = [];
  for (let i = 0; i < tokens.length; i++) normTokens.push(words[i] ? normWord(tokens[i]) : tokens[i]);

  const toAr = target === 'ar';
  const eligible = (i: number): boolean =>
    words[i] && (toAr ? hasLatin(tokens[i]) && !hasArabic(tokens[i]) : hasArabic(tokens[i]));

  // phrase maps in this direction
  const phMap = toAr ? PH_TO_AR : PH_TO_EN;

  const out: string[] = [];
  let eligibleCount = 0;
  let translatedCount = 0;
  let i = 0;

  while (i < tokens.length) {
    if (!words[i]) {
      // punctuation — attach to previous output (no leading space) unless it opens a group
      if (out.length === 0 || OPENERS.has(tokens[i])) out.push(tokens[i]);
      else out[out.length - 1] += tokens[i];
      i++;
      continue;
    }

    // longest phrase match first
    let matched = false;
    const maxN = Math.min(MAX_PHRASE, tokens.length - i);
    for (let n = maxN; n >= 2 && !matched; n--) {
      // all tokens in the window must be words
      let allWords = true;
      for (let k = 0; k < n; k++) if (!words[i + k]) { allWords = false; break; }
      if (!allWords) continue;
      const key = normTokens.slice(i, i + n).join(' ');
      const tr = phMap[key];
      if (tr !== undefined) {
        if (tr !== '') out.push(tr);
        for (let k = 0; k < n; k++) {
          if (eligible(i + k)) { eligibleCount++; translatedCount++; }
        }
        i += n;
        matched = true;
      }
    }
    if (matched) continue;

    // single word
    if (eligible(i)) {
      eligibleCount++;
      const tr = toAr ? lookupEn(normTokens[i]) : lookupAr(normTokens[i]);
      if (tr !== null) {
        translatedCount++;
        if (tr !== '') out.push(tr);
      } else {
        out.push(tokens[i]); // unknown — pass through
      }
    } else {
      out.push(tokens[i]); // already in target language (or a number) — pass through
    }
    i++;
  }

  if (eligibleCount === 0) return null;
  const coverage = translatedCount / eligibleCount;
  if (coverage < 0.15) return null;

  return { translation: out.join(' ').replace(/\s+([،؛,.!?:%)\]}»”])/g, '$1').trim(), coverage };
}

// ------------------------------------------------------------------ language packs
// Downloaded packs (IndexedDB 'langpacks' store) cached in memory once loaded.
// Each pack provides EN→X (forward) and X→EN (reverse, first-wins) maps plus
// EN→X phrase entries; morphology-lite is applied on the ENGLISH side only
// (stemming runs before pack lookup, exactly like the built-in dictionary).

import * as db from './idb';

interface PackMaps {
  code: string;
  rtl: boolean;
  forward: Record<string, string>;      // normalized english word → X
  reverse: Record<string, string>;      // normalized X word → english
  phrases: Record<string, string>;      // normalized english phrase → X
  reversePhrases: Record<string, string>; // normalized X phrase → english
}

let packCache: PackMaps[] | null = null;
let packLoadPromise: Promise<PackMaps[]> | null = null;

// English words that must WIN reverse-map collisions (e.g. French 'est' is
// both 'is' and 'east' — 'is' is orders of magnitude more common).
const COMMON_EN = new Set([
  'is', 'the', 'be', 'to', 'of', 'in', 'on', 'at', 'and', 'or', 'but', 'not', 'it', 'he', 'she', 'we', 'they',
  'this', 'that', 'with', 'for', 'from', 'by', 'as', 'have', 'has', 'had', 'was', 'were', 'are', 'am', 'do',
  'does', 'did', 'can', 'will', 'would', 'should', 'must', 'may', 'might', 'what', 'who', 'when', 'where',
  'why', 'how', 'i', 'you', 'my', 'your', 'his', 'her', 'our', 'their', 'no', 'yes', 'go', 'come', 'make',
  'get', 'give', 'take', 'know', 'think', 'see', 'look', 'want', 'need', 'find', 'tell', 'say', 'put', 'got',
]);

function buildPackMaps(pack: LangPack): PackMaps {
  const forward: Record<string, string> = {};
  const reverse: Record<string, string> = {};
  for (const [en, x] of Object.entries(pack.entries ?? {})) {
    const k = normPhrase(en);
    if (!k || !x) continue;
    forward[k] = x;
    const rk = normWord(String(x));
    if (rk) {
      const prev = reverse[rk];
      // first-wins, EXCEPT a common English word beats a rare one
      if (prev === undefined || (!COMMON_EN.has(prev) && COMMON_EN.has(k))) reverse[rk] = k;
    }
  }
  const phrases: Record<string, string> = {};
  const reversePhrases: Record<string, string> = {};
  for (const [en, x] of Object.entries(pack.phrases ?? {})) {
    const k = normPhrase(en);
    if (!k || !x) continue;
    phrases[k] = x;
    const rk = normPhrase(String(x));
    if (rk && !(rk in reversePhrases)) reversePhrases[rk] = k;
  }
  return { code: pack.code, rtl: pack.rtl, forward, reverse, phrases, reversePhrases };
}

async function loadPacks(): Promise<PackMaps[]> {
  if (packCache) return packCache;
  if (packLoadPromise) return packLoadPromise;
  packLoadPromise = (async () => {
    try {
      const packs = await db.listLangPacks();
      packCache = packs.map(buildPackMaps);
    } catch {
      packCache = [];
    }
    return packCache;
  })();
  return packLoadPromise;
}

/** Drop the in-memory pack cache (after a download / delete in Settings). */
export function invalidatePackCache(): void {
  packCache = null;
  packLoadPromise = null;
}

/** @internal test seam: inject packs directly (unit tests have no IndexedDB;
 *  production always loads from the database via loadPacks). */
export function __injectPacks(packs: LangPack[]): void {
  packCache = packs.map(buildPackMaps);
  packLoadPromise = Promise.resolve(packCache);
}

function lookupPackWord(w: string, packs: PackMaps[], dir: 'forward' | 'reverse'): string | null {
  for (const p of packs) {
    const m = dir === 'forward' ? p.forward : p.reverse;
    if (w in m) return m[w];
  }
  return null;
}

// ------------------------------------------------------------------ generic pipeline
// Token-walk shared by all offline directions: longest-phrase match first
// (via the supplied phrase maps, tried in order), then word resolution
// through a chain of steps (first non-null wins).

interface Pipeline {
  phraseMaps: Record<string, string>[];                   // longest-match first
  reversePhraseMaps: Record<string, string>[];
  /** second hop for reverse-phrase hits: maps the English phrase into the
   *  real target (e.g. French→English→Arabic); identity when not supplied */
  resolveReversePhrase?: (englishPhrase: string) => string;
  resolveWord: (norm: string, raw: string, isLatin: boolean, isArabic: boolean) => string | null;
}

function runPipeline(text: string, pipe: Pipeline): OfflineTranslation | null {
  if (!text) return null;
  const tokens = text.match(TOKEN_RE);
  if (!tokens || tokens.length === 0) return null;

  const words = tokens.map(isWord);
  const normTokens: string[] = [];
  for (let i = 0; i < tokens.length; i++) normTokens.push(words[i] ? normWord(tokens[i]) : tokens[i]);

  const out: string[] = [];
  let eligibleCount = 0;
  let translatedCount = 0;
  let i = 0;

  while (i < tokens.length) {
    if (!words[i]) {
      if (out.length === 0 || OPENERS.has(tokens[i])) out.push(tokens[i]);
      else out[out.length - 1] += tokens[i];
      i++;
      continue;
    }

    const isLatin = hasLatin(tokens[i]) && !hasArabic(tokens[i]);
    const isArabic = hasArabic(tokens[i]);
    if (isLatin || isArabic) eligibleCount++;

    // phrase maps: pack phrases on the source side first, then reverse pack
    // phrases (X→EN), both tried longest-first
    let matched = false;
    const maxN = Math.min(MAX_PHRASE, tokens.length - i);
    for (let n = maxN; n >= 2 && !matched; n--) {
      let allWords = true;
      for (let k = 0; k < n; k++) if (!words[i + k]) { allWords = false; break }
      if (!allWords) continue;
      const key = normTokens.slice(i, i + n).join(' ');
      // source-language phrase (e.g. French phrase → English) BEFORE target maps;
      // a two-hop phrase (e.g. French→English→Arabic) resolves through the
      // pipeline's second-hop resolver when supplied
      for (const map of pipe.reversePhraseMaps) {
        const tr = map[key];
        if (tr !== undefined) {
          out.push(pipe.resolveReversePhrase ? pipe.resolveReversePhrase(tr) : tr);
          for (let k = 0; k < n; k++) {
            if (words[i + k] && (hasLatin(tokens[i + k]) || hasArabic(tokens[i + k]))) translatedCount++;
          }
          i += n;
          matched = true;
          break;
        }
      }
      if (matched) break;
      for (const map of pipe.phraseMaps) {
        const tr = map[key];
        if (tr !== undefined) {
          if (tr !== '') out.push(tr);
          for (let k = 0; k < n; k++) {
            if (words[i + k] && (hasLatin(tokens[i + k]) || hasArabic(tokens[i + k]))) translatedCount++;
          }
          i += n;
          matched = true;
          break;
        }
      }
    }
    if (matched) continue;

    const tr = pipe.resolveWord(normTokens[i], tokens[i], isLatin, isArabic);
    if (tr !== null) {
      translatedCount++;
      if (tr !== '') out.push(tr);
    } else {
      out.push(tokens[i]); // unknown — pass through
    }
    i++;
  }

  if (eligibleCount === 0) return null;
  const coverage = translatedCount / eligibleCount;
  if (coverage < 0.15) return null;

  return { translation: out.join(' ').replace(/\s+([،؛,.!?:%)\]}»”])/g, '$1').trim(), coverage };
}

// ------------------------------------------------------------------ async pack-aware engine

/**
 * Offline translation with downloaded packs + the built-in AR↔EN dictionary.
 * Direction logic (English pivot):
 *   target ar/en:
 *     Arabic source → built-in AR→EN (target en) / pass-through (target ar)
 *     Latin source → pack reverses (X→EN) then built-in EN→AR (target ar)
 *   target pack X:
 *     Arabic source → built-in AR→EN then pack EN→X
 *     Latin source → pack EN→X (assumes English source)
 */
export async function translateOffline(text: string, target: string): Promise<OfflineResult | null> {
  const packs = await loadPacks();
  const targetPack = packs.find((p) => p.code === target) ?? null;
  const toAr = target === 'ar';
  const toEn = target === 'en';

  // No pack for the target and target is covered by the built-in dictionary:
  // pure built-in path (identical semantics to the sync engine).
  if ((toAr || toEn) && packs.length === 0) {
    const r = offlineTranslate(text, toAr ? 'ar' : 'en');
    return r ? { ...r, via: 'builtin' } : null;
  }

  // helper: stem-lite on the ENGLISH side (same heuristics as the built-in path)
  const enStem = (w: string): string[] => {
    const cands = [w];
    if (w.endsWith('ies') && w.length > 4) cands.push(w.slice(0, -3) + 'y');
    if (w.endsWith('es') && w.length > 4) { cands.push(w.slice(0, -1)); cands.push(w.slice(0, -2)) }
    if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) cands.push(w.slice(0, -1));
    if (w.endsWith('ed') && w.length > 4) { cands.push(w.slice(0, -1)); cands.push(w.slice(0, -2)); cands.push(w.slice(0, -2).replace(/(.)\1$/, '$1')) }
    if (w.endsWith('ing') && w.length > 5) { const b = w.slice(0, -3); cands.push(b, b.replace(/(.)\1$/, '$1'), b + 'e') }
    if (w.endsWith('ly') && w.length > 4) cands.push(w.slice(0, -2));
    return [...new Set(cands)];
  };

  let pipe: Pipeline;
  let via: OfflineResult['via'];

  if (toAr || toEn) {
    // ---- target ar / en (built-in core, packs help with foreign Latin sources)
    via = packs.length ? 'pack-pivot' : 'builtin';
    const otherPacks = packs.filter((p) => p.code !== target);
    pipe = {
      phraseMaps: toAr ? [PH_TO_AR] : [PH_TO_EN],
      reversePhraseMaps: otherPacks.map((p) => p.reversePhrases),
      resolveReversePhrase: toAr
        ? (enPhrase) => PH_TO_AR[normPhrase(enPhrase)] ?? enPhrase
        : undefined,
      resolveWord: (norm, raw, isLatin, isArabic) => {
        if (isArabic) {
          if (toAr) return null;           // already the target script → pass through
          const en = lookupAr(norm);       // built-in AR→EN (with morphology)
          return en;
        }
        if (isLatin) {
          if (!toAr) {
            // Latin → English: try pack reverses first (e.g. French word)
            return lookupPackWord(norm, otherPacks, 'reverse');
          }
          // Latin → Arabic: pack reverse (FR→EN) then built-in EN→AR
          const en = lookupPackWord(norm, otherPacks, 'reverse') ?? norm;
          const ar = lookupEn(en);
          return ar;
        }
        return null;
      },
    };
  } else if (targetPack) {
    // ---- target is a downloaded pack language (X)
    via = 'pack';
    const forward = targetPack.forward;
    pipe = {
      phraseMaps: [targetPack.phrases],
      reversePhraseMaps: [],
      resolveWord: (norm, raw, isLatin, isArabic) => {
        if (isArabic) {
          const en = lookupAr(norm);       // AR→EN built-in
          if (en === null) return null;
          // find the pack translation of the English pivot (stem-lite chain)
          for (const cand of enStem(en)) if (cand in forward) return forward[cand];
          return null;                     // pivot worked but pack lacks the word
        }
        if (isLatin) {
          for (const cand of enStem(norm)) if (cand in forward) return forward[cand];
          return null;
        }
        return null;
      },
    };
  } else {
    // target language requested but its pack is not installed → built-in only
    const r = offlineTranslate(text, toAr ? 'ar' : 'en');
    return r ? { ...r, via: 'builtin' } : null;
  }

  const r = runPipeline(text, pipe);
  if (!r) return null;
  // mirror the source's sentence capitalization in the output
  let translation = r.translation;
  if (text && translation && /^\s*[A-Z\u0600-\u06FF\u0400-\u04FF]/.test(text)) {
    translation = translation.replace(/^\s*([\p{L}\p{M}\p{N}])/u, (m) => m.toUpperCase());
  }
  return { translation, coverage: r.coverage, via };
}

// phrase maps for the pipeline are the built-in phrase tables (AR↔EN)
// (PH_TO_AR / PH_TO_EN built at module init above)
