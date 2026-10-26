'use client';
// InputSettingsSheet — "Pen & input" settings opened from the editor top bar.
// Lets the user customize:
//   • stylus hardware buttons (barrel / barrel-2) and the pen double-tap —
//     works with every stylus the browser reports (Apple Pencil, Samsung
//     S Pen, Surface Slim Pen, Wacom EMR, USI, Lenovo/LG…);
//   • finger gestures (double tap, two-finger tap);
//   • finger drawing + stylus-only mode (same settings as the toolbar).
import { Hand, Pencil, Smartphone } from 'lucide-react';
import { useApp, useT } from '@/lib/nanote/store';
import type { FingerAction, PenAction } from '@/lib/nanote/types';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

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

  const penLabel = (a: PenAction) => t(`input.action.${a}`);
  const fingerLabel = (a: FingerAction) => t(`input.action.${a}`);

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
              <Row label={t('input.barrel')}>
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
              <Row label={t('input.barrel2')}>
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
              <Row label={t('input.doubleTap')}>
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </div>
  );
}
