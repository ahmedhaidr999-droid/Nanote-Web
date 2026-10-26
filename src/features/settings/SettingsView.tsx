'use client';
// Nanote settings — appearance, writing preferences, data & backup, about.
// 100% local: every change persists via the Zustand store into IndexedDB.
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';
import {
  ArrowLeft,
  BookOpen,
  ChevronDown,
  Download,
  Eraser,
  FileText,
  Globe,
  Image as ImageIcon,
  Infinity as InfinityIcon,
  Languages,
  LayoutGrid,
  List,
  Loader2,
  MessagesSquare,
  Mic,
  Monitor,
  Moon,
  PanelBottom,
  PanelLeft,
  PanelRight,
  PanelTop,
  Feather,
  RefreshCw,
  Sparkles,
  Sun,
  TriangleAlert,
  Upload,
  Pencil,
} from 'lucide-react';
import { useApp, useT } from '@/lib/nanote/store';
import { PenManagerSheet } from '@/features/editor/PenManagerSheet';
import * as db from '@/lib/nanote/idb';
import type { StorageStats } from '@/lib/nanote/idb';
import { downloadBlob, fmtBytes } from '@/lib/nanote/util';
import { getAppVersion, openReleasesPage } from '@/lib/nanote/native';
import { computeOutline, pathOutline, type OP } from '@/lib/nanote/outline';
import { AppWordmark } from '@/components/nanote/AppIcon';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

// ---------------------------------------------------------------- shared bits

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="gap-4 rounded-xl p-4 shadow-ink-1 sm:p-6">
      <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-primary" />
        {title}
      </h2>
      {children}
    </Card>
  );
}

function Divider() {
  return <div aria-hidden="true" className="h-px w-full bg-border" />;
}

interface SegmentedOption<T> {
  value: T;
  label: string;
  icon?: ReactNode;
}

function Segmented<T extends string | number>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: SegmentedOption<T>[];
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="grid gap-1 rounded-lg bg-muted p-1"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`press-scale flex min-h-9 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors ${
              active
                ? 'bg-card text-foreground shadow-ink-1'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {o.icon}
            <span className="truncate">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function SwitchRow({
  label,
  hint,
  checked,
  onCheckedChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <Label htmlFor={id} className="cursor-pointer text-sm font-medium">
          {label}
        </Label>
        {hint && <p className="mt-1 text-xs leading-snug text-muted-foreground">{hint}</p>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
    </div>
  );
}

// ---------------------------------------------------------------- pressure live preview

function PressurePreview({ gamma }: { gamma: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight || 64;
    if (cssW <= 0) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const n = 40;
    const pts: OP[] = [];
    for (let i = 0; i < n; i++) {
      pts.push({
        x: 12 + (i / (n - 1)) * (cssW - 24),
        y: cssH / 2 + Math.sin(i * 0.35) * 4,
        p: Math.sin(Math.PI * (i / (n - 1))),
        v: 0.4,
      });
    }
    const outline = computeOutline(pts, { tool: 'fountain', width: 7, gamma });
    ctx.fillStyle = '#1E6FF2';
    pathOutline(ctx, outline);
    ctx.fill();
  }, [gamma]);

  // redraw whenever the pressure curve changes
  useEffect(() => {
    draw();
  }, [draw]);

  // keep crisp on container resize (rotation, window resize, font swap)
  useEffect(() => {
    const c = ref.current;
    if (!c || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(c);
    return () => ro.disconnect();
  }, [draw]);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="h-16 w-full rounded-lg border bg-white"
    />
  );
}

// ---------------------------------------------------------------- main view

export default function SettingsView() {
  const { t, lang, fmt } = useT();
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const goBack = useApp((s) => s.goBack);

  const [stats, setStats] = useState<StorageStats | null>(null);
  const [busy, setBusy] = useState(false); // building backup
  const [restoring, setRestoring] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [version, setVersion] = useState('');
  const [pensOpen, setPensOpen] = useState(false); // «الأقلام الإلكترونية» manager
  const fileRef = useRef<HTMLInputElement>(null);

  // installed version (APK versionName on Android) — loaded once on mount
  useEffect(() => {
    let alive = true;
    getAppVersion().then((v) => { if (alive) setVersion(v); }).catch(() => {});
    return () => { alive = false };
  }, []);

  // storage stats — loaded once on mount
  useEffect(() => {
    let alive = true;
    db.storageStats()
      .then((s) => { if (alive) setStats(s); })
      .catch(() => { /* stats are informational — ignore */ });
    return () => { alive = false; };
  }, []);

  // ----- backup actions

  const createBackup = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    const tid = toast.loading(t('export.backup.building'));
    try {
      const { buildNanoteBackup } = await import('@/lib/nanote/backup');
      const blob = await buildNanoteBackup(settings.includeAudioInBackup);
      downloadBlob(blob, `nanote-backup-${new Date().toISOString().slice(0, 10)}.nanote`);
      toast.success(t('export.done'), { id: tid });
    } catch {
      toast.error(t('error.generic'), { id: tid });
    } finally {
      setBusy(false);
    }
  }, [busy, settings.includeAudioInBackup, t]);

  const onPickFile = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    e.target.value = ''; // allow re-picking the same file
    if (!f) return;
    setPendingFile(f); // opens the confirm dialog
  }, []);

  const doRestore = useCallback(async () => {
    const file = pendingFile;
    setPendingFile(null);
    if (!file) return;
    setRestoring(true);
    const tid = toast.loading(t('settings.backup.restoring', 'Restoring backup…', 'جارٍ استعادة النسخة…'));
    try {
      const { restoreNanoteBackup } = await import('@/lib/nanote/backup');
      await restoreNanoteBackup(file);
      toast.success(t('settings.backup.restored'), { id: tid });
      window.setTimeout(() => window.location.reload(), 800);
    } catch {
      toast.error(t('settings.backup.invalid'), { id: tid });
      setRestoring(false);
    }
  }, [pendingFile, t]);

  const onClearThumbs = useCallback(async () => {
    try {
      await db.clearThumbs();
      toast.success(t('settings.clearThumbs.done'));
    } catch {
      toast.error(t('error.generic'));
    }
  }, [t]);

  // ----- derived

  const autosaveActive = [0, 1000, 5000].includes(settings.autosaveMs) ? settings.autosaveMs : 1000;

  return (
    <main
      aria-label={t('settings.title')}
      className="nanote-scroll flex min-h-0 flex-1 flex-col overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-2xl p-4 sm:p-6">
        {/* top bar */}
        <header className="mb-4 flex items-center gap-1 sm:gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="press-scale -ms-2 text-muted-foreground"
            onClick={goBack}
            aria-label={t('common.back')}
          >
            <ArrowLeft className="size-5 rtl:-scale-x-100" />
          </Button>
          <h1 className="text-xl font-bold tracking-tight">{t('settings.title')}</h1>
        </header>

        <div className="space-y-4 pb-8">
          {/* ------------------------------------------------ 1 · appearance */}
          <Section title={t('settings.appearance')}>
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="text-sm font-medium">{t('settings.theme')}</div>
                <Segmented
                  label={t('settings.theme')}
                  value={settings.theme}
                  onChange={(theme) => void setSettings({ theme })}
                  options={[
                    { value: 'light', label: t('settings.theme.light'), icon: <Sun className="size-4 shrink-0" /> },
                    { value: 'dark', label: t('settings.theme.dark'), icon: <Moon className="size-4 shrink-0" /> },
                    { value: 'system', label: t('settings.theme.system'), icon: <Monitor className="size-4 shrink-0" /> },
                  ]}
                />
              </div>
              <div className="space-y-2">
                <div className="text-sm font-medium">{t('settings.language')}</div>
                <Segmented
                  label={t('settings.language')}
                  value={settings.lang}
                  onChange={(l) => void setSettings({ lang: l })}
                  options={[
                    { value: 'en', label: t('settings.lang.en') },
                    { value: 'ar', label: t('settings.lang.ar') },
                  ]}
                />
              </div>
              <div className="space-y-2">
                <div className="text-sm font-medium">{t('settings.defaultView')}</div>
                <Segmented
                  label={t('settings.defaultView')}
                  value={settings.defaultView}
                  onChange={(defaultView) => void setSettings({ defaultView })}
                  options={[
                    { value: 'grid', label: t('library.view.grid'), icon: <LayoutGrid className="size-4 shrink-0" /> },
                    { value: 'list', label: t('library.view.list'), icon: <List className="size-4 shrink-0" /> },
                  ]}
                />
              </div>
            </div>
          </Section>

          {/* ------------------------------------------------ 2 · writing */}
          <Section title={t('settings.writing')}>
            <div className="space-y-4">
              <div className="space-y-2.5">
                <div className="text-sm font-medium">{t('settings.pressure')}</div>
                <Slider
                  min={0.4}
                  max={2.5}
                  step={0.05}
                  value={[settings.pressureCurve]}
                  onValueChange={(v) => void setSettings({ pressureCurve: v[0] ?? settings.pressureCurve })}
                  aria-label={t('settings.pressure')}
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{t('settings.pressure.firm')}</span>
                  <span>{t('settings.pressure.soft')}</span>
                </div>
                <PressurePreview gamma={settings.pressureCurve} />
              </div>
              <SwitchRow
                label={t('settings.fingerDrawing')}
                hint={t('settings.fingerDrawing.hint')}
                checked={settings.fingerDrawing}
                onCheckedChange={(fingerDrawing) => void setSettings({ fingerDrawing })}
              />
              <SwitchRow
                label={t('settings.stylusOnly')}
                hint={t('settings.stylusOnly.hint')}
                checked={settings.stylusOnly}
                onCheckedChange={(stylusOnly) => void setSettings({ stylusOnly })}
              />
              <SwitchRow
                label={t('settings.leftHanded')}
                hint={t('settings.leftHanded.hint')}
                checked={settings.leftHanded}
                onCheckedChange={(leftHanded) => void setSettings({ leftHanded })}
              />
              <div className="space-y-2">
                <div className="text-sm font-medium">{t('settings.toolPosition')}</div>
                <Segmented
                  label={t('settings.toolPosition')}
                  value={settings.toolRailPosition}
                  onChange={(toolRailPosition) => void setSettings({ toolRailPosition })}
                  options={[
                    { value: 'top', label: t('settings.toolPosition.top'), icon: <PanelTop className="size-4 shrink-0" /> },
                    { value: 'bottom', label: t('settings.toolPosition.bottom'), icon: <PanelBottom className="size-4 shrink-0" /> },
                    { value: 'left', label: t('settings.toolPosition.left'), icon: <PanelLeft className="size-4 shrink-0" /> },
                    { value: 'right', label: t('settings.toolPosition.right'), icon: <PanelRight className="size-4 shrink-0" /> },
                  ]}
                />
              </div>
            </div>
          </Section>

          {/* ------------------------------------------------ 2b · electronic pens */}
          <Section title={t('pens.title')}>
            <div className="space-y-2">
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t('input.penModel.hint')}
              </p>
              <Button
                variant="outline"
                className="w-full justify-start gap-2 rounded-xl"
                onClick={() => setPensOpen(true)}
                aria-label={t('pens.manage')}
              >
                <Pencil className="size-4 shrink-0" /> {t('pens.manage')}
              </Button>
            </div>
          </Section>

          {/* ------------------------------------------------ 3 · translation */}
          <Section title={t('settings.translate')}>
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="text-sm font-medium">{t('settings.translate.engine')}</div>
                <Segmented
                  label={t('settings.translate.engine')}
                  value={settings.translateEngine}
                  onChange={(translateEngine) => void setSettings({ translateEngine })}
                  options={[
                    { value: 'nanote', label: t('settings.translate.engine.nanote'), icon: <Languages className="size-4 shrink-0" /> },
                    { value: 'google', label: t('settings.translate.engine.google'), icon: <Globe className="size-4 shrink-0" /> },
                  ]}
                />
                <p className="text-xs leading-snug text-muted-foreground">
                  {settings.translateEngine === 'google'
                    ? t('settings.translate.engine.google.hint')
                    : t('settings.translate.engine.nanote.hint')}
                </p>
              </div>

              <div className="space-y-2">
                <Label className="cursor-pointer text-sm font-medium" htmlFor="translate-target">
                  {t('settings.translate.target')}
                </Label>
                <Select
                  value={settings.translateTarget}
                  onValueChange={(translateTarget) => void setSettings({ translateTarget })}
                >
                  <SelectTrigger id="translate-target" className="w-full">
                    <SelectValue aria-label={t('settings.translate.target')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">
                      {t('settings.translate.target.auto')} — {lang === 'ar' ? 'العربية' : 'English'}
                    </SelectItem>
                    <SelectItem value="ar">العربية · Arabic</SelectItem>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="fr">Français · French</SelectItem>
                    <SelectItem value="de">Deutsch · German</SelectItem>
                    <SelectItem value="es">Español · Spanish</SelectItem>
                    <SelectItem value="tr">Türkçe · Turkish</SelectItem>
                    <SelectItem value="ru">Русский · Russian</SelectItem>
                    <SelectItem value="fa">فارسی · Persian</SelectItem>
                    <SelectItem value="ur">اردو · Urdu</SelectItem>
                    <SelectItem value="hi">हिन्दी · Hindi</SelectItem>
                    <SelectItem value="zh">中文 · Chinese</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Divider />

              {/* Ask AI — the text-selection "Ask <AI>" target */}
              <div className="space-y-2">
                <div className="text-sm font-medium">{t('settings.askAi', 'Ask AI', 'اسأل الذكاء الاصطناعي')}</div>
                <Segmented
                  label={t('settings.askAi', 'Ask AI', 'اسأل الذكاء الاصطناعي')}
                  value={settings.aiService ?? 'chatgpt'}
                  onChange={(aiService) => void setSettings({ aiService })}
                  options={[
                    { value: 'chatgpt' as const, label: 'ChatGPT', icon: <MessagesSquare className="size-4 shrink-0" /> },
                    { value: 'gemini' as const, label: 'Gemini', icon: <Sparkles className="size-4 shrink-0" /> },
                    { value: 'claude' as const, label: 'Claude', icon: <Feather className="size-4 shrink-0" /> },
                  ]}
                />
                <p className="text-xs leading-snug text-muted-foreground">
                  {t('settings.askAi.hint', 'The "Ask" button on selected text opens this AI and sends it automatically', 'زر «اسأل» على النص المحدد يفتح هذا الذكاء الاصطناعي ويرسل النص تلقائياً')}
                </p>
              </div>
            </div>
          </Section>

          {/* ------------------------------------------------ 4 · data */}
          <Section title={t('settings.data')}>
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="text-sm font-medium">{t('settings.autosave')}</div>
                <Segmented
                  label={t('settings.autosave')}
                  value={autosaveActive}
                  onChange={(autosaveMs) => void setSettings({ autosaveMs })}
                  options={[
                    { value: 0, label: t('settings.autosave.immediate') },
                    { value: 1000, label: t('settings.autosave.1s') },
                    { value: 5000, label: t('settings.autosave.5s') },
                  ]}
                />
              </div>

              <Divider />

              <div className="space-y-3">
                <div className="text-sm font-medium">{t('settings.storage')}</div>
                {stats ? (
                  <div className="space-y-3">
                    {/* UNLIMITED STORAGE: no quota bar / no cap — the app stores
                        everything on the device's own disk (the platform's
                        persistent-storage request runs at boot). */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">
                        {t('settings.storage.used', 'Used', 'المستخدم')}: {fmtBytes(stats.usage, lang)}
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                        <InfinityIcon className="size-3.5" aria-hidden />
                        {t('settings.storage.unlimited', 'Unlimited storage', 'تخزين غير محدود')}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {[
                        { icon: BookOpen, label: fmt(t('library.notebookCount'), { count: stats.notebooks }) },
                        { icon: FileText, label: `${stats.pages} ${t('library.pages')}` },
                        { icon: ImageIcon, label: `${stats.images} ${t('settings.stats.images', 'images', 'صور')}` },
                        { icon: Mic, label: `${stats.recordings} ${t('audio.recordings')}` },
                      ].map(({ icon: Icon, label }) => (
                        <div key={label} className="flex items-center gap-2 rounded-lg bg-muted/60 px-2.5 py-2">
                          <Icon className="size-4 shrink-0 text-primary" />
                          <span className="truncate text-xs font-medium text-muted-foreground">{label}</span>
                        </div>
                      ))}
                    </div>
                    {stats.memoryMode && (
                      <p
                        role="status"
                        className="flex w-fit items-center gap-1.5 rounded-full bg-warning/15 px-3 py-1 text-xs font-medium text-warning"
                      >
                        <TriangleAlert className="size-3.5 shrink-0" />
                        <span className="max-w-xs truncate sm:max-w-none">{t('library.storageBanner')}</span>
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2" aria-hidden="true">
                    <div className="h-2 w-full animate-pulse rounded-full bg-muted" />
                    <div className="h-9 w-2/3 animate-pulse rounded-lg bg-muted" />
                  </div>
                )}
              </div>

              <Button
                type="button"
                variant="ghost"
                className="press-scale text-muted-foreground hover:text-foreground"
                onClick={() => void onClearThumbs()}
              >
                <Eraser />
                {t('settings.clearThumbs')}
              </Button>

              <Divider />

              {/* render cache — page bitmaps persisted in Cache Storage */}
              <Button
                type="button"
                variant="ghost"
                className="press-scale text-muted-foreground hover:text-foreground"
                onClick={() => {
                  void import('@/lib/nanote/rastercache').then((m) => m.clearRasterCache());
                  toast.success(t('settings.cache.clear.done'));
                }}
              >
                <Eraser />
                {t('settings.cache.clear')}
              </Button>

              <Divider />

              {/* backup */}
              <div className="space-y-3">
                <div className="text-sm font-medium">{t('settings.backup')}</div>
                <SwitchRow
                  label={t('settings.backup.includeAudio')}
                  hint={t(
                    'settings.backup.includeAudio.hint',
                    'Embeds voice recordings in the backup file.',
                    'يضمّن التسجيلات الصوتية داخل ملف النسخة.',
                  )}
                  checked={settings.includeAudioInBackup}
                  onCheckedChange={(includeAudioInBackup) => void setSettings({ includeAudioInBackup })}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    className="press-scale"
                    disabled={busy || restoring}
                    onClick={() => void createBackup()}
                  >
                    {busy ? <Loader2 className="animate-spin" /> : <Download />}
                    {t('settings.backup.create')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="press-scale"
                    disabled={busy || restoring}
                    onClick={() => fileRef.current?.click()}
                  >
                    {restoring ? <Loader2 className="animate-spin" /> : <Upload />}
                    {t('settings.backup.restore')}
                  </Button>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".nanote,application/json"
                  className="hidden"
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={onPickFile}
                />
              </div>
            </div>
          </Section>

          {/* ------------------------------------------------ 4 · about */}
          <Section title={t('settings.about')}>
            <div className="flex flex-col items-center gap-2.5 text-center">
              <AppWordmark size={40} />
              <p className="text-xs font-medium text-muted-foreground">
                {t('settings.about.version')} {version || '…'}
              </p>
              <p className="text-sm font-semibold">{t('app.tagline')}</p>
              <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
                {t('settings.about.body')}
              </p>
              <button
                onClick={() => { openReleasesPage(); toast(t('settings.about.updatesHint')); }}
                className="press-scale mt-1 inline-flex items-center gap-1.5 rounded-full border bg-background px-3.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
              >
                <RefreshCw className="size-3.5" aria-hidden="true" />
                {t('settings.about.checkUpdates')}
              </button>
              <Collapsible>
                <CollapsibleTrigger className="press-scale group mt-1 inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-accent">
                  {t('settings.about.licenses')}
                  <ChevronDown className="size-3.5 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-3 text-center">
                  <p className="mx-auto max-w-md text-xs leading-relaxed text-muted-foreground">
                    {t('settings.about.licenseBody')}
                  </p>
                </CollapsibleContent>
              </Collapsible>
            </div>
          </Section>
        </div>
      </div>

      {/* restore confirmation */}
      <AlertDialog open={pendingFile !== null} onOpenChange={(open) => { if (!open) setPendingFile(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.backup.restore')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings.backup.restore.confirm')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pendingFile && (
            <p className="break-all rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              {pendingFile.name} · {fmtBytes(pendingFile.size, lang)}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void doRestore()}>{t('common.restore')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* «الأقلام الإلكترونية» — full pen management (DB, test pad, bindings) */}
      <PenManagerSheet open={pensOpen} onOpenChange={setPensOpen} />
    </main>
  );
}
