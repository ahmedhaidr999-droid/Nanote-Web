'use client';
// Task 2-b — "New Notebook" flow: cover → paper template → page size → paper
// color → name, with a live sticky preview. 100% client-side; custom cover and
// template images are cropped/stored straight into IndexedDB (images store).
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ArrowLeft, Check, ImagePlus, Loader2, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NotebookCover } from '@/components/nanote/NotebookCover';
import { COVERS, DEFAULT_COVER_ID } from '@/lib/nanote/covers';
import { TEMPLATE_IDS, renderTemplatePreview } from '@/lib/nanote/templates';
import * as db from '@/lib/nanote/idb';
import { PAGE_SIZES, PAPER_COLORS, PageSizeId, TemplateId } from '@/lib/nanote/types';
import { isDarkHex, uid } from '@/lib/nanote/util';
import { useApp, useT } from '@/lib/nanote/store';
import { cn } from '@/lib/utils';
import { cropToAspect, readImageSize } from './coverCropper';

// ---------------------------------------------------------------- static data

const BUILT_IN_TEMPLATES = TEMPLATE_IDS.filter((id) => id !== 'custom');
const SIZE_ORDER: readonly PageSizeId[] = ['a4p', 'a4l', 'letter', 'infinite'];

/** [en, ar] display names — registered into the i18n dictionary via t() fallbacks. */
const COVER_NAMES: Record<string, readonly [string, string]> = {
  'nanote-blue': ['Nanote Blue', 'أزرق نانوت'],
  midnight: ['Midnight', 'منتصف الليل'],
  sunset: ['Sunset', 'غروب'],
  meadow: ['Meadow', 'مرج'],
  orchid: ['Orchid', 'أوركيد'],
  rosewater: ['Rosewater', 'ماء الورد'],
  'paper-white': ['Paper White', 'أبيض'],
  kraft: ['Kraft', 'كرافت'],
  'ink-black': ['Ink Black', 'أسود'],
  forest: ['Forest', 'غابة'],
  dots: ['Dots', 'نقاط'],
  lines: ['Lines', 'خطوط'],
};

const TEMPLATE_LABELS: Record<TemplateId, readonly [string, string]> = {
  blank: ['Blank', 'فارغ'],
  ruled: ['Ruled', 'مسطّر'],
  wideruled: ['Wide ruled', 'مسطّر عريض'],
  grid: ['Grid', 'شبكة'],
  dotgrid: ['Dots', 'نقاط'],
  handwriting: ['Handwriting', 'إرشاد كتابة'],
  music: ['Music staff', 'نوتة موسيقية'],
  isometric: ['Isometric', 'متساوي الاستطالة'],
  daily: ['Daily planner', 'مخطط يومي'],
  weekly: ['Weekly planner', 'مخطط أسبوعي'],
  monthly: ['Monthly planner', 'مخطط شهري'],
  custom: ['Custom', 'مخصص'],
};

/** covers.ts types `css` without backgroundSize (pattern covers carry it at runtime). */
interface CoverCssExt { background: string; backgroundSize?: string; color?: string }

const TILE_FOCUS =
  'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card';

function sizeHint(id: PageSizeId): string {
  if (id === 'infinite') return '794 × ∞';
  const s = PAGE_SIZES[id];
  return `${s.w} × ${s.h}`;
}

// ---------------------------------------------------------------- component

export default function CreateNotebookView({ folderId }: { folderId: string | null }) {
  const goBack = useApp((s) => s.goBack);
  const createNotebook = useApp((s) => s.createNotebook);
  const openEditor = useApp((s) => s.openEditor);
  const { t } = useT();

  // ----- form state
  const [name, setName] = useState('');
  const [coverId, setCoverId] = useState<string>(DEFAULT_COVER_ID); // built-in id or 'custom'
  const [template, setTemplate] = useState<TemplateId>('ruled');
  const [pageSize, setPageSize] = useState<PageSizeId>('a4p');
  const [bg, setBg] = useState<string>(PAPER_COLORS[0]);

  // ----- custom image state (stored to IndexedDB + local object URL preview)
  const [customCoverUrl, setCustomCoverUrl] = useState<string | null>(null);
  const [customTemplateUrl, setCustomTemplateUrl] = useState<string | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const [tmplBusy, setTmplBusy] = useState(false);
  const [creating, setCreating] = useState(false);

  // refs mirrored for cleanup (orphan deletion + URL revocation on unmount)
  const coverIdRef = useRef<string | null>(null);
  const coverUrlRef = useRef<string | null>(null);
  const tmplIdRef = useRef<string | null>(null);
  const tmplUrlRef = useRef<string | null>(null);
  const createdRef = useRef(false);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const tmplInputRef = useRef<HTMLInputElement>(null);

  // delete images that were picked but never attached to a created notebook
  useEffect(() => {
    return () => {
      if (!createdRef.current) {
        if (coverIdRef.current) void db.deleteImage(coverIdRef.current);
        if (tmplIdRef.current) void db.deleteImage(tmplIdRef.current);
      }
      if (coverUrlRef.current) URL.revokeObjectURL(coverUrlRef.current);
      if (tmplUrlRef.current) URL.revokeObjectURL(tmplUrlRef.current);
    };
  }, []);

  // ----- previews (canvas → dataURL; refresh when the paper color changes)
  const templateTiles = useMemo(
    () => BUILT_IN_TEMPLATES.map((id) => ({ id, src: renderTemplatePreview(id, 96, 128, bg) })),
    [bg],
  );
  const paperPreviewSrc = useMemo(
    () => renderTemplatePreview(template === 'custom' ? 'blank' : template, 160, 213, bg),
    [template, bg],
  );

  const previewTitle = name.trim() || t('create.notebookName.default');

  // ----- custom cover handling
  const handleCoverFile = async (file: File | undefined) => {
    if (!file || createdRef.current) return;
    setCoverBusy(true);
    try {
      const { blob, w, h } = await cropToAspect(file, 3 / 4, 1200); // center-crop 3:4, ≤1200px wide
      const id = uid();
      await db.putImage({ id, blob, w, h, name: file.name, createdAt: Date.now() });
      if (coverIdRef.current) await db.deleteImage(coverIdRef.current); // replace previous pick
      if (coverUrlRef.current) URL.revokeObjectURL(coverUrlRef.current);
      const url = URL.createObjectURL(blob);
      coverIdRef.current = id;
      coverUrlRef.current = url;
      setCustomCoverUrl(url);
      setCoverId('custom');
    } catch (err) {
      console.error('[nanote] custom cover failed', err);
      toast.error(t('error.generic'));
    } finally {
      setCoverBusy(false);
    }
  };

  const removeCustomCover = () => {
    if (coverIdRef.current) void db.deleteImage(coverIdRef.current);
    if (coverUrlRef.current) URL.revokeObjectURL(coverUrlRef.current);
    coverIdRef.current = null;
    coverUrlRef.current = null;
    setCustomCoverUrl(null);
    setCoverId(DEFAULT_COVER_ID);
  };

  // ----- custom template handling
  const handleTemplateFile = async (file: File | undefined) => {
    if (!file || createdRef.current) return;
    setTmplBusy(true);
    try {
      const { w, h } = await readImageSize(file);
      const id = uid();
      await db.putImage({ id, blob: file, w, h, name: file.name, createdAt: Date.now() });
      if (tmplIdRef.current) await db.deleteImage(tmplIdRef.current); // replace previous pick
      if (tmplUrlRef.current) URL.revokeObjectURL(tmplUrlRef.current);
      const url = URL.createObjectURL(file);
      tmplIdRef.current = id;
      tmplUrlRef.current = url;
      setCustomTemplateUrl(url);
      setTemplate('custom');
    } catch (err) {
      console.error('[nanote] custom template failed', err);
      toast.error(t('error.generic'));
    } finally {
      setTmplBusy(false);
    }
  };

  const removeCustomTemplate = () => {
    if (tmplIdRef.current) void db.deleteImage(tmplIdRef.current);
    if (tmplUrlRef.current) URL.revokeObjectURL(tmplUrlRef.current);
    tmplIdRef.current = null;
    tmplUrlRef.current = null;
    setCustomTemplateUrl(null);
    setTemplate('blank');
  };

  const selectTemplate = (id: TemplateId) => {
    if (id === 'custom') {
      if (customTemplateUrl) setTemplate('custom');
      else tmplInputRef.current?.click();
      return;
    }
    setTemplate(id);
  };

  // ----- create
  const handleCreate = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const effTemplate: TemplateId =
        template === 'custom' && !tmplIdRef.current ? 'blank' : template;
      const useCustomTmpl = effTemplate === 'custom';
      const id = await createNotebook({
        title: name.trim() || t('create.notebookName.default'),
        folderId,
        coverId,
        coverCustomId: coverId === 'custom' ? coverIdRef.current : null,
        template: effTemplate,
        pageSize,
        backgroundHex: bg,
        customTemplateImageId: useCustomTmpl ? tmplIdRef.current : null,
      });
      createdRef.current = true;
      if (!useCustomTmpl && tmplIdRef.current) {
        // picked a template image but created with a built-in paper → avoid an orphan blob
        await db.deleteImage(tmplIdRef.current);
        tmplIdRef.current = null;
      }
      await openEditor(id);
    } catch (err) {
      console.error('[nanote] create notebook failed', err);
      toast.error(t('error.generic'));
      setCreating(false);
    }
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void handleCreate();
  };

  // ---------------------------------------------------------------- render

  const checkInkOnSwatch = (hex: string) => (isDarkHex(hex) ? '#FFFFFF' : '#16233A');

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      {/* top bar */}
      <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-2 px-4 sm:gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={goBack}
            aria-label={t('common.back')}
            className="press-scale rounded-full"
          >
            <ArrowLeft className="rtl:-scale-x-100" aria-hidden />
          </Button>
          <h1 className="min-w-0 truncate text-base font-semibold sm:text-lg">{t('create.title')}</h1>
          <Button
            type="submit"
            form="create-notebook-form"
            disabled={creating}
            aria-busy={creating}
            className="press-scale ms-auto rounded-full px-5 font-semibold"
          >
            {creating && <Loader2 className="animate-spin" aria-hidden />}
            {creating
              ? t('create.creating', 'Creating…', 'جارٍ الإنشاء…')
              : t('create.create')}
          </Button>
        </div>
      </header>

      {/* body */}
      <div className="mx-auto w-full max-w-5xl flex-1 px-4 pb-10 pt-4 sm:pt-6">
        <div className="grid gap-4 lg:grid-cols-[320px_1fr] lg:items-start lg:gap-6">
          {/* live preview — first on mobile (DOM order), left column on lg+ */}
          <aside aria-label={t('create.preview')} className="lg:sticky lg:top-20">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('create.preview')}
            </div>
            <NotebookCover
              coverId={coverId}
              customUrl={coverId === 'custom' ? customCoverUrl : null}
              title={previewTitle}
              className="mx-auto aspect-[3/4] w-full max-w-[280px]"
            />
            {template === 'custom' && customTemplateUrl !== null ? (
              <img
                src={customTemplateUrl}
                alt={`${t('create.template')}: ${t('create.tmpl.custom', ...TEMPLATE_LABELS.custom)}`}
                className="mx-auto mt-4 block h-[213px] w-40 rounded-lg border object-cover shadow-ink-1"
              />
            ) : (
              <img
                src={paperPreviewSrc}
                alt={`${t('create.template')}: ${t(`create.tmpl.${template}`, ...TEMPLATE_LABELS[template])}`}
                className="mx-auto mt-4 block h-[213px] w-40 rounded-lg border object-cover object-top shadow-ink-1"
              />
            )}
          </aside>

          {/* form sections */}
          <form
            id="create-notebook-form"
            onSubmit={handleSubmit}
            className="flex flex-col gap-4 sm:gap-6"
          >
            {/* hidden pickers (triggered by the custom tiles) */}
            <input
              ref={coverInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              aria-hidden
              tabIndex={-1}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                void handleCoverFile(f);
              }}
            />
            <input
              ref={tmplInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              aria-hidden
              tabIndex={-1}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                void handleTemplateFile(f);
              }}
            />

            {/* 1 — name */}
            <section aria-labelledby="cnb-name-label" className="rounded-xl bg-card p-4 shadow-ink-1 sm:p-6">
              <Label htmlFor="cnb-name" id="cnb-name-label" className="text-sm font-medium">
                {t('create.notebookName')}
              </Label>
              <Input
                id="cnb-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('create.notebookName.default')}
                maxLength={80}
                autoFocus
                autoComplete="off"
                className="mt-3"
              />
            </section>

            {/* 2 — cover */}
            <section aria-labelledby="cnb-cover-h" className="rounded-xl bg-card p-4 shadow-ink-1 sm:p-6">
              <h2 id="cnb-cover-h" className="text-sm font-semibold">
                {t('create.cover')}
              </h2>
              <div className="mt-4 grid grid-cols-4 gap-3 sm:grid-cols-6">
                {COVERS.map((c) => {
                  const css = c.css as CoverCssExt;
                  const [en, ar] = COVER_NAMES[c.id] ?? [c.id, c.id];
                  const selected = coverId === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      aria-pressed={selected}
                      aria-label={t(`cover.${c.id}`, en, ar)}
                      onClick={() => setCoverId(c.id)}
                      className={cn('press-scale relative rounded-lg', TILE_FOCUS)}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          'block aspect-[3/4] rounded-lg border-2',
                          selected ? 'border-primary ring-2 ring-ring' : 'border-transparent',
                        )}
                        style={{ background: css.background, backgroundSize: css.backgroundSize }}
                      />
                      {selected && (
                        <span
                          aria-hidden
                          className="absolute inset-0 grid place-items-center"
                          style={{ color: css.color }}
                        >
                          <Check className="size-4 drop-shadow" />
                        </span>
                      )}
                    </button>
                  );
                })}

                {/* custom cover tile */}
                <div className="relative">
                  <button
                    type="button"
                    aria-pressed={coverId === 'custom'}
                    aria-label={t('create.cover.custom')}
                    onClick={() => (customCoverUrl ? setCoverId('custom') : coverInputRef.current?.click())}
                    className={cn('press-scale relative block w-full rounded-lg', TILE_FOCUS)}
                  >
                    {customCoverUrl ? (
                      <span
                        aria-hidden
                        className={cn(
                          'block aspect-[3/4] overflow-hidden rounded-lg border-2',
                          coverId === 'custom' ? 'border-primary ring-2 ring-ring' : 'border-transparent',
                        )}
                      >
                        <img src={customCoverUrl} alt="" className="h-full w-full object-cover" draggable={false} />
                      </span>
                    ) : (
                      <span
                        aria-hidden
                        className="flex aspect-[3/4] flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-muted-foreground/50 px-1 text-muted-foreground"
                      >
                        <ImagePlus className="size-5 shrink-0" />
                        <span className="text-center text-[10px] leading-tight">{t('create.cover.custom')}</span>
                      </span>
                    )}
                    {coverId === 'custom' && customCoverUrl && (
                      <span aria-hidden className="absolute inset-0 grid place-items-center">
                        <Check className="size-5 text-white drop-shadow-md" />
                      </span>
                    )}
                    {coverBusy && (
                      <span
                        aria-hidden
                        className="absolute inset-0 grid place-items-center rounded-lg bg-background/60 backdrop-blur-[1px]"
                      >
                        <Loader2 className="size-5 animate-spin text-foreground" />
                      </span>
                    )}
                  </button>
                  {customCoverUrl && !coverBusy && (
                    <button
                      type="button"
                      onClick={() => coverInputRef.current?.click()}
                      aria-label={t('create.cover.custom.pick')}
                      title={t('create.cover.custom.pick')}
                      className={cn(
                        'absolute end-1 top-1 z-10 grid size-6 place-items-center rounded-full border bg-background/85 shadow-sm backdrop-blur press-scale',
                        TILE_FOCUS,
                      )}
                    >
                      <RefreshCw className="size-3" aria-hidden />
                    </button>
                  )}
                </div>
              </div>
              {coverId === 'custom' && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={removeCustomCover}
                  className="press-scale mt-3 rounded-full text-xs"
                >
                  <X className="size-3.5" aria-hidden />
                  {t('create.cover.remove', 'Remove', 'إزالة')}
                </Button>
              )}
            </section>

            {/* 3 — paper template */}
            <section aria-labelledby="cnb-template-h" className="rounded-xl bg-card p-4 shadow-ink-1 sm:p-6">
              <h2 id="cnb-template-h" className="text-sm font-semibold">
                {t('create.template')}
              </h2>
              <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4">
                {templateTiles.map(({ id, src }) => {
                  const [en, ar] = TEMPLATE_LABELS[id];
                  const label = t(`create.tmpl.${id}`, en, ar);
                  const selected = template === id;
                  return (
                    <div key={id} className="flex min-w-0 flex-col">
                      <button
                        type="button"
                        aria-pressed={selected}
                        aria-label={label}
                        onClick={() => setTemplate(id)}
                        className={cn('press-scale relative rounded-md', TILE_FOCUS)}
                      >
                        <img
                          src={src}
                          alt=""
                          aria-hidden
                          draggable={false}
                          className={cn(
                            'aspect-[3/4] w-full rounded-md border-2 object-cover',
                            selected ? 'border-primary ring-2 ring-ring' : 'border-transparent',
                          )}
                        />
                        {selected && (
                          <span
                            aria-hidden
                            className="absolute inset-0 grid place-items-center"
                            style={{ color: checkInkOnSwatch(bg) }}
                          >
                            <Check className="size-4 drop-shadow" />
                          </span>
                        )}
                      </button>
                      <span
                        className={cn(
                          'mt-1 truncate text-center text-xs',
                          selected ? 'font-medium text-foreground' : 'text-muted-foreground',
                        )}
                      >
                        {label}
                      </span>
                    </div>
                  );
                })}

                {/* custom template tile */}
                <div className="flex min-w-0 flex-col">
                  <div className="relative">
                    <button
                      type="button"
                      aria-pressed={template === 'custom'}
                      aria-label={t('create.tmpl.custom', ...TEMPLATE_LABELS.custom)}
                      onClick={() => selectTemplate('custom')}
                      className={cn('press-scale relative block w-full rounded-md', TILE_FOCUS)}
                    >
                      {customTemplateUrl ? (
                        <img
                          src={customTemplateUrl}
                          alt=""
                          aria-hidden
                          draggable={false}
                          className={cn(
                            'aspect-[3/4] w-full rounded-md border-2 object-cover',
                            template === 'custom' ? 'border-primary ring-2 ring-ring' : 'border-transparent',
                          )}
                        />
                      ) : (
                        <span
                          aria-hidden
                          className="flex aspect-[3/4] items-center justify-center rounded-md border-2 border-dashed border-muted-foreground/50 text-muted-foreground"
                        >
                          <ImagePlus className="size-5" />
                        </span>
                      )}
                      {template === 'custom' && customTemplateUrl && (
                        <span aria-hidden className="absolute inset-0 grid place-items-center">
                          <Check className="size-5 text-white drop-shadow-md" />
                        </span>
                      )}
                      {tmplBusy && (
                        <span
                          aria-hidden
                          className="absolute inset-0 grid place-items-center rounded-md bg-background/60 backdrop-blur-[1px]"
                        >
                          <Loader2 className="size-5 animate-spin text-foreground" />
                        </span>
                      )}
                    </button>
                    {customTemplateUrl && !tmplBusy && (
                      <button
                        type="button"
                        onClick={() => tmplInputRef.current?.click()}
                        aria-label={t('create.customTemplate.pick')}
                        title={t('create.customTemplate.pick')}
                        className={cn(
                          'absolute end-1 top-1 z-10 grid size-6 place-items-center rounded-full border bg-background/85 shadow-sm backdrop-blur press-scale',
                          TILE_FOCUS,
                        )}
                      >
                        <RefreshCw className="size-3" aria-hidden />
                      </button>
                    )}
                  </div>
                  <span
                    className={cn(
                      'mt-1 truncate text-center text-xs',
                      template === 'custom' ? 'font-medium text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {t('create.tmpl.custom', ...TEMPLATE_LABELS.custom)}
                  </span>
                </div>
              </div>
              {template === 'custom' && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={removeCustomTemplate}
                  className="press-scale mt-3 rounded-full text-xs"
                >
                  <X className="size-3.5" aria-hidden />
                  {t('create.cover.remove', 'Remove', 'إزالة')}
                </Button>
              )}
            </section>

            {/* 4 — page size */}
            <section aria-labelledby="cnb-size-h" className="rounded-xl bg-card p-4 shadow-ink-1 sm:p-6">
              <h2 id="cnb-size-h" className="text-sm font-semibold">
                {t('create.size')}
              </h2>
              <div className="mt-4 grid grid-cols-2 gap-3">
                {SIZE_ORDER.map((id) => {
                  const selected = pageSize === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setPageSize(id)}
                      className={cn(
                        'press-scale flex items-start gap-3 rounded-lg border-2 p-3 text-start transition-colors',
                        TILE_FOCUS,
                        selected ? 'border-primary bg-accent' : 'border-border/60 hover:bg-accent/50',
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          'mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border-2',
                          selected ? 'border-primary' : 'border-muted-foreground/50',
                        )}
                      >
                        {selected && <span className="size-2 rounded-full bg-primary" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium leading-tight">{t(`create.size.${id}`)}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">{sizeHint(id)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              {pageSize === 'infinite' && (
                <p className="mt-3 text-xs text-muted-foreground" role="note">
                  {t('create.infinite.hint', 'Scrolls continuously, grows as you write', 'تمرير مستمر، تمتد الصفحة أثناء الكتابة')}
                </p>
              )}
            </section>

            {/* 5 — paper color */}
            <section aria-labelledby="cnb-bg-h" className="rounded-xl bg-card p-4 shadow-ink-1 sm:p-6">
              <h2 id="cnb-bg-h" className="text-sm font-semibold">
                {t('create.bg')}
              </h2>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                {PAPER_COLORS.map((c) => {
                  const selected = bg === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={selected}
                      aria-label={`${t('create.bg')}: ${c}`}
                      title={c}
                      onClick={() => setBg(c)}
                      className={cn(
                        'press-scale relative grid size-9 place-items-center rounded-full border border-border',
                        TILE_FOCUS,
                        selected && 'ring-2 ring-ring ring-offset-2 ring-offset-card',
                      )}
                      style={{ background: c }}
                    >
                      {selected && (
                        <Check className="size-4" aria-hidden style={{ color: checkInkOnSwatch(c) }} />
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          </form>
        </div>
      </div>
    </main>
  );
}
