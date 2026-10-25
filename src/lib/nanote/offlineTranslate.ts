// Offline translation engine — the in-app fallback when /api/translate is not
// reachable (the Android APK is a static export with zero server). Pure
// dictionary + light-morphology translation; quality is deliberately labeled
// "rough" by the UI. Zero dependencies, synchronous, deterministic.
//
// Public API:
//   offlineTranslate(text, 'ar' | 'en') → { translation, coverage } | null
//     target 'ar' → translate English source words to Arabic (Arabic words pass through)
//     target 'en' → translate Arabic source words to English (Latin words pass through)
//     returns null when there is nothing translatable (or coverage < 15%).

import { EN_AR, AR_EN_EXTRA, PHRASES } from './offlineDict';

export interface OfflineTranslation {
  translation: string;
  coverage: number; // 0..1 — translated eligible tokens / total eligible tokens
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
