// Ask AI — the text-selection "Ask <AI>" action. Copies the selected text to
// the clipboard (so it is always available to paste) and opens the chosen
// assistant with the text prefilled AND auto-submitted via its URL parameter:
//   • ChatGPT  → https://chatgpt.com/?q=<text>      (custom link — auto-sends)
//   • Gemini   → https://gemini.google.com/app?q=<text> (URL prompt — auto-sends)
//   • Claude   → https://claude.ai/new?q=<text>     (prefills the composer)
// In the standalone APK the WebView hands the URL to the system, which opens
// the assistant's app (or browser) — the user asked for exactly this trip.
import type { Settings } from './types';

export type AiService = NonNullable<Settings['aiService']>;

export const AI_SERVICES: AiService[] = ['chatgpt', 'gemini', 'claude'];

/** brand names shown in Settings and on the Ask button */
export function aiName(svc: AiService): string {
  if (svc === 'gemini') return 'Gemini';
  if (svc === 'claude') return 'Claude';
  return 'ChatGPT';
}

/** URL that opens the assistant with the text submitted */
export function aiUrl(svc: AiService, text: string): string {
  const q = encodeURIComponent(text.slice(0, 1200));
  if (svc === 'gemini') return `https://gemini.google.com/app?q=${q}`;
  if (svc === 'claude') return `https://claude.ai/new?q=${q}`;
  return `https://chatgpt.com/?q=${q}`;
}

/**
 * Copy the text (safety net for networks that strip URL params), then open the
 * assistant. Resolves with the service name so callers can toast it.
 */
export async function askAI(svc: AiService, text: string): Promise<string> {
  const name = aiName(svc);
  try { await navigator.clipboard.writeText(text) } catch { /* clipboard unavailable — URL still carries the text */ }
  const url = aiUrl(svc, text);
  try {
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch {
    window.open(url, '_blank');
  }
  return name;
}
