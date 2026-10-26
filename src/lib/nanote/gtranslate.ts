// Google web-translate chain — the in-app popup's data source.
// The user pressed "Google translate" but must STAY inside the app: instead of
// redirecting to translate.google.com, we fetch the translation from Google's
// public web endpoints (they send `access-control-allow-origin: *`, so this
// works identically in the browser and inside the standalone APK WebView) and
// render it in our own popup window.
//
// Chain (first success wins, all under the caller's abort signal):
//   1. clients5.google.com/translate_a/t?client=dict-chrome-ex — Chrome's own
//      dictionary/translation endpoint (fast, sentence-aware, detects language).
//   2. translate.googleapis.com/translate_a/single?client=gtx — the classic
//      gtx endpoint (different rate-limit pool).
//   3. api.mymemory.translated.net — public fallback engine (best effort).
export interface GoogleResult {
  translation: string;
  detected: string; // source-language code ('en', 'ar', …) when known
  via: 'google' | 'mymemory';
}

/** decode the numeric HTML entities clients5 sometimes leaves behind */
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

/** Split long passages on sentence boundaries (each GET has a URL-length cap). */
function splitSentences(text: string, maxLen: number): string[] {
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

/** 1 — clients5 (dict-chrome-ex). Shape: [["translation","src"]] (one entry
 * per sentence when several are passed, so we concatenate all). */
async function clients5Once(q: string, target: string, signal?: AbortSignal): Promise<{ translation: string; detected: string } | null> {
  const url =
    `https://clients5.google.com/translate_a/t?client=dict-chrome-ex` +
    `&sl=auto&tl=${encodeURIComponent(target)}&q=${encodeURIComponent(q)}`;
  const r = await fetch(url, { signal });
  if (!r.ok) return null;
  const j: unknown = await r.json();
  // accepted shapes: [["hi","en"]] | [["a","en"],["b","en"]] | ["hi"]
  if (Array.isArray(j) && Array.isArray(j[0])) {
    if (typeof j[0][0] === 'string') {
      const out: string[] = [];
      let detected = '';
      for (const row of j as unknown[][]) {
        if (typeof row[0] === 'string') out.push(row[0]);
        if (typeof row[1] === 'string' && !detected) detected = row[1];
      }
      const joined = out.join('').trim();
      if (joined) return { translation: joined, detected };
    }
  } else if (Array.isArray(j) && typeof j[0] === 'string' && j[0].trim()) {
    return { translation: (j[0] as string).trim(), detected: '' };
  }
  return null;
}

/** 2 — the classic gtx endpoint. Shape:
 * [[["trans","orig",…],["trans2","orig2",…]], …, ["detected_lang",…]] */
async function gtxOnce(q: string, target: string, signal?: AbortSignal): Promise<{ translation: string; detected: string } | null> {
  const url =
    `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto` +
    `&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(q)}`;
  const r = await fetch(url, { signal });
  if (!r.ok) return null;
  const j: unknown = await r.json();
  if (!Array.isArray(j) || !Array.isArray(j[0])) return null;
  const out: string[] = [];
  for (const row of j[0] as unknown[][]) {
    if (typeof row[0] === 'string') out.push(row[0]);
  }
  const joined = out.join('').trim();
  if (!joined) return null;
  let detected = '';
  if (Array.isArray(j[2]) && typeof j[2][0] === 'string') detected = j[2][0];
  return { translation: joined, detected };
}

/** 3 — MyMemory public engine (best-effort fallback so the popup still works
 * when Google throttles the user's network). */
async function myMemoryOnce(q: string, target: string, signal?: AbortSignal): Promise<string | null> {
  const url =
    `https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}` +
    `&langpair=${encodeURIComponent(`Autodetect|${target}`)}`;
  const r = await fetch(url, { signal });
  if (!r.ok) return null;
  const j = (await r.json()) as { responseData?: { translatedText?: string }; quotaFinished?: boolean };
  const out = j?.responseData?.translatedText;
  if (typeof out !== 'string' || !out.trim()) return null;
  if (/MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID (SOURCE|TARGET)/i.test(out)) return null;
  if (j.quotaFinished) return null;
  return decodeEntities(out);
}

/**
 * Translate a passage via the Google web chain — entirely in the popup, the
 * user never leaves the app. Long passages are chunked on sentence boundaries
 * (up to ~2400 chars per call) and stitched back together.
 */
export async function translateViaGoogle(text: string, target: string, signal?: AbortSignal): Promise<GoogleResult | null> {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return null;
  const chunks = splitSentences(trimmed, 800).slice(0, 3);
  if (!chunks.length) return null;

  let detected = '';
  const outs: string[] = [];
  let via: 'google' | 'mymemory' = 'google';
  for (const c of chunks) {
    let one: { translation: string; detected: string } | null = null;
    try { one = await clients5Once(c, target, signal) } catch { /* throttled / offline */ }
    if (signal?.aborted) return null;
    if (!one) {
      try { one = await gtxOnce(c, target, signal) } catch { /* throttled / offline */ }
      if (signal?.aborted) return null;
    }
    if (one) {
      if (!detected && one.detected) detected = one.detected;
      outs.push(one.translation);
      continue;
    }
    // Google throttled this network — the public web engine keeps the popup alive
    const mm = await myMemoryOnce(c, target, signal).catch(() => null);
    if (signal?.aborted) return null;
    if (mm === null) return null; // engine-wide failure
    via = 'mymemory';
    outs.push(mm);
  }
  const translation = outs.join(' ').trim();
  if (!translation) return null;
  return { translation, detected, via };
}
