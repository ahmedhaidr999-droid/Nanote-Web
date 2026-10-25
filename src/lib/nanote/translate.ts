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
