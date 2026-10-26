'use client';
// InputSettingsSheet — "Pen & input" settings opened from the editor top bar.
// Lets the user customize:
//   • stylus hardware buttons (barrel / barrel-2 / eraser end) and the pen
//     double-tap — works with every stylus the browser reports (Apple Pencil,
//     Samsung S Pen, Surface Slim Pen, Wacom EMR, USI, Lenovo/LG…);
//   • a LIVE pen-engine card: the detected pen's family, its real
//     capabilities (pressure / tilt / hover / report rate) and which hardware
//     buttons have actually been observed on THIS pen — the app "reads" the
//     pen and coordinates the shortcut mapping with it;
//   • finger gestures (double tap, two-finger tap);
//   • finger drawing + stylus-only mode (same settings as the toolbar).
import { useSyncExternalStore } from 'react';
import { Hand, Pencil, PenLine, Smartphone, Zap } from 'lucide-react';
import { getPenInfo, subscribePen } from '@/lib/nanote/penengine';
import { useApp, useT } from '@/lib/nanote/store';
import type { FingerAction, PenAction } from '@/lib/nanote/types';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

const PEN_ACTIONS: PenAction[] = [
  'none', 'eraserHold', 'eraserToggle', 'pen', 'highlighter', 'laser',
  'lasso', 'text', 'shape', 'pan', 'undo', 'redo', 'pagePrev', 'pageNext',
];
const FINGER_ACTIONS: FingerAction[] = ['zoom', 'undo', 'redo', 'eraserToggle', 'pen', 'none'];

export function InputSettingsSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useT();
  const penShortcuts = useApp((s) => s.settings.penShortcuts);
  const fingerGestures = useApp((s) => s.settings.fingerGestures);
  const fingerDrawing = useApp((s) => s.settings.fingerDrawing);
  const stylusOnly = useApp((s) => s.settings.stylusOnly);
  const setSettings = useApp((s) => s.setSettings);

  // live pen profile from the pen engine (updates while the sheet is open)
  const pen = useSyncExternalStore(subscribePen, getPenInfo);

  const penLabel = (a: PenAction) => t(`input.action.${a}`);
  const fingerLabel = (a: FingerAction) => t(`input.action.${a}`);

  const caps: { label: string; on: boolean }[] = [
    { label: t('input.pen.pressure'), on: pen.pressure },
    { label: t('input.pen.tilt'), on: pen.tilt },
    { label: t('input.pen.hover'), on: pen.hover },
  ];
  const btns: { label: string; observed: boolean }[] = [
    { label: t('input.barrel'), observed: (pen.buttons & 2) !== 0 },
    { label: t('input.barrel2'), observed: (pen.buttons & 4) !== 0 },
    { label: t('input.eraser'), observed: (pen.buttons & 32) !== 0 },
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[85dvh] max-w-2xl overflow-y-auto nanote-scroll rounded-t-2xl p-0"
      >
        <SheetHeader className="border-b border-border px-4 py-3">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Pencil className="h-4 w-4" /> {t('input.title')}
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-5 p-4 pb-24">
          {/* ------------------------------------------------ pen & hardware buttons */}
          <section aria-label={t('input.penSection')}>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <Pencil className="h-4 w-4" /> {t('input.penSection')}
            </h3>

            {/* ---------- live pen-engine card: what the app detected */}
            <div className="mb-3 rounded-xl border border-border bg-card p-3">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                    pen.detected ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
                  )}
                  aria-hidden
                >
                  <PenLine className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {pen.detected ? pen.label : t('input.detectedPen')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {pen.detected
                      ? [
                          pen.rateHz >= 60 ? `${pen.rateHz} Hz` : null,
                        ].filter(Boolean).join(' · ') || t('input.pen.engine')
                      : t('input.noPenYet')}
                  </p>
                </div>
              </div>
              {pen.detected ? (
                <div className="mt-2.5 flex flex-wrap gap-1.5" aria-label={t('input.pen.capabilities')}>
                  {caps.map((c) => (
                    <span
                      key={c.label}
                      className={cn(
                        'rounded-full border px-2 py-0.5 text-[11px] font-medium',
                        c.on
                          ? 'border-primary/40 bg-primary/10 text-primary'
                          : 'border-border bg-muted/60 text-muted-foreground/70 line-through',
                      )}
                    >
                      {c.label}
                    </span>
                  ))}
                </div>
              ) : null}
              {pen.detected ? (
                <div className="mt-2 border-t border-border pt-2">
                  <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">
                    {t('input.pen.buttonsTitle')}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {btns.map((b) => (
                      <span
                        key={b.label}
                        className={cn(
                          'flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
                          b.observed
                            ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                            : 'border-dashed border-border bg-muted/40 text-muted-foreground/70',
                        )}
                      >
                        <Zap className="h-3 w-3" aria-hidden />
                        {b.label}
                        {b.observed ? ` · ${t('input.observed')}` : ''}
                      </span>
                    ))}
                  </div>
                  {!pen.buttons ? (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                      {t('input.pen.noButtons')}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="space-y-3 rounded-xl border border-border bg-card p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">{t('settings.fingerDrawing')}</span>
                <Switch
                  checked={fingerDrawing}
                  onCheckedChange={(v) => void setSettings({ fingerDrawing: v })}
                  aria-label={t('settings.fingerDrawing')}
                />
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">{t('settings.fingerDrawing.hint')}</p>

              <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                <span className="text-sm font-medium">{t('settings.stylusOnly')}</span>
                <Switch
                  checked={stylusOnly}
                  onCheckedChange={(v) => void setSettings({ stylusOnly: v })}
                  aria-label={t('settings.stylusOnly')}
                />
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">{t('settings.stylusOnly.hint')}</p>
            </div>

            <div className="mt-3 space-y-2.5">
              <Row label={t('input.barrel')} observed={(pen.buttons & 2) !== 0}>
                <Select
                  value={penShortcuts.barrel}
                  onValueChange={(v) => void setSettings({ penShortcuts: { ...penShortcuts, barrel: v as PenAction } })}
                >
                  <SelectTrigger className="h-9 w-44" aria-label={t('input.barrel')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PEN_ACTIONS.map((a) => (
                      <SelectItem key={a} value={a}>{penLabel(a)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Row>
              <Row label={t('input.barrel2')} observed={(pen.buttons & 4) !== 0}>
                <Select
                  value={penShortcuts.barrel2}
                  onValueChange={(v) => void setSettings({ penShortcuts: { ...penShortcuts, barrel2: v as PenAction } })}
                >
                  <SelectTrigger className="h-9 w-44" aria-label={t('input.barrel2')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PEN_ACTIONS.map((a) => (
                      <SelectItem key={a} value={a}>{penLabel(a)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Row>
              <Row label={t('input.eraser')} observed={(pen.buttons & 32) !== 0}>
                <Select
                  value={penShortcuts.eraser ?? 'eraserHold'}
                  onValueChange={(v) => void setSettings({ penShortcuts: { ...penShortcuts, eraser: v as PenAction } })}
                >
                  <SelectTrigger className="h-9 w-44" aria-label={t('input.eraser')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PEN_ACTIONS.map((a) => (
                      <SelectItem key={a} value={a}>{penLabel(a)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Row>
              <Row label={t('input.doubleTap')} observed>
                <Select
                  value={penShortcuts.doubleTap}
                  onValueChange={(v) => void setSettings({ penShortcuts: { ...penShortcuts, doubleTap: v as PenAction } })}
                >
                  <SelectTrigger className="h-9 w-44" aria-label={t('input.doubleTap')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PEN_ACTIONS.map((a) => (
                      <SelectItem key={a} value={a}>{penLabel(a)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Row>
            </div>
            <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
              <Smartphone className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {t('input.devicesHint')}
            </p>
          </section>

          {/* ------------------------------------------------ finger gestures */}
          <section aria-label={t('input.fingerSection')}>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <Hand className="h-4 w-4" /> {t('input.fingerSection')}
            </h3>
            <div className="space-y-2.5 rounded-xl border border-border bg-card p-3">
              <Row label={t('input.fingerDoubleTap')}>
                <Select
                  value={fingerGestures.doubleTap}
                  onValueChange={(v) => void setSettings({ fingerGestures: { ...fingerGestures, doubleTap: v as FingerAction } })}
                >
                  <SelectTrigger className="h-9 w-44" aria-label={t('input.fingerDoubleTap')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FINGER_ACTIONS.map((a) => (
                      <SelectItem key={a} value={a}>{fingerLabel(a)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Row>
              <Row label={t('input.twoFingerTap')}>
                <Select
                  value={fingerGestures.twoFingerTap}
                  onValueChange={(v) => void setSettings({ fingerGestures: { ...fingerGestures, twoFingerTap: v as FingerAction } })}
                >
                  <SelectTrigger className="h-9 w-44" aria-label={t('input.twoFingerTap')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FINGER_ACTIONS.map((a) => (
                      <SelectItem key={a} value={a}>{fingerLabel(a)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Row>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{t('input.gesturesHint')}</p>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Row({ label, observed, children }: { label: string; observed?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
        <span className="truncate">{label}</span>
        {observed === true ? (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"
            title="detected on this pen"
            aria-label="detected on this pen"
          />
        ) : null}
        {observed === false ? (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-border" aria-hidden />
        ) : null}
      </span>
      {children}
    </div>
  );
}
