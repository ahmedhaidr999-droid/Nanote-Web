'use client';
// TranslatePopup — the IN-APP translation window for selected PDF text.
// The user pressed "Google translate" / "Translate" but never leaves the app:
// the translation is fetched from Google's public web endpoints (same quality
// as translate.google.com, rendered inside OUR popup) or Nanote's online
// engine, with the offline dictionary as the last resort. Replaces the old
// toolbar card + the external translate.google.com redirect.
import { useEffect, useRef, useState } from 'react';
import { Languages, Loader2, Copy, Check, X, Globe, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useApp, useT } from '@/lib/nanote/store';
import { translateViaGoogle, type GoogleResult } from '@/lib/nanote/gtranslate';
import { translateOnline } from '@/lib/nanote/translate';
import { translateOffline } from '@/lib/nanote/offlineTranslate';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const TARGETS: { id: string; label: string }[] = [
  { id: 'ar', label: 'العربية' },
  { id: 'en', label: 'English' },
  { id: 'fr', label: 'Français' },
  { id: 'de', label: 'Deutsch' },
  { id: 'es', label: 'Español' },
  { id: 'tr', label: 'Türkçe' },
  { id: 'ru', label: 'Русский' },
  { id: 'fa', label: 'فارسی' },
  { id: 'ur', label: 'اردو' },
  { id: 'hi', label: 'हिन्दी' },
  { id: 'zh', label: '中文' },
];

type Via = 'google' | 'mymemory' | 'nanote' | 'offline';

interface PopupResult { translation: string; detected: string; via: Via }

export function TranslatePopup({
  text,
  initialTarget,
  onClose,
}: {
  text: string;
  initialTarget: string;
  onClose: () => void;
}) {
  const { t, lang } = useT();
  const engine = useApp((s) => s.settings.translateEngine);
  const [target, setTarget] = useState(initialTarget);
  const [state, setState] = useState<'loading' | 'done' | 'error'>('loading');
  const [result, setResult] = useState<PopupResult | null>(null);
  const [copied, setCopied] = useState(false);
  const reqIdRef = useRef(0);

  useEffect(() => {
    const id = ++reqIdRef.current;
    const ac = new AbortController();
    const stale = () => reqIdRef.current !== id || ac.signal.aborted;
    const finish = (r: PopupResult) => { if (!stale()) { setResult(r); setState('done') } };

    void (async () => {
      // engine-specific primary chain + shared fallbacks — the popup never
      // navigates away; everything renders inside the app.
      if (engine === 'google') {
        // 1 — Google's own web engines feed OUR popup
        const g = await translateViaGoogle(text, target, ac.signal).catch(() => null);
        if (stale()) return;
        if (g) return finish({ translation: g.translation, detected: g.detected, via: g.via === 'mymemory' ? 'mymemory' : 'google' });
        // 2 — Nanote's online chain (LLM route → MyMemory)
        const n = await translateOnline(text, target, ac.signal).catch(() => null);
        if (stale()) return;
        if (n) return finish({ translation: n.translation, detected: '', via: n.via === 'api' ? 'nanote' : 'mymemory' });
      } else {
        // 1 — Nanote's online chain (LLM route → MyMemory)
        const n = await translateOnline(text, target, ac.signal).catch(() => null);
        if (stale()) return;
        if (n) return finish({ translation: n.translation, detected: '', via: n.via === 'api' ? 'nanote' : 'mymemory' });
        // 2 — Google's own web engines keep the popup alive when MyMemory throttles
        const g = await translateViaGoogle(text, target, ac.signal).catch(() => null);
        if (stale()) return;
        if (g) return finish({ translation: g.translation, detected: g.detected, via: g.via === 'mymemory' ? 'mymemory' : 'google' });
      }
      // 3 — offline: downloaded pack or the built-in AR↔EN dictionary
      const off = await translateOffline(text, target).catch(() => null);
      if (stale()) return;
      if (off) return finish({ translation: off.translation, detected: '', via: 'offline' });
      if (!stale()) setState('error');
    })();
    return () => ac.abort();
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
    : result?.via === 'nanote'
      ? t('translate.via.nanote', 'via Nanote AI', 'عبر ذكاء نانوت')
      : result?.via === 'mymemory'
        ? t('translate.via.mymemory', 'via web engine', 'عبر محرك الويب')
        : t('translate.via.offline', 'offline dictionary', 'قاموس بدون اتصال');

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}
      role="dialog"
      aria-modal="true"
      aria-label={t('pdftext.translated', 'Translation', 'الترجمة')}
    >
      <div className="flex max-h-[80dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-ink-2">
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          {engine === 'google'
            ? <Globe className="h-5 w-5 text-primary" />
            : <Sparkles className="h-5 w-5 text-primary" />}
          <h2 className="text-sm font-semibold">{t('pdftext.translate', 'Translate', 'ترجمة')}</h2>
          <span className="ms-auto" />
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t('common.close', 'Close', 'إغلاق')} onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="flex flex-col gap-3 overflow-y-auto nanote-scroll p-4" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
          {/* source text */}
          <section>
            <div className="mb-1 text-xs font-medium text-muted-foreground">
              {t('translate.source', 'Selected text', 'النص المحدد')}
            </div>
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
              {t('translate.result', 'Translation', 'الترجمة')}
              {state === 'done' && result?.detected ? (
                <span className="rounded-full bg-surface-variant px-2 py-0.5 text-[10px]">
                  {t('translate.detected', 'Detected', 'اللغة المكتشفة')}: {result.detected}
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
                  {copied ? t('translate.copied', 'Copied', 'تم النسخ') : t('translate.copy', 'Copy', 'نسخ')}
                </button>
              )}
            </div>
            {state === 'loading' && (
              <div className="flex items-center gap-2 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('pdftext.translating', 'Translating…', 'جارٍ الترجمة…')}
              </div>
            )}
            {state === 'error' && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {t('pdftext.translate.error', 'Translation failed — check your connection.', 'فشلت الترجمة — تحقق من الاتصال بالإنترنت.')}
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
          <Button className="ms-auto h-9" onClick={onClose}>{t('common.done', 'Done', 'تم')}</Button>
        </footer>
      </div>
    </div>
  );
}
