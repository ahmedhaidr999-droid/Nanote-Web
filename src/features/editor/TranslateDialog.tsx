'use client';
// TranslateDialog — the in-app translation popup shown when the user picks
// "Translate" on selected PDF text. The user NEVER leaves the app:
//   • engine "google"  → Google's own web endpoints feed the popup (the same
//     translate.google.com quality, rendered in OUR window — no redirect).
//   • engine "app"     → Nanote's AI engine (/api/translate), with the Google
//     chain as fallback.
import { useEffect, useRef, useState } from 'react';
import { Languages, Loader2, Copy, Check, X, Globe, Sparkles } from 'lucide-react';
import { useApp, useT } from '@/lib/nanote/store';
import { translateViaGoogle } from '@/lib/nanote/gtranslate';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const TARGETS: { id: string; label: string }[] = [
  { id: 'ar', label: 'العربية' },
  { id: 'en', label: 'English' },
  { id: 'fr', label: 'Français' },
  { id: 'de', label: 'Deutsch' },
  { id: 'es', label: 'Español' },
  { id: 'tr', label: 'Türkçe' },
  { id: 'ur', label: 'اردو' },
  { id: 'fa', label: 'فارسی' },
  { id: 'hi', label: 'हिन्दी' },
  { id: 'ru', label: 'Русский' },
];

type Via = 'google' | 'mymemory' | 'nanote';

export function TranslateDialog({ text, onClose }: { text: string; onClose: () => void }) {
  const { t, lang } = useT();
  const settingsLang = useApp((s) => s.settings.lang);
  const engine = useApp((s) => s.settings.translateEngine);
  const [target, setTarget] = useState<string>(settingsLang === 'ar' ? 'ar' : 'en');
  const [state, setState] = useState<'loading' | 'done' | 'error'>('loading');
  const [result, setResult] = useState<{ detected: string; translation: string; via: Via } | null>(null);
  const [copied, setCopied] = useState(false);
  const reqIdRef = useRef(0);

  useEffect(() => {
    const id = ++reqIdRef.current;
    const abort = new AbortController();
    const finish = (r: { detected: string; translation: string; via: Via }) => {
      if (reqIdRef.current !== id) return;
      setResult(r);
      setState('done');
    };
    const fail = () => {
      if (reqIdRef.current !== id || abort.signal.aborted) return;
      setState('error');
    };

    if (engine === 'google') {
      // 1 — Google's own web engines feed OUR popup (user stays in the app)
      void translateViaGoogle(text, target, abort.signal)
        .then((r) => {
          if (reqIdRef.current !== id || abort.signal.aborted) return;
          if (r) finish({ detected: r.detected, translation: r.translation, via: r.via === 'mymemory' ? 'mymemory' : 'google' });
          else return translateOnlineNanote(text, target, abort.signal).then((r2) => {
            if (r2) finish({ ...r2, via: 'nanote' });
            else fail();
          });
        })
        .catch(() => {
          void translateOnlineNanote(text, target, abort.signal)
            .then((r2) => { if (r2) finish({ ...r2, via: 'nanote' }); else fail() })
            .catch(fail);
        });
    } else {
      // 1 — Nanote's AI engine, Google chain as fallback
      void translateOnlineNanote(text, target, abort.signal)
        .then((r) => {
          if (reqIdRef.current !== id || abort.signal.aborted) return;
          if (r) return finish({ ...r, via: 'nanote' });
          return translateViaGoogle(text, target, abort.signal).then((g) => {
            if (g) finish({ detected: g.detected, translation: g.translation, via: g.via === 'mymemory' ? 'mymemory' : 'google' });
            else fail();
          });
        })
        .catch(() => {
          void translateViaGoogle(text, target, abort.signal)
            .then((g) => { if (g) finish({ detected: g.detected, translation: g.translation, via: g.via === 'mymemory' ? 'mymemory' : 'google' }); else fail() })
            .catch(fail);
        });
    }
    return () => abort.abort();
  }, [text, target, engine]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result?.translation ?? '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch { /* ignore */ }
  };

  const viaBadge = result?.via === 'google'
    ? t('translate.via.google', 'via Google', 'عبر غوغل')
    : result?.via === 'mymemory'
      ? t('translate.via.mymemory', 'via web engine', 'عبر محرك الويب')
      : t('translate.via.nanote', 'via Nanote AI', 'عبر ذكاء نانوت');

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}
      role="dialog"
      aria-modal="true"
      aria-label={t('translate.title')}
    >
      <div className="flex max-h-[80dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-ink-2">
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          {engine === 'google'
            ? <Globe className="h-5 w-5 text-primary" />
            : <Sparkles className="h-5 w-5 text-primary" />}
          <h2 className="text-sm font-semibold">{t('translate.title')}</h2>
          <span className="ms-auto" />
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t('common.close')} onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="flex flex-col gap-3 overflow-y-auto nanote-scroll p-4" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
          {/* source text */}
          <section>
            <div className="mb-1 text-xs font-medium text-muted-foreground">{t('translate.source')}</div>
            <div className="max-h-32 overflow-y-auto nanote-scroll rounded-lg bg-surface-variant p-3 text-sm leading-relaxed whitespace-pre-wrap">
              {text}
            </div>
          </section>

          {/* target selector */}
          <div className="flex flex-wrap items-center gap-1.5">
            {TARGETS.map((tg) => (
              <button
                key={tg.id}
                type="button"
                aria-pressed={target === tg.id}
                onClick={() => {
                  if (target === tg.id) return;
                  setTarget(tg.id);
                  setState('loading');
                  setResult(null);
                }}
                className={cn(
                  'rounded-full px-3 py-1.5 text-xs font-medium press-scale',
                  target === tg.id ? 'bg-primary text-primary-foreground' : 'bg-surface-variant hover:bg-accent',
                )}
              >
                {tg.label}
              </button>
            ))}
          </div>

          {/* translation */}
          <section>
            <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              {t('translate.result')}
              {state === 'done' && result?.detected ? (
                <span className="rounded-full bg-surface-variant px-2 py-0.5 text-[10px]">
                  {t('translate.detected')}: {result.detected}
                </span>
              ) : null}
              {state === 'done' && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">{viaBadge}</span>
              )}
              {state === 'done' && (
                <button
                  type="button"
                  className="ms-auto flex items-center gap-1 text-[11px] hover:text-foreground"
                  onClick={() => void copy()}
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? t('translate.copied') : t('translate.copy')}
                </button>
              )}
            </div>
            {state === 'loading' && (
              <div className="flex items-center gap-2 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> {t('translate.loading')}
              </div>
            )}
            {state === 'error' && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {t('translate.failed')}
              </div>
            )}
            {state === 'done' && result && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm font-medium leading-relaxed whitespace-pre-wrap">
                {result.translation}
              </div>
            )}
          </section>
        </div>

        <footer className="flex items-center gap-2 border-t border-border px-4 py-3">
          <Languages className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span className="text-[11px] text-muted-foreground">
            {t('translate.inAppHint', 'Translated inside Nanote — you never left the page', 'تتم الترجمة داخل نانوت — لم تغادر الصفحة')}
          </span>
          <Button className="ms-auto h-9" onClick={onClose}>{t('common.done')}</Button>
        </footer>
      </div>
    </div>
  );
}

/** Nanote's own engine (backend /api/translate — LLM) */
async function translateOnlineNanote(text: string, target: string, signal: AbortSignal): Promise<{ detected: string; translation: string } | null> {
  try {
    const r = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, target }),
      signal,
    });
    if (!r.ok) return null;
    const data = (await r.json()) as { detected?: string; translation?: string; error?: string };
    if (data.error || !data.translation) return null;
    return { detected: data.detected ?? '', translation: data.translation };
  } catch {
    return null;
  }
}

/** web search popup for selected text */
export function openWebSearch(text: string) {
  const url = `https://www.google.com/search?q=${encodeURIComponent(text)}`;
  try {
    window.open(url, 'nanote-web-search', 'popup,width=560,height=700');
  } catch {
    window.open(url, '_blank');
  }
}
