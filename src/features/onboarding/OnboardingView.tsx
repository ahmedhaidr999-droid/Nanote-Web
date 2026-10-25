'use client';
// Nanote onboarding — a 3-slide intro shown only on first launch
// (settings.onboarded === false routes here via the shell).
import { useRef, useState, type TouchEvent } from 'react';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, Loader2, PenLine } from 'lucide-react';
import { useApp, useT } from '@/lib/nanote/store';
import { AppWordmark } from '@/components/nanote/AppIcon';
import { Button } from '@/components/ui/button';
import { SlideArt1, SlideArt2, SlideArt3 } from './slides';

const SLIDE_COUNT = 3;

export default function OnboardingView() {
  const { t, isRTL, fmt } = useT();
  const completeOnboarding = useApp((s) => s.completeOnboarding);
  const [index, setIndex] = useState(0);
  const [starting, setStarting] = useState(false);
  const touchX = useRef<number | null>(null);

  const isLast = index === SLIDE_COUNT - 1;

  const goNext = () => setIndex((i) => Math.min(i + 1, SLIDE_COUNT - 1));
  const goPrev = () => setIndex((i) => Math.max(i - 1, 0));

  // Start (and Skip) → seed the welcome notebook and enter the library.
  const start = async () => {
    if (starting) return;
    setStarting(true);
    try {
      await completeOnboarding();
      toast.success(t('onb.seeded'));
    } catch (e) {
      console.error('[nanote] onboarding failed', e);
      toast.error(t('error.generic'));
      setStarting(false);
    }
  };

  // swipe: in RTL the reading flow is mirrored, so "next" flips too.
  const onTouchStart = (e: TouchEvent<HTMLElement>) => {
    touchX.current = e.touches[0]?.clientX ?? null;
  };
  const onTouchEnd = (e: TouchEvent<HTMLElement>) => {
    const sx = touchX.current;
    touchX.current = null;
    if (sx == null) return;
    const dx = (e.changedTouches[0]?.clientX ?? sx) - sx;
    const nextSign = isRTL ? 1 : -1;
    if (dx * nextSign > 48) goNext();
    else if (dx * nextSign < -48) goPrev();
  };

  const slides = [
    { art: <SlideArt1 />, title: t('onb.1.title'), body: t('onb.1.body') },
    { art: <SlideArt2 />, title: t('onb.2.title'), body: t('onb.2.body') },
    { art: <SlideArt3 />, title: t('onb.3.title'), body: t('onb.3.body') },
  ];
  const slide = slides[index];

  return (
    <main
      aria-label={t('onb.welcome')}
      className="relative flex min-h-0 flex-1 flex-col bg-background"
    >
      {/* skip — straight to the library */}
      <button
        type="button"
        onClick={() => void start()}
        disabled={starting}
        className="press-scale absolute end-4 top-4 z-10 rounded-full px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        {t('common.skip')}
      </button>

      <header className="mt-10 flex justify-center px-4">
        <AppWordmark size={44} />
      </header>

      {/* slides */}
      <section
        className="flex min-h-0 flex-1 items-center justify-center px-6 py-8"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div
          key={index}
          className="view-enter mx-auto flex w-full max-w-md flex-col items-center gap-5 text-center"
        >
          {slide.art}
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{slide.title}</h1>
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground sm:text-base">
            {slide.body}
          </p>
        </div>
      </section>

      {/* dots + navigation */}
      <footer className="mx-auto w-full max-w-md px-6 pb-10 sm:pb-12">
        <div className="mb-6 flex items-center justify-center gap-2" role="tablist">
          {slides.map((s, i) => (
            <button
              key={s.title}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={fmt(t('onb.step', 'Step {n}', 'الخطوة {n}'), { n: i + 1 })}
              onClick={() => setIndex(i)}
              className={`press-scale h-2 rounded-full transition-all duration-200 ${
                i === index
                  ? 'w-6 bg-primary'
                  : 'w-2 bg-muted-foreground/30 hover:bg-muted-foreground/50'
              }`}
            />
          ))}
        </div>
        <div className="flex items-center justify-center gap-3">
          <Button
            type="button"
            variant="outline"
            className="press-scale h-12 w-12 rounded-full p-0"
            onClick={goPrev}
            disabled={index === 0}
            aria-label={t('common.back')}
          >
            <ArrowLeft className="rtl:-scale-x-100" />
          </Button>
          {isLast ? (
            <Button
              type="button"
              className="press-scale h-12 min-w-44 rounded-full px-6 py-3 text-base font-semibold"
              onClick={() => void start()}
              disabled={starting}
            >
              {starting ? <Loader2 className="animate-spin" /> : <PenLine />}
              {t('onb.start')}
            </Button>
          ) : (
            <Button
              type="button"
              className="press-scale h-12 min-w-44 rounded-full px-6 py-3 text-base font-semibold"
              onClick={goNext}
            >
              {t('common.next')}
              <ArrowRight className="rtl:-scale-x-100" />
            </Button>
          )}
        </div>
      </footer>
    </main>
  );
}
