'use client';
// PenManagerSheet — the full «الأقلام الإلكترونية» (Electronic pens) management
// interface, opened from Settings (and from the editor's Pen & input sheet):
//   • CONNECTED PEN — live identification card: detected model/family, report
//     rate, adaptive pressure calibration, tilt/hover, the bits its physical
//     buttons actually report, and WHICH bit got locked as the primary barrel;
//   • TEST PAD — write with the pen: a live trace plus real-time pressure,
//     tilt, hover and button meters (raw digitizer data, exactly what the app
//     receives);
//   • BUTTON SHORTCUTS — per trigger (barrel / barrel 2 / eraser end / tip
//     double-tap) and per PATTERN (single press while hovering, press while
//     writing, double press, long press) bound to any app action — rows the
//     current pen cannot produce are shown disabled with a reason;
//   • PEN MODEL — auto-detect or pick the exact model (tunes capability hints);
//   • PEN DATABASE — searchable (vendor + model), full sourced specs per pen:
//     pressure levels, tilt/hover, charging, buttons, eraser, gestures,
//     compatible devices, integration limits, per-field confidence and source
//     links; plus the EVENT matrix — what the pen can do, what the app can
//     bind, and what stays OS/vendor-controlled;
//   • DB UPDATE — fetches /api/pen-db and merges newer records at runtime
//     (the knowledge base updates without an app update).
import { useSyncExternalStore, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Check, Database, PenLine, Pencil, RefreshCw, Search, Trash2, Zap } from 'lucide-react';
import { toast } from 'sonner';
import {
  barrelMap, getPenInfo, PEN_MODELS, penSpecById, setPenProfile, subscribePen,
  subscribePenSamples, type PenSample, subscribePenLog, getPenLog, clearPenLog,
  simulatePenButton, isPenRouterActive, type PenLogEntry,
} from '@/lib/nanote/penengine';
import { bitmapBudgetInfo } from '@/lib/nanote/canvasbudget';
import {
  getPenDbVersion, getPenSpecs, mergePenDb, eventsForSpec,
  type Confidence, type StylusSpec,
} from '@/lib/nanote/pendb';
import { useApp, useT } from '@/lib/nanote/store';
import type { PenAction, PenTriggerBinding, PenShortcutPrefs } from '@/lib/nanote/types';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const PEN_ACTIONS: PenAction[] = [
  'none', 'eraserHold', 'eraserToggle', 'pen', 'highlighter', 'laser',
  'lasso', 'text', 'shape', 'pan', 'undo', 'redo', 'pagePrev', 'pageNext',
  'colorNext', 'widthUp', 'widthDown', 'zoomIn', 'zoomOut', 'toggleToolbar', 'quickExport',
];

export function PenManagerSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t, lang, fmt } = useT();
  const pen = useSyncExternalStore(subscribePen, getPenInfo);
  const prefs = useApp((s) => s.settings.penShortcuts);
  const profileId = useApp((s) => s.settings.penProfileId) ?? 'auto';
  const setSettings = useApp((s) => s.setSettings);
  const bmap = barrelMap();
  const [dbVersion, setDbVersion] = useState(getPenDbVersion());
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const specs = useMemo(() => getPenSpecs(), [dbVersion]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return specs;
    return specs.filter((s) =>
      s.vendor.toLowerCase().includes(q) ||
      s.name.toLowerCase().includes(q) ||
      (lang === 'ar' && s.nameAr.includes(query.trim())) ||
      (s.model ?? '').toLowerCase().includes(q) ||
      (s.generation ?? '').toLowerCase().includes(q));
  }, [specs, query, lang]);

  const activeSpec = penSpecById(profileId !== 'auto' ? profileId : null)
    ?? penSpecById(pen.profileId !== 'auto' ? pen.profileId : null)
    ?? specs.find((s) => s.id === 'generic-active') ?? null;

  const patchBinding = (trigger: 'barrel' | 'barrel2' | 'eraser', pattern: keyof PenTriggerBinding, act: PenAction) => {
    const cur: PenTriggerBinding = { ...prefs[trigger] };
    if (pattern === 'pressWriting') cur.pressWriting = act;
    else cur[pattern] = act;
    void setSettings({ penShortcuts: { ...prefs, [trigger]: cur } as PenShortcutPrefs });
  };

  const changePenProfile = (id: string) => {
    setPenProfile(id);
    void setSettings({ penProfileId: id });
  };

  const updateDb = async () => {
    try {
      const res = await fetch('/api/pen-db', { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const payload = await res.json();
      const { applied, version } = mergePenDb(payload);
      setDbVersion(getPenDbVersion());
      if (applied) toast.success(fmt(t('pens.db.updated'), { n: String(version) }));
      else toast.info(fmt(t('pens.db.upToDate'), { n: String(getPenDbVersion()) }));
    } catch {
      toast.info(fmt(t('pens.db.upToDate'), { n: String(getPenDbVersion()) }));
    }
  };

  const penLabel = (a: PenAction) => t(`input.action.${a}`);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[92dvh] max-w-2xl overflow-y-auto nanote-scroll rounded-t-2xl p-0"
      >
        <SheetHeader className="border-b border-border px-4 py-3">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Pencil className="h-4 w-4" /> {t('pens.title')}
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-5 p-4 pb-24">
          {/* ------------------------------------------------ connected pen + live data */}
          <section aria-label={t('pens.connected')}>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <PenLine className="h-4 w-4" /> {t('pens.connected')}
            </h3>
            <LivePenCard />
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              {pen.buttons & (2 | 4 | 8 | 16)
                ? fmt(t('pens.bitLocked'), { n: String(bmap.primary) })
                : t('input.pen.noButtons')}
            </p>
          </section>

          {/* ------------------------------------------------ test pad */}
          <section aria-label={t('pens.testPad')}>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <Zap className="h-4 w-4" /> {t('pens.testPad')}
            </h3>
            <TestPad />
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
              {t('pens.testPad.hint')}
            </p>
          </section>

          {/* ------------------------------------------------ diagnostics (live event monitor) */}
          <section aria-label={t('pens.diag.title', 'Diagnostics', 'التشخيص')}>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <Activity className="h-4 w-4" /> {t('pens.diag.title', 'Diagnostics', 'التشخيص')}
            </h3>
            <StylusDiagnostics penLabel={penLabel} />
          </section>

          {/* ------------------------------------------------ bindings */}
          <section aria-label={t('pens.bindings')}>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <Pencil className="h-4 w-4" /> {t('pens.bindings')}
            </h3>
            <div className="space-y-3">
              <TriggerEditor
                title={t('input.barrel')}
                supported={!!activeSpec?.buttons.some((b) => b.id === 'barrel')}
                binding={prefs.barrel}
                observed={(pen.buttons & bmap.primary) !== 0}
                onChange={patchBinding}
                trigger="barrel"
                penLabel={penLabel}
              />
              <TriggerEditor
                title={t('input.barrel2')}
                supported={!!activeSpec?.buttons.some((b) => b.id === 'barrel2')}
                binding={prefs.barrel2}
                observed={bmap.secondary != null && (pen.buttons & bmap.secondary) !== 0}
                onChange={patchBinding}
                trigger="barrel2"
                penLabel={penLabel}
              />
              <TriggerEditor
                title={t('input.eraser')}
                supported={activeSpec?.eraserEnd === true}
                binding={prefs.eraser}
                observed={(pen.buttons & 32) !== 0}
                onChange={patchBinding}
                trigger="eraser"
                penLabel={penLabel}
              />
              <div className="rounded-xl border border-border bg-card p-3">
                <BindingRow label={t('pens.tipDoubleTap')} hint={null} penLabel={penLabel}
                  value={prefs.doubleTap}
                  onChange={(a) => void setSettings({ penShortcuts: { ...prefs, doubleTap: a } })}
                />
              </div>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              {t('input.devicesHint')}
            </p>
          </section>

          {/* ------------------------------------------------ pen model picker */}
          <section aria-label={t('input.penModel')}>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <Pencil className="h-4 w-4" /> {t('input.penModel')}
            </h3>
            <div className="rounded-xl border border-border bg-card p-3">
              <Select value={profileId} onValueChange={changePenProfile}>
                <SelectTrigger className="h-9 w-full" aria-label={t('input.penModel')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="auto">
                    {t('input.penModel.auto')}
                    {pen.detected && profileId === 'auto' ? ` · ${pen.label}` : ''}
                  </SelectItem>
                  {(() => {
                    const models = PEN_MODELS();
                    const order: string[] = [];
                    const by = new Map<string, typeof models>();
                    for (const m of models) {
                      if (!by.has(m.vendor)) { by.set(m.vendor, []); order.push(m.vendor) }
                      by.get(m.vendor)!.push(m);
                    }
                    return order.map((vendor) => (
                      <SelectGroup key={vendor}>
                        <SelectLabel>{vendor}</SelectLabel>
                        {by.get(vendor)!.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {lang === 'ar' ? m.nameAr : m.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ));
                  })()}
                </SelectContent>
              </Select>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                {t('input.penModel.hint')}
              </p>
            </div>
          </section>

          {/* ------------------------------------------------ pen database browser */}
          <section aria-label={t('pens.database')}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                <Database className="h-4 w-4" /> {t('pens.database')}
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium tabular-nums">v{dbVersion}</span>
              </h3>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 rounded-full px-3 text-xs"
                onClick={() => void updateDb()}
                aria-label={t('pens.db.update')}
              >
                <RefreshCw className="h-3.5 w-3.5" /> {t('pens.db.update')}
              </Button>
            </div>
            <div className="relative mb-2">
              <Search className="absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('pens.db.search')}
                className="h-9 ps-9 text-sm"
                aria-label={t('pens.db.search')}
              />
            </div>
            <div className="max-h-96 overflow-y-auto nanote-scroll rounded-xl border border-border">
              {filtered.map((s) => (
                <PenSpecRow
                  key={s.id}
                  spec={s}
                  lang={lang}
                  expanded={expanded === s.id}
                  onToggle={() => setExpanded(expanded === s.id ? null : s.id)}
                  selected={profileId === s.id}
                />
              ))}
              {!filtered.length && (
                <p className="p-4 text-center text-sm text-muted-foreground">{t('library.search.noResults')}</p>
              )}
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------- live pen card
function LivePenCard() {
  const { t } = useT();
  const pen = useSyncExternalStore(subscribePen, getPenInfo);
  const bmap = barrelMap();
  const calibrating = pen.detected && pen.pressure && pen.pressureCeil - pen.pressureFloor < 0.88;
  const caps = [
    { label: t('input.pen.pressure'), on: pen.pressure },
    { label: t('input.pen.tilt'), on: pen.tilt },
    { label: t('input.pen.hover'), on: pen.hover },
  ];
  const btns = [
    { label: t('input.barrel'), observed: (pen.buttons & bmap.primary) !== 0 },
    { label: t('input.barrel2'), observed: bmap.secondary != null && (pen.buttons & bmap.secondary) !== 0 },
    { label: t('input.eraser'), observed: (pen.buttons & 32) !== 0 },
  ];
  return (
    <div className="rounded-xl border border-border bg-card p-3">
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
            {pen.detected ? pen.label : t('input.noPenYet')}
          </p>
          <p className="text-xs text-muted-foreground">
            {pen.detected
              ? [pen.rateHz >= 60 ? `${pen.rateHz} Hz` : null].filter(Boolean).join(' · ') || t('input.pen.engine')
              : t('input.noPenYet')}
          </p>
        </div>
      </div>
      {pen.detected && (
        <>
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
            {pen.pressure && (
              <span className="rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                {calibrating
                  ? `${t('input.pen.calibrated')} ${pen.pressureFloor.toFixed(2)}–${pen.pressureCeil.toFixed(2)} → 0–1`
                  : '0–1'}
              </span>
            )}
          </div>
          <div className="mt-2 border-t border-border pt-2">
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
                  {b.label}{b.observed ? ` · ${t('input.observed')}` : ''}
                </span>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- test pad
function TestPad() {
  const { t } = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastPt = useRef<{ x: number; y: number } | null>(null);
  const [live, setLive] = useState<PenSample | null>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    let latest: PenSample | null = null;
    const off = subscribePenSamples((s) => { latest = s });
    const tick = () => {
      setLive(latest);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { off(); cancelAnimationFrame(rafRef.current) };
  }, []);

  // draw the trace: every pen sample observed WHILE the pad hovers is drawn —
  // simpler & honest: the pad draws its OWN pointer events
  const onPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    if (e.type === 'pointerdown') {
      lastPt.current = { x, y };
      return;
    }
    if (e.type === 'pointermove' && (e.buttons & 1 || e.pressure > 0)) {
      const prev = lastPt.current ?? { x, y };
      ctx.strokeStyle = e.pressure > 0 ? '#1E6FF2' : 'rgba(30,111,242,0.35)';
      ctx.lineWidth = 1 + (e.pressure || 0.4) * 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      ctx.lineTo(x, y);
      ctx.stroke();
      lastPt.current = { x, y };
    }
    if (e.type === 'pointerup' || e.type === 'pointerleave') lastPt.current = null;
  };

  const clearPad = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = canvas.width; // resets the bitmap
  };

  const bits = live ? live.buttons & (2 | 4 | 8 | 16 | 32) : 0;
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <canvas
        ref={canvasRef}
        width={560}
        height={200}
        className="h-[200px] w-full touch-none rounded-lg bg-white dark:bg-white"
        onPointerDown={onPointer}
        onPointerMove={onPointer}
        onPointerUp={onPointer}
        onPointerLeave={onPointer}
        aria-label={t('pens.testPad')}
        role="img"
      />
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Meter
          label={t('pens.pressureNow')}
          value={live ? live.pressure : 0}
          text={live ? live.pressure.toFixed(2) : '—'}
          on={!!live && live.pressure > 0.015}
        />
        <Meter
          label={t('pens.tiltNow')}
          value={live ? live.tiltDeg / 90 : 0}
          text={live ? `${Math.round(live.tiltDeg)}°` : '—'}
          on={!!live && live.tiltDeg > 1}
        />
        <Meter
          label={t('pens.hoverNow')}
          value={live && live.hover ? 1 : 0}
          text={live ? (live.hover ? '✓' : '—') : '—'}
          on={!!live && live.hover}
        />
        <Meter
          label={t('pens.buttonsNow')}
          value={bits ? 1 : 0}
          text={bits ? [...(bits & 2 ? [2] : []), ...(bits & 4 ? [4] : []), ...(bits & 8 ? [8] : []), ...(bits & 16 ? [16] : []), ...(bits & 32 ? ['E'] : [])].join(' · ') : '—'}
          on={bits !== 0}
        />
      </div>
      <div className="mt-2 flex justify-end">
        <Button variant="ghost" size="sm" className="h-7 rounded-full px-3 text-[11px]" onClick={clearPad}>
          {t('common.clear', 'Clear', 'مسح')}
        </Button>
      </div>
    </div>
  );
}

function Meter({ label, value, text, on }: { label: string; value: number; text: string; on: boolean }) {
  return (
    <div className={cn('rounded-lg border px-2 py-1.5', on ? 'border-primary/40 bg-primary/5' : 'border-border')}>
      <div className="flex items-center justify-between text-[10px] font-medium text-muted-foreground">
        <span className="truncate">{label}</span>
        <span className="tabular-nums">{text}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-75"
          style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- bindings editor
function TriggerEditor({
  title, supported, observed, binding, onChange, trigger, penLabel,
}: {
  title: string;
  supported: boolean;      // does the active pen profile have this control?
  observed: boolean;        // has the physical pen reported it this session?
  binding: PenTriggerBinding;
  onChange: (trigger: 'barrel' | 'barrel2' | 'eraser', pattern: keyof PenTriggerBinding, act: PenAction) => void;
  trigger: 'barrel' | 'barrel2' | 'eraser';
  penLabel: (a: PenAction) => string;
}) {
  const { t } = useT();
  return (
    <div className={cn('rounded-xl border border-border bg-card p-3', !supported && 'opacity-60')}>
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          {title}
          {observed && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-label={t('input.observed')} />}
        </p>
        {!supported && (
          <span className="rounded-full border border-dashed border-border bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground">
            {t('pens.event.unsupported')}
          </span>
        )}
      </div>
      <div className="space-y-2">
        <BindingRow
          label={t('pens.pattern.press')}
          hint={binding.pressWriting ? null : t('pens.pattern.pressWriting')}
          disabled={!supported}
          value={binding.press}
          penLabel={penLabel}
          onChange={(a) => onChange(trigger, 'press', a)}
        />
        <BindingRow
          label={t('pens.pattern.pressWriting')}
          hint={null}
          disabled={!supported}
          value={binding.pressWriting ?? binding.press}
          penLabel={penLabel}
          onChange={(a) => onChange(trigger, 'pressWriting', a)}
        />
        <BindingRow
          label={t('pens.pattern.double')}
          hint={null}
          disabled={!supported}
          value={binding.double}
          penLabel={penLabel}
          onChange={(a) => onChange(trigger, 'double', a)}
        />
        <BindingRow
          label={t('pens.pattern.long')}
          hint={null}
          disabled={!supported}
          value={binding.long}
          penLabel={penLabel}
          onChange={(a) => onChange(trigger, 'long', a)}
        />
      </div>
    </div>
  );
}

function BindingRow({ label, hint, value, onChange, penLabel, disabled }: {
  label: string;
  hint: string | null;
  value: PenAction;
  onChange: (a: PenAction) => void;
  penLabel: (a: PenAction) => string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-xs font-medium">{label}</p>
        {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
      </div>
      <Select value={value} onValueChange={(v) => onChange(v as PenAction)} disabled={disabled}>
        <SelectTrigger className="h-8 w-44 text-xs" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-64">
          {PEN_ACTIONS.map((a) => (
            <SelectItem key={a} value={a} className="text-xs">{penLabel(a)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ---------------------------------------------------------------- pen spec browser
const CONF_STYLE: Record<Confidence, string> = {
  official: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  community: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  unverified: 'border-border bg-muted/50 text-muted-foreground',
};

function PenSpecRow({ spec, lang, expanded, onToggle, selected }: {
  spec: StylusSpec;
  lang: 'en' | 'ar';
  expanded: boolean;
  onToggle: () => void;
  selected: boolean;
}) {
  const { t } = useT();
  const events = useMemo(() => eventsForSpec(spec), [spec]);
  const bool = (v: boolean | null | undefined) =>
    v == null ? t('pens.conf.unavailable') : v ? '✓' : '✗';
  return (
    <div className={cn('border-b border-border last:border-0', selected && 'bg-primary/5')}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-start hover:bg-accent/50"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            <span className="text-muted-foreground">{spec.vendor}</span>
            {' · '}
            {lang === 'ar' ? spec.nameAr : spec.name}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {[
              spec.pressureLevels ? `${spec.pressureLevels} ${t('pens.spec.pressure')}` : null,
              spec.protocol.toUpperCase(),
              spec.releaseYear ? String(spec.releaseYear) : null,
            ].filter(Boolean).join(' · ')}
          </p>
        </div>
        {selected && <Check className="h-4 w-4 shrink-0 text-primary" aria-label="selected" />}
      </button>
      {expanded && (
        <div className="space-y-3 px-3 pb-3">
          {/* specs table */}
          <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 rounded-lg border border-border p-2.5 text-xs sm:grid-cols-2">
            <SpecField label={t('pens.spec.vendor')} value={spec.vendor} />
            <SpecField label={t('pens.spec.model')} value={spec.model || spec.generation || t('pens.conf.unavailable')} />
            <SpecField label={t('pens.spec.year')} value={spec.releaseYear ? String(spec.releaseYear) : t('pens.conf.unavailable')} />
            <SpecField label={t('pens.spec.platforms')} value={spec.platforms.join(' · ')} />
            <SpecField label={t('pens.spec.connection')} value={spec.connection} />
            <SpecField label={t('pens.spec.charging')} value={spec.charging ?? t('pens.conf.unavailable')} />
            <SpecField label={t('pens.spec.pressure')} value={spec.pressureLevels ? String(spec.pressureLevels) : t('pens.conf.unavailable')} />
            <SpecField label={t('pens.spec.tilt')} value={bool(spec.tilt)} />
            <SpecField label={t('pens.spec.hover')} value={bool(spec.hover)} />
            <SpecField label={t('pens.spec.palm')} value={bool(spec.palmRejection)} />
            <SpecField label={t('pens.spec.buttons')} value={spec.buttons.length ? spec.buttons.map((b) => (lang === 'ar' ? b.labelAr : b.label)).join(', ') : t('pens.conf.unavailable')} />
            <SpecField label={t('pens.spec.eraser')} value={bool(spec.eraserEnd)} />
            <SpecField label={t('pens.spec.gestures')} value={bool(spec.bodyDoubleTap)} />
          </div>
          {/* events matrix */}
          <div className="rounded-lg border border-border p-2.5">
            <p className="mb-1.5 text-[11px] font-semibold text-muted-foreground">{t('pens.bindings')}</p>
            <div className="flex flex-wrap gap-1.5">
              {events.filter((e) => e.supported).map((e) => (
                <span
                  key={e.def.id}
                  title={lang === 'ar' ? (e.def.noteAr ?? e.def.note) : e.def.note}
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-[10px] font-medium',
                    e.receivable
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      : 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400',
                  )}
                >
                  {lang === 'ar' ? e.def.labelAr : e.def.label}
                  {' · '}
                  {e.receivable ? t('pens.event.supported') : t('pens.event.os')}
                </span>
              ))}
              {events.filter((e) => e.supported && !e.receivable).length === 0 && events.some((e) => e.supported) && (
                <span className="text-[10px] text-muted-foreground">—</span>
              )}
            </div>
          </div>
          {/* integration + devices */}
          <div className="rounded-lg border border-border p-2.5">
            <p className="mb-1 text-[11px] font-semibold text-muted-foreground">{t('pens.spec.integration')}</p>
            <p className="text-xs leading-relaxed">{spec.integration}</p>
            <p className="mb-1 mt-2 text-[11px] font-semibold text-muted-foreground">{t('pens.spec.devices')}</p>
            <p className="text-xs leading-relaxed">{spec.devices}</p>
          </div>
          {/* confidence + sources */}
          <div className="rounded-lg border border-border p-2.5">
            <div className="mb-1.5 flex flex-wrap gap-1.5">
              <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', CONF_STYLE[spec.confidence.specs])}>
                {t('pens.spec.pressure')}: {t(`pens.conf.${spec.confidence.specs}`)}
              </span>
              <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', CONF_STYLE[spec.confidence.buttons])}>
                {t('pens.spec.buttons')}: {t(`pens.conf.${spec.confidence.buttons}`)}
              </span>
              <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', CONF_STYLE[spec.confidence.gestures])}>
                {t('pens.spec.gestures')}: {t(`pens.conf.${spec.confidence.gestures}`)}
              </span>
            </div>
            <p className="mb-1 text-[11px] font-semibold text-muted-foreground">{t('pens.spec.sources')}</p>
            <ul className="space-y-0.5">
              {spec.sources.length ? spec.sources.map((s, i) => (
                <li key={i} className="text-[11px] leading-relaxed">
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                      {s.label} ↗
                    </a>
                  ) : (
                    <span className="text-muted-foreground">{s.label}</span>
                  )}
                </li>
              )) : (
                <li className="text-[11px] text-muted-foreground">{t('pens.conf.unavailable')}</li>
              )}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function SpecField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2">
      <span className="shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-xs font-medium" title={value}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------- diagnostics
/** StylusDiagnostics — the live "why don't my pen buttons work" debugger.
 *  Shows the complete shortcut chain as it happens:
 *    raw pointer event (down/move/up/cancel/hover, decimated)
 *    → button pattern recognized (bit + press/double/long, hover vs writing)
 *    → binding matched → action EXECUTED
 *  plus the engine snapshot (identified pen, report rate, pressure
 *  calibration, observed button bits, primary/secondary mapping), the
 *  router status (shortcuts only fire while a notebook is open) and the
 *  device render budget. The SIMULATE button fires a synthetic barrel
 *  press through the exact same engine pipeline — proving the chain works
 *  even before touching the hardware.
 */
function StylusDiagnostics({ penLabel }: { penLabel: (a: PenAction) => string }) {
  const { t } = useT();
  const pen = useSyncExternalStore(subscribePen, getPenInfo);
  const entries = useSyncExternalStore(subscribePenLog, getPenLog);
  const routerOn = useSyncExternalStore(subscribeIsRouterActive, isPenRouterActive);
  const bmap = barrelMap();
  const budget = bitmapBudgetInfo();
  const logRef = useRef<HTMLDivElement>(null);
  const prefs = useApp((s) => s.settings.penShortcuts);
  const shortcutsOn = useApp((s) => s.settings.penShortcutsOn);

  // keep the newest entry in view
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries]);

  const kindStyle: Record<string, string> = {
    down: 'border-primary/40 bg-primary/10 text-primary',
    up: 'border-border bg-muted/50 text-foreground',
    move: 'border-border bg-muted/40 text-muted-foreground',
    hover: 'border-border bg-muted/40 text-muted-foreground',
    cancel: 'border-warning/40 bg-warning/10 text-warning',
    button: 'border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400',
    action: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    info: 'border-border bg-muted/40 text-muted-foreground',
  };

  const snapshot: { label: string; value: string }[] = [
    { label: t('pens.diag.router', 'Shortcut router', 'محرك الاختصارات'), value: routerOn ? t('pens.diag.routerOn', 'active (notebook open)', 'نشط (دفتر مفتوح)') : t('pens.diag.routerOff', 'idle — open a notebook', 'خامل — افتح دفتراً') },
    { label: t('pens.diag.shortcuts', 'Shortcuts enabled', 'الاختصارات مفعّلة'), value: shortcutsOn ? t('common.on', 'On', 'مفعّل') : t('common.off', 'Off', 'معطّل') },
    { label: t('pens.diag.pen', 'Detected pen', 'القلم المكتشف'), value: pen.detected ? `${pen.label} · ${pen.rateHz || '—'} Hz` : t('input.noPenYet') },
    { label: t('pens.diag.bits', 'Button bits seen', 'بتات الأزرار المرصودة'), value: pen.buttons ? `0b${pen.buttons.toString(2)} (primary=${bmap.primary}${bmap.secondary ? `, secondary=${bmap.secondary}` : ''})` : '—' },
    { label: t('pens.diag.pressure', 'Pressure calibration', 'معايرة الضغط'), value: pen.pressure ? `${pen.pressureFloor.toFixed(2)}–${pen.pressureCeil.toFixed(2)} → 0–1` : '—' },
    { label: t('pens.diag.budget', 'Render budget', 'ميزانية الرسم'), value: `${(budget.areaPx / 1e6).toFixed(1)} MPx · ${budget.memoryGB} GB${budget.embedded ? ' · split' : ''}` },
  ];

  const boundAction = prefs.barrel.press !== 'none' ? penLabel(prefs.barrel.press) : null;

  return (
    <div className="space-y-3">
      {/* engine snapshot */}
      <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 rounded-xl border border-border bg-card p-3 text-xs sm:grid-cols-2">
        {snapshot.map((s) => (
          <SpecField key={s.label} label={s.label} value={s.value} />
        ))}
      </div>

      {/* simulate + clear */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 rounded-full px-3 text-xs"
          onClick={() => simulatePenButton(bmap.primary, 'press')}
          disabled={!routerOn}
          aria-label={t('pens.diag.simulate', 'Simulate barrel press', 'محاكاة ضغط الزر')}
        >
          <Zap className="h-3.5 w-3.5" /> {t('pens.diag.simulate', 'Simulate barrel press', 'محاكاة ضغط الزر')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 rounded-full px-3 text-xs"
          onClick={() => clearPenLog()}
          aria-label={t('pens.diag.clear', 'Clear log', 'مسح السجل')}
        >
          <Trash2 className="h-3.5 w-3.5" /> {t('pens.diag.clear', 'Clear log', 'مسح السجل')}
        </Button>
        {boundAction && (
          <span className="text-[11px] text-muted-foreground">
            {t('pens.diag.bound', 'barrel press →', 'ضغط الزر ←')} <span className="font-medium text-foreground">{boundAction}</span>
          </span>
        )}
      </div>

      {/* live event log */}
      <div
        ref={logRef}
        className="max-h-56 overflow-y-auto nanote-scroll rounded-xl border border-border bg-card p-2 font-mono text-[11px]"
        role="log"
        aria-label={t('pens.diag.log', 'Event log', 'سجل الأحداث')}
        aria-live="polite"
      >
        {entries.length === 0 ? (
          <p className="px-1 py-3 text-center text-[11px] text-muted-foreground">
            {t('pens.diag.empty', 'Use the pen (or press its buttons) — every event the app receives appears here.', 'استخدم القلم أو اضغط أزراره — كل حدث يستقبله التطبيق يظهر هنا.')}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {entries.slice(-40).map((e: PenLogEntry) => (
              <li key={e.id} className="flex items-center gap-1.5 px-1 py-0.5">
                <span className={cn('shrink-0 rounded border px-1 py-px text-[10px] font-semibold uppercase', kindStyle[e.kind] ?? kindStyle.info)}>
                  {e.kind}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{Math.round(e.t / 100) / 10}s</span>
                <span className="min-w-0 truncate">
                  {e.pointerType}
                  {e.pointerId >= 0 ? `#${e.pointerId}` : ''}
                  {' · btn='}{e.button}{' · bits='}{e.buttons}
                  {e.pressure ? ` · p=${e.pressure.toFixed(2)}` : ''}
                  {e.hover ? ' · hover' : ''}
                  {e.note ? ` · ${e.note}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {t('pens.diag.limit', 'Note: buttons the OS or pen vendor handles internally (e.g. some Bluetooth-launched actions) never reach apps and cannot be rebound.', 'ملاحظة: الأزرار التي يتعامل معها النظام أو الشركة المصنعة داخلياً لا تصل إلى التطبيقات ولا يمكن إعادة برمجتها.')}
      </p>
    </div>
  );
}

function subscribeIsRouterActive(cb: () => void): () => void {
  return subscribePen(cb); // engine emits on router-state changes too (cheap, same store cadence)
}
