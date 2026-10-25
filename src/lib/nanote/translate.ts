// Translation platform helpers — shared by the editor's selection toolbar and
// the Settings translation section. The app is an INDEPENDENT platform:
// translation runs on the internet when a connection exists (Nanote's LLM
// engine, or the Google Translate popup) and falls back to language packs
// the user downloaded from the in-app language library when offline.
import type { Settings } from './types';

/** Resolve the configured translate-into language. 'auto' follows the UI
 *  language; anything else is an explicit ISO code (built-in 'ar'/'en' or a
 *  downloaded pack like 'fr'). */
export function resolveTranslateTarget(settings: Settings): string {
  if (settings.translateTarget === 'auto') return settings.lang === 'ar' ? 'ar' : 'en';
  return settings.translateTarget;
}

/** Google Translate popup URL for a selected passage (sl=auto detects the
 *  source; tl is the target; op=translate pre-fills the text box). */
export function googleTranslateUrl(text: string, target: string): string {
  const params = new URLSearchParams({
    sl: 'auto',
    tl: target,
    op: 'translate',
    text: text.slice(0, 4000),
  });
  return `https://translate.google.com/?${params.toString()}`;
}

/** Human label for a language code (UI-language aware names for ar/en; the
 *  pack's native name otherwise). Returns the code when unknown. */
export function langLabel(code: string, lang: 'en' | 'ar', packs: { code: string; nativeName: string; name: string }[]): string {
  if (code === 'ar') return lang === 'ar' ? 'العربية' : 'Arabic';
  if (code === 'en') return lang === 'ar' ? 'الإنجليزية' : 'English';
  const pack = packs.find((p) => p.code === code);
  return pack ? `${pack.nativeName}` : code;
}

// ---------------------------------------------------------------- internet engines

export interface OnlineResult {
  translation: string;
  via: 'api' | 'web'; // Nanote LLM route | public web engine (MyMemory)
}

/** Decode the HTML entities MyMemory sometimes leaves in its output. */
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** Split a passage into ≤maxLen pieces on sentence boundaries (the public
 *  web engine has a short per-request query cap). Best-effort: a piece
 *  without separators is hard-split at the cap. */
function splitForWeb(text: string, maxLen: number): string[] {
  const t = text.trim();
  if (t.length <= maxLen) return t ? [t] : [];
  const parts: string[] = [];
  let buf = '';
  for (const m of t.match(/[^.!?؟।\n]+[.!?؟।\n]*/g) ?? [t]) {
    let piece = m;
    if ((buf + piece).length > maxLen && buf) { parts.push(buf); buf = '' }
    while (piece.length > maxLen) { // pathological unbroken run
      parts.push(piece.slice(0, maxLen));
      piece = piece.slice(maxLen);
    }
    buf += piece;
  }
  if (buf.trim()) parts.push(buf);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** One MyMemory query (public web translation engine, auto source detect). */
async function webEngineOnce(q: string, target: string, signal?: AbortSignal): Promise<string | null> {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=${encodeURIComponent(`Autodetect|${target}`)}`;
  const r = await fetch(url, { signal });
  if (!r.ok) return null;
  const j = (await r.json()) as {
    responseData?: { translatedText?: string };
    responseStatus?: number | string;
    quotaFinished?: boolean;
  };
  const out = j?.responseData?.translatedText;
  // MyMemory signals quota/encoding problems inside the payload text itself
  if (typeof out !== 'string' || !out.trim()) return null;
  if (/MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID (SOURCE|TARGET)/i.test(out)) return null;
  if (j.quotaFinished) return null;
  return decodeEntities(out);
}

/**
 * INTERNET translation for the independent app platform — the user-facing
 * requirement: translation works ONLINE while the app is used.
 *
 * Chain (first success wins, all under the caller's abort signal):
 *   1. POST /api/translate — Nanote's own LLM engine (the dev/staging
 *      server; inside the static APK export this 404s instantly and costs
 *      nothing).
 *   2. The public MyMemory web API — a real online translation service
 *      with auto source-language detection; works identically in the
 *      browser and inside the APK (the only requirement is the INTERNET
 *      permission, which v1.3.0 declares for exactly this purpose).
 *
 * Returns null when both engines fail (offline, throttled, timeout) — the
 * caller then falls back to the downloaded offline language packs.
 */
export async function translateOnline(text: string, target: string, signal?: AbortSignal): Promise<OnlineResult | null> {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return null;

  // 1 — Nanote's own LLM route
  try {
    const r = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: trimmed, target }),
      signal,
    });
    if (r.ok) {
      const j = (await r.json()) as { translation?: string };
      if (j.translation && String(j.translation).trim()) {
        return { translation: String(j.translation), via: 'api' };
      }
    }
  } catch { /* offline / 404 in the APK export / aborted — fall through */ }
  if (signal?.aborted) return null;

  // 2 — public web engine (chunked to its short per-query cap)
  try {
    const chunks = splitForWeb(trimmed, 450).slice(0, 3); // up to ~1350 chars
    const outs: string[] = [];
    for (const c of chunks) {
      const one = await webEngineOnce(c, target, signal);
      if (one === null) return null; // engine-wide failure — go to packs
      outs.push(one);
    }
    if (outs.length) return { translation: outs.join(' ').trim(), via: 'web' };
  } catch { /* offline / aborted — fall through */ }
  return null;
}
