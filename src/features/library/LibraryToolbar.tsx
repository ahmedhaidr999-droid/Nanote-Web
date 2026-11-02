'use client';
// Library toolbar — sort menu (key + direction), 4-way view mode selector
// (Grid / List / Compact / Large previews), a View-Settings popover (card
// size, columns, density, date/info toggles, preview-in-grid) and content
// filter chips. Every control reads/writes the persisted LibraryPrefs.
import {
  ArrowDownAZ, ArrowUpAZ, ArrowUpDown, Calendar, ChevronDown, Clock, FileText,
  Files, LayoutGrid, List as ListIcon, NotebookText, RotateCcw, Rows3, SlidersHorizontal,
  Star, StarOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { useApp, useT } from '@/lib/nanote/store';
import type {
  LibrarySortDir, LibrarySortKey, LibraryTypeFilter, LibraryViewMode,
} from '@/lib/nanote/types';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------- sort menu
export function SortMenu() {
  const { t } = useT();
  const prefs = useApp((s) => s.libraryPrefs);

  const keyLabel = (k: LibrarySortKey): string => {
    switch (k) {
      case 'title': return t('library.sort.title');
      case 'created': return t('library.sort.created');
      case 'modified': return t('library.sort.modified', 'Last modified', 'آخر تعديل');
      case 'type': return t('library.sort.type', 'Type', 'النوع');
      case 'pages': return t('library.sort.pages', 'Page count', 'عدد الصفحات');
      default: return t('library.sort.recent');
    }
  };

  const setKey = (k: string) => useApp.getState().setLibrarySort(k as LibrarySortKey);
  const flipDir = () =>
    useApp.getState().setLibrarySort(prefs.sortKey, prefs.sortDir === 'asc' ? 'desc' : 'asc');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label={t('library.sort')} className="press-scale gap-1.5">
          <ArrowUpDown className="h-4 w-4" aria-hidden />
          {keyLabel(prefs.sortKey)}
          <span
            aria-hidden
            className={cn('text-muted-foreground transition-transform', prefs.sortDir === 'asc' && 'rotate-180')}
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuRadioGroup value={prefs.sortKey} onValueChange={setKey}>
          <DropdownMenuRadioItem value="opened">{t('library.sort.recent')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="modified">{t('library.sort.modified', 'Last modified', 'آخر تعديل')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="created">{t('library.sort.created')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="title">{t('library.sort.title')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="type">{t('library.sort.type', 'Type', 'النوع')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="pages">{t('library.sort.pages', 'Page count', 'عدد الصفحات')}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <button
          type="button"
          onClick={flipDir}
          className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
        >
          {prefs.sortDir === 'asc' ? (
            <ArrowDownAZ className="h-4 w-4 text-muted-foreground" aria-hidden />
          ) : (
            <ArrowUpAZ className="h-4 w-4 text-muted-foreground" aria-hidden />
          )}
          {prefs.sortDir === 'asc'
            ? t('library.sort.asc', 'Ascending', 'تصاعدي')
            : t('library.sort.desc', 'Descending', 'تنازلي')}
        </button>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------- view modes
const MODES: { id: LibraryViewMode; icon: typeof LayoutGrid; labelKey: string; en: string; ar: string }[] = [
  { id: 'grid', icon: LayoutGrid, labelKey: 'library.view.grid', en: 'Grid view', ar: 'عرض شبكي' },
  { id: 'list', icon: ListIcon, labelKey: 'library.view.list', en: 'List view', ar: 'عرض قائمة' },
  { id: 'compact', icon: Rows3, labelKey: 'library.view.compact', en: 'Compact list', ar: 'قائمة مضغوطة' },
  { id: 'preview', icon: NotebookText, labelKey: 'library.view.preview', en: 'Large previews', ar: 'معاينات كبيرة' },
];

export function ViewModeSelector() {
  const { t } = useT();
  const view = useApp((s) => s.libraryPrefs.view);
  return (
    <div
      className="flex items-center rounded-lg border bg-card p-0.5"
      role="group"
      aria-label={t('library.view.title', 'View mode', 'طريقة العرض')}
    >
      {MODES.map(({ id, icon: Icon, labelKey, en, ar }) => (
        <button
          key={id}
          type="button"
          aria-label={t(labelKey, en, ar)}
          aria-pressed={view === id}
          onClick={() => {
            const st = useApp.getState();
            st.setLibraryViewMode(id);
            // "Large previews" should open LARGE — nudge a small card size up
            // once (users can still dial it back; the slider stays in control)
            if (id === 'preview' && st.libraryPrefs.cardSize < 220) {
              st.setLibraryPrefs({ cardSize: 260 });
            }
          }}
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-md transition-colors press-scale',
            view === id ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/60',
          )}
        >
          <Icon className="h-4 w-4" aria-hidden />
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- view settings
export function ViewSettingsButton() {
  const { t } = useT();
  const prefs = useApp((s) => s.libraryPrefs);
  const set = (patch: Partial<typeof prefs>) => useApp.getState().setLibraryPrefs(patch);

  const gridish = prefs.view === 'grid' || prefs.view === 'preview';

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={t('library.viewSettings', 'View settings', 'إعدادات العرض')}
          className="press-scale gap-1.5"
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">{t('library.viewSettings', 'View settings', 'إعدادات العرض')}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="flex flex-col gap-4">
          {/* card size */}
          {gridish ? (
            <div>
              <div className="mb-2 flex items-center justify-between text-sm font-medium">
                <span>{t('library.viewSettings.cardSize', 'Card size', 'حجم البطاقة')}</span>
                <span className="tabular-nums text-muted-foreground">{prefs.cardSize}px</span>
              </div>
              <Slider
                value={[prefs.cardSize]}
                min={140}
                max={360}
                step={10}
                onValueChange={([v]) => set({ cardSize: v })}
                aria-label={t('library.viewSettings.cardSize', 'Card size', 'حجم البطاقة')}
              />
            </div>
          ) : null}

          {/* columns */}
          {gridish ? (
            <div>
              <div className="mb-2 flex items-center justify-between text-sm font-medium">
                <span>{t('library.viewSettings.columns', 'Columns', 'الأعمدة')}</span>
                <label className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
                  {t('library.viewSettings.columnsAuto', 'Auto', 'تلقائي')}
                  <Switch
                    checked={prefs.autoColumns}
                    onCheckedChange={(v) => set({ autoColumns: v })}
                    aria-label={t('library.viewSettings.columnsAuto', 'Auto', 'تلقائي')}
                  />
                </label>
              </div>
              {!prefs.autoColumns ? (
                <div className="flex items-center gap-3">
                  <Slider
                    value={[prefs.columns]}
                    min={2}
                    max={10}
                    step={1}
                    onValueChange={([v]) => set({ columns: v })}
                    aria-label={t('library.viewSettings.columns', 'Columns', 'الأعمدة')}
                  />
                  <span className="w-8 shrink-0 text-end text-sm tabular-nums text-muted-foreground">{prefs.columns}</span>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* density */}
          <div>
            <div className="mb-2 text-sm font-medium">
              {t('library.viewSettings.density', 'Spacing', 'التباعد')}
            </div>
            <div className="flex items-center rounded-lg border bg-card p-0.5" role="group">
              {(['compact', 'cozy', 'roomy'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={prefs.density === d}
                  onClick={() => set({ density: d })}
                  className={cn(
                    'h-8 flex-1 rounded-md text-xs font-medium transition-colors press-scale',
                    prefs.density === d ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/60',
                  )}
                >
                  {d === 'compact'
                    ? t('library.viewSettings.density.compact', 'Compact', 'مضغوط')
                    : d === 'cozy'
                      ? t('library.viewSettings.density.cozy', 'Cozy', 'مريح')
                      : t('library.viewSettings.density.roomy', 'Roomy', 'واسع')}
                </button>
              ))}
            </div>
          </div>

          <Separator />

          {/* toggles */}
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>{t('library.viewSettings.showDates', 'Show dates', 'إظهار التواريخ')}</span>
            <Switch
              checked={prefs.showDates}
              onCheckedChange={(v) => set({ showDates: v })}
              aria-label={t('library.viewSettings.showDates', 'Show dates', 'إظهار التواريخ')}
            />
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>{t('library.viewSettings.showInfo', 'Show file info', 'إظهار معلومات الملف')}</span>
            <Switch
              checked={prefs.showInfo}
              onCheckedChange={(v) => set({ showInfo: v })}
              aria-label={t('library.viewSettings.showInfo', 'Show file info', 'إظهار معلومات الملف')}
            />
          </label>
          {prefs.view === 'grid' ? (
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>{t('library.viewSettings.previewInGrid', 'Content preview instead of cover', 'معاينة المحتوى بدل الغلاف')}</span>
              <Switch
                checked={prefs.showPreviewInGrid}
                onCheckedChange={(v) => set({ showPreviewInGrid: v })}
                aria-label={t('library.viewSettings.previewInGrid', 'Content preview instead of cover', 'معاينة المحتوى بدل الغلاف')}
              />
            </label>
          ) : null}

          <Separator />

          <Button
            variant="outline"
            size="sm"
            className="press-scale"
            onClick={() =>
              set({
                cardSize: 200, autoColumns: true, columns: 5,
                density: 'cozy', showDates: true, showInfo: true, showPreviewInGrid: false,
              })
            }
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
            {t('library.viewSettings.reset', 'Reset to defaults', 'استعادة الافتراضي')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------- filter chips
const FILTERS: { id: LibraryTypeFilter; icon: typeof Files; key: string; en: string; ar: string }[] = [
  { id: 'all', icon: Files, key: 'library.filter.all', en: 'All', ar: 'الكل' },
  { id: 'notes', icon: NotebookText, key: 'library.filter.notes', en: 'Notes', ar: 'ملاحظات' },
  { id: 'pdf', icon: FileText, key: 'library.filter.pdf', en: 'PDF', ar: 'PDF' },
  { id: 'favorites', icon: Star, key: 'library.filter.favorites', en: 'Favorites', ar: 'المفضلة' },
  { id: 'recent', icon: Clock, key: 'library.filter.recent', en: 'Recent', ar: 'حديث' },
  { id: 'stale', icon: Calendar, key: 'library.filter.stale', en: 'Older', ar: 'قديم' },
];

export function FilterChips() {
  const { t } = useT();
  const filter = useApp((s) => s.libraryPrefs.filter);
  return (
    <div
      className="flex min-w-0 items-center gap-1.5 overflow-x-auto nanote-scroll"
      role="group"
      aria-label={t('library.filter', 'Filter', 'تصفية')}
    >
      {FILTERS.map(({ id, icon: Icon, key, en, ar }) => {
        const active = filter === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={active}
            onClick={() => useApp.getState().setLibraryFilter(id)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-medium transition-colors press-scale',
              active
                ? 'border-primary/60 bg-primary/10 text-primary'
                : 'bg-card text-muted-foreground hover:bg-accent/60 hover:text-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {t(key, en, ar)}
          </button>
        );
      })}
      {filter === 'favorites' ? <StarOff className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden /> : null}
    </div>
  );
}

// re-exported direction helper for the list header
export function sortDirIcon(dir: LibrarySortDir) {
  return dir === 'asc' ? ArrowDownAZ : ArrowUpAZ;
}
