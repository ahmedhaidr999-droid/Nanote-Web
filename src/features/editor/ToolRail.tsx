'use client';
// ToolRail — the editor's tool dock. Mobile: bottom pill bar; Desktop (lg+):
// vertical side rail (flips sides for left-handed mode). Each drawing tool has
// its own popover with size/color memory.
import { useCallback, useRef, useState } from 'react';
import {
  PenLine, Pen, Brush, PenTool, Highlighter, Eraser, Lasso, Type, Shapes, ImagePlus,
  Ruler as RulerIcon, Mic, Hand, Pointer, Trash2,
} from 'lucide-react';
import { useApp, useT } from '@/lib/nanote/store';
import { EditorTool, HIGHLIGHTER_PALETTE, ShapeType, TEXT_FONTS, ToolId } from '@/lib/nanote/types';
import { uid } from '@/lib/nanote/util';
import * as db from '@/lib/nanote/idb';
import { cn } from '@/lib/utils';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { ColorPopover } from './ColorPopover';
import { ruler } from './viewport';
import { AudioPanel } from './AudioPanel';

const PEN_ICONS: Record<ToolId, typeof Pen> = {
  fountain: PenLine,
  ballpoint: Pen,
  brush: Brush,
  fineliner: PenTool,
  highlighter: Highlighter,
};

export function ToolRail({ pageW }: { pageW: number }) {
  const { t, isRTL } = useT();
  const tool = useApp((s) => s.editor.tool);
  const lastPen = useApp((s) => s.editor.lastPen);
  const leftHanded = useApp((s) => s.settings.leftHanded);
  const fingerDrawing = useApp((s) => s.settings.fingerDrawing);
  // rail anchors to the inline-start edge (right edge in Arabic); leftHanded flips it.
  // Physical classes because the rail keeps dir="ltr" for stable icon order.
  const railOnRight = leftHanded !== isRTL;
  const rulerVisible = useApp((s) => s.editor.rulerVisible);
  const setTool = useApp((s) => s.setTool);
  const toggleRuler = useApp((s) => s.toggleRuler);
  const [popover, setPopover] = useState<EditorTool | null>(null);
  const [audioOpen, setAudioOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const PenIcon = PEN_ICONS[lastPen];

  const insertImage = async (file: File) => {
    const st = useApp.getState();
    if (file.size > 20 * 1024 * 1024) { toast.error(t('tool.image.tooLarge')); return }
    // downscale via canvas for consistent storage
    const bitmap = await createImageBitmap(file).catch(() => null);
    let blob: Blob = file;
    let w = 1000, h = 1000;
    if (bitmap) {
      const max = 1600;
      const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
      w = Math.round(bitmap.width * scale);
      h = Math.round(bitmap.height * scale);
      if (scale < 1) {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
        blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/png'));
      } else {
        w = bitmap.width; h = bitmap.height;
      }
    }
    const id = uid();
    await db.putImage({ id, w, h, name: file.name, createdAt: Date.now(), blob });
    const pageId = st.editor.activePageId;
    if (!pageId) return;
    const doc = await st.ensureDoc(pageId);
    const z = doc.elements.reduce((acc, e) => Math.max(acc, e.z), 0) + 1;
    const targetW = pageW * 0.5;
    const ih = targetW * (h / w);
    st.addElements(pageId, [{
      kind: 'image', id: uid(), x: pageW * 0.22, y: 120, w: targetW, h: ih, imageId: id, rotation: 0, z,
    }]);
    st.setTool('lasso');
    toast.success(t('tool.image.insert'));
  };

  const railSide = leftHanded ? 'end' : 'start';

  const openImagePicker = useCallback(() => fileRef.current?.click(), []);

  const items: { id: EditorTool; icon: typeof Pen; label: string }[] = [
    { id: lastPen, icon: PenIcon, label: t(`tool.${lastPen}`) },
    { id: 'highlighter', icon: Highlighter, label: t('tool.highlighter') },
    { id: 'eraser', icon: Eraser, label: t('tool.eraser') },
    { id: 'lasso', icon: Lasso, label: t('tool.lasso') },
    { id: 'text', icon: Type, label: t('tool.text') },
    { id: 'shape', icon: Shapes, label: t('tool.shape') },
    { id: 'image', icon: ImagePlus, label: t('tool.image.insert') },
    { id: 'pan', icon: Hand, label: t('tool.pan') },
  ];

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void insertImage(f);
        }}
      />

      <div
        dir="ltr"
        className={cn(
          'absolute z-30 flex items-center gap-1 rounded-2xl border border-border bg-card/95 p-1.5 shadow-ink-2 backdrop-blur',
          // mobile: bottom pill
          'bottom-3 left-1/2 max-w-[94vw] -translate-x-1/2 overflow-x-auto no-scrollbar',
          'lg:bottom-auto lg:left-auto lg:max-w-none lg:translate-x-0 lg:flex-col lg:overflow-visible',
          // vertically centred within the (relative) viewport container
          'lg:top-1/2 lg:-translate-y-1/2',
          railOnRight ? 'lg:right-3' : 'lg:left-3',
        )}
        role="toolbar"
        aria-label={t('app.name')}
      >
        {items.map((item, i) => (
          <div key={`${item.id}-${i}`} className="relative">
            <RailBtn
              icon={<item.icon className="h-5 w-5" />}
              label={item.label}
              active={tool === item.id}
              onClick={() => {
                if (item.id === 'image') {
                  openImagePicker();
                } else {
                  setTool(item.id);
                }
                setPopover((p) => (p === item.id ? null : item.id));
              }}
            />
            {popover === item.id && item.id === lastPen && <PenPopover />}
            {popover === 'highlighter' && item.id === 'highlighter' && <HighlighterPopover />}
            {popover === 'eraser' && item.id === 'eraser' && <EraserPopover />}
            {popover === 'shape' && item.id === 'shape' && <ShapePopover />}
          </div>
        ))}
        <div className="mx-1 h-6 w-px shrink-0 bg-border lg:mx-0 lg:h-px lg:w-6" />
        {/* finger drawing toggle — off by default: pen writes, finger navigates */}
        <RailBtn
          icon={<Pointer className="h-5 w-5" />}
          label={t('tool.fingerDraw', 'Draw with finger', 'الكتابة بالإصبع')}
          active={fingerDrawing}
          onClick={() => {
            const next = !useApp.getState().settings.fingerDrawing;
            void useApp.getState().setSettings({ fingerDrawing: next });
            toast.success(next
              ? t('tool.fingerDraw.on', 'Finger drawing on', 'تم تفعيل الكتابة بالإصبع')
              : t('tool.fingerDraw.off', 'Finger pans & zooms', 'الإصبع للتنقل والتكبير'), { duration: 2200 });
          }}
        />
        <RailBtn
          icon={<RulerIcon className="h-5 w-5" />}
          label={t('tool.ruler')}
          active={rulerVisible}
          onClick={() => { toggleRuler(); ruler.visible = !ruler.visible }}
        />
        <RailBtn
          icon={<Mic className="h-5 w-5" />}
          label={t('tool.audio')}
          active={audioOpen}
          onClick={() => setAudioOpen(true)}
        />
      </div>

      <AudioPanel open={audioOpen} onOpenChange={setAudioOpen} />
    </>
  );
}

function RailBtn({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl press-scale transition-colors',
        active ? 'bg-primary text-primary-foreground shadow-ink-1' : 'text-foreground hover:bg-accent',
      )}
    >
      {icon}
    </button>
  );
}

// ---------------------------------------------------------------- popovers
function Pop({ children, side = 'left' }: { children: React.ReactNode; side?: 'left' | 'right' }) {
  return (
    <div
      dir="ltr"
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'absolute bottom-14 left-0 z-40 w-64 rounded-xl border border-border bg-card p-3 shadow-ink-2 lg:bottom-auto lg:top-0',
        // one horizontal constraint only (the other must be auto or it wins the
        // over-constrained cascade and the panel lands off-screen)
        side === 'right' ? 'lg:right-14 lg:left-auto' : 'lg:left-14 lg:right-auto',
      )}
      style={{ pointerEvents: 'auto' }}
    >
      {children}
    </div>
  );
}

function PenPopover() {
  const railSide = useApp((s) => s.settings.leftHanded) !== useT().isRTL ? 'right' as const : 'left' as const;
  const { t } = useT();
  const lastPen = useApp((s) => s.editor.lastPen);
  const toolStates = useApp((s) => s.editor.toolStates);
  const setTool = useApp((s) => s.setTool);
  const setToolState = useApp((s) => s.setToolState);
  const [colorOpen, setColorOpen] = useState(false);
  const pens: ToolId[] = ['fountain', 'ballpoint', 'brush', 'fineliner'];

  return (
    <Pop side={railSide}>
      <div className="mb-2 grid grid-cols-2 gap-1.5">
        {pens.map((p) => {
          const Icon = PEN_ICONS[p];
          return (
            <button
              key={p}
              type="button"
              onClick={() => setTool(p)}
              className={cn(
                'flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium press-scale',
                lastPen === p ? 'bg-accent text-accent-foreground' : 'hover:bg-surface-variant',
              )}
            >
              <Icon className="h-4 w-4" />
              {t(`tool.${p}`)}
            </button>
          );
        })}
      </div>
      <div className="mb-1 flex items-center justify-between text-xs font-medium text-muted-foreground">
        <span>{t('tool.penSize')}</span>
        <span className="tabular-nums">{toolStates[lastPen].width.toFixed(1)}</span>
      </div>
      <Slider
        value={[toolStates[lastPen].width]}
        min={0.8}
        max={lastPen === 'highlighter' ? 40 : 30}
        step={0.2}
        onValueChange={(v) => setToolState(lastPen, { width: v[0] })}
        aria-label={t('tool.penSize')}
      />
      <div className="relative mt-3">
        <button
          type="button"
          onClick={() => setColorOpen((v) => !v)}
          className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-surface-variant text-xs font-medium press-scale"
          aria-label={t('common.color')}
        >
          <span className="h-4 w-4 rounded-full border border-black/20" style={{ background: toolStates[lastPen].color }} />
          {t('common.color')}
        </button>
        {colorOpen && (
          <div className="absolute start-0 top-11 z-50">
            <ColorPopover current={toolStates[lastPen].color} onPick={(hex) => { setToolState(lastPen, { color: hex }); setColorOpen(false) }} onClose={() => setColorOpen(false)} />
          </div>
        )}
      </div>
    </Pop>
  );
}

function HighlighterPopover() {
  const railSide = useApp((s) => s.settings.leftHanded) !== useT().isRTL ? 'right' as const : 'left' as const;
  const { t } = useT();
  const ts = useApp((s) => s.editor.toolStates.highlighter);
  const setToolState = useApp((s) => s.setToolState);
  const straight = useApp((s) => s.editor.highlighterStraight);
  const setStraight = useApp((s) => s.setHighlighterStraight);
  return (
    <Pop side={railSide}>
      <div className="mb-2 grid grid-cols-5 gap-2">
        {HIGHLIGHTER_PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={c}
            onClick={() => setToolState('highlighter', { color: c })}
            className={cn('h-9 rounded-lg border press-scale', ts.color === c ? 'border-primary ring-2 ring-ring' : 'border-black/10')}
            style={{ background: c }}
          />
        ))}
      </div>
      <div className="mb-1 flex items-center justify-between text-xs font-medium text-muted-foreground">
        <span>{t('tool.width')}</span>
        <span className="tabular-nums">{ts.width.toFixed(0)}</span>
      </div>
      <Slider value={[ts.width]} min={8} max={40} step={1} onValueChange={(v) => setToolState('highlighter', { width: v[0] })} aria-label={t('tool.width')} />
      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs font-medium">{t('tool.highlighter.straight')}</span>
        <Switch checked={straight} onCheckedChange={setStraight} aria-label={t('tool.highlighter.straight')} />
      </div>
    </Pop>
  );
}

function EraserPopover() {
  const railSide = useApp((s) => s.settings.leftHanded) !== useT().isRTL ? 'right' as const : 'left' as const;
  const { t } = useT();
  const eraser = useApp((s) => s.editor.eraser);
  const setEraser = useApp((s) => s.setEraser);
  const activePageId = useApp((s) => s.editor.activePageId);
  const [confirmClear, setConfirmClear] = useState(false);
  return (
    <Pop side={railSide}>
      <div className="mb-3 grid grid-cols-2 gap-1.5">
        {(['stroke', 'area'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setEraser({ mode: m })}
            className={cn('rounded-lg px-2 py-2 text-xs font-medium press-scale', eraser.mode === m ? 'bg-accent text-accent-foreground' : 'hover:bg-surface-variant')}
          >
            {t(`tool.eraser.${m}`)}
          </button>
        ))}
      </div>
      <div className="mb-1 flex items-center justify-between text-xs font-medium text-muted-foreground">
        <span>{t('tool.eraser.size')}</span>
        <span className="tabular-nums">{eraser.size}</span>
      </div>
      <Slider value={[eraser.size]} min={6} max={96} step={2} onValueChange={(v) => setEraser({ size: v[0] })} aria-label={t('tool.eraser.size')} />
      <button
        type="button"
        onClick={() => {
          if (!confirmClear) { setConfirmClear(true); setTimeout(() => setConfirmClear(false), 2600); return }
          if (activePageId) useApp.getState().clearPage(activePageId);
          setConfirmClear(false);
        }}
        className={cn(
          'mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-lg text-xs font-semibold press-scale',
          confirmClear ? 'bg-destructive text-white' : 'bg-surface-variant text-destructive',
        )}
      >
        <Trash2 className="h-4 w-4" />
        {confirmClear ? t('common.confirm') : t('editor.clearPage')}
      </button>
    </Pop>
  );
}

function ShapePopover() {
  const railSide = useApp((s) => s.settings.leftHanded) !== useT().isRTL ? 'right' as const : 'left' as const;
  const { t } = useT();
  const shape = useApp((s) => s.editor.shape);
  const setShape = useApp((s) => s.setShape);
  const [colorOpen, setColorOpen] = useState(false);
  const icons: Record<ShapeType, typeof Pen> = {
    line: Pen, arrow: PenLine, rect: Pen, rrect: Pen, ellipse: Pen, triangle: Pen, star: Pen,
  };
  void icons;
  const shapes: { id: ShapeType; label: string; d: string }[] = [
    { id: 'line', label: t('tool.shape.line'), d: 'M4 12h16' },
    { id: 'arrow', label: t('tool.shape.arrow'), d: 'M4 12h14M13 6l6 6-6 6' },
    { id: 'rect', label: t('tool.shape.rect'), d: 'M4 6h16v12H4z' },
    { id: 'rrect', label: t('tool.shape.rrect'), d: 'M6 6h12a2 2 0 012 2v8a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2z' },
    { id: 'ellipse', label: t('tool.shape.ellipse'), d: 'M12 5a8 7 0 100 14 8 7 0 100-14z' },
    { id: 'triangle', label: t('tool.shape.triangle'), d: 'M12 5l8 14H4z' },
    { id: 'star', label: t('tool.shape.star'), d: 'M12 3l2.7 5.8 6.3.7-4.7 4.3 1.3 6.2L12 17l-5.6 3 1.3-6.2L3 9.5l6.3-.7z' },
  ];
  return (
    <Pop side={railSide}>
      <div className="mb-2 grid grid-cols-4 gap-1.5">
        {shapes.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-label={s.label}
            title={s.label}
            onClick={() => setShape({ type: s.id })}
            className={cn('flex h-11 items-center justify-center rounded-lg press-scale', shape.type === s.id ? 'bg-accent text-accent-foreground' : 'hover:bg-surface-variant')}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d={s.d} />
            </svg>
          </button>
        ))}
      </div>
      <div className="mb-2 grid grid-cols-2 gap-1.5">
        <button
          type="button"
          onClick={() => setShape({ filled: false })}
          className={cn('rounded-lg px-2 py-2 text-xs font-medium press-scale', !shape.filled ? 'bg-accent text-accent-foreground' : 'hover:bg-surface-variant')}
        >
          {t('tool.shape.strokeOnly')}
        </button>
        <button
          type="button"
          onClick={() => setShape({ filled: true })}
          className={cn('rounded-lg px-2 py-2 text-xs font-medium press-scale', shape.filled ? 'bg-accent text-accent-foreground' : 'hover:bg-surface-variant')}
        >
          {t('tool.shape.fill')}
        </button>
      </div>
      <div className="mb-1 flex items-center justify-between text-xs font-medium text-muted-foreground">
        <span>{t('tool.width')}</span>
        <span className="tabular-nums">{shape.width.toFixed(0)}</span>
      </div>
      <Slider value={[shape.width]} min={1} max={16} step={0.5} onValueChange={(v) => setShape({ width: v[0] })} aria-label={t('tool.width')} />
      <div className="relative mt-3">
        <button
          type="button"
          onClick={() => setColorOpen((v) => !v)}
          className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-surface-variant text-xs font-medium press-scale"
          aria-label={t('common.color')}
        >
          <span className="h-4 w-4 rounded-full border border-black/20" style={{ background: shape.color }} />
          {t('common.color')}
        </button>
        {colorOpen && (
          <div className="absolute start-0 top-11 z-50">
            <ColorPopover current={shape.color} onPick={(hex) => { setShape({ color: hex }); setColorOpen(false) }} onClose={() => setColorOpen(false)} />
          </div>
        )}
      </div>
    </Pop>
  );
}

export const TEXT_FONT_IDS = TEXT_FONTS.map((f) => f.id);
