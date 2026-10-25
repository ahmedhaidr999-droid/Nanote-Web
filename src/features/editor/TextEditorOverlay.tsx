'use client';
// TextEditorOverlay — floating textarea that matches the canvas text metrics
// (font, size, color, alignment, Arabic-aware direction). Commits as one undo.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Bold, Italic, Underline, AlignStartVertical, AlignCenterVertical, AlignEndVertical, Trash2, Check, Minus, Plus } from 'lucide-react';
import { useApp, useT } from '@/lib/nanote/store';
import { TextEl, TEXT_FONTS } from '@/lib/nanote/types';
import { uid } from '@/lib/nanote/util';
import { cn } from '@/lib/utils';
import { useVp, worldToScreen, setHiddenIds, type PageLayout } from './viewport';
import { ColorPopover } from './ColorPopover';

export interface TextSession {
  pageId: string;
  layoutY: number;
  existing: TextEl | null;
  pt: { x: number; y: number };
}

export function TextEditorOverlay({ session, onDone }: { session: TextSession; onDone: () => void }) {
  const vp = useVp();
  const { t } = useT();
  const textDefaults = useApp((s) => s.editor.textDefaults);
  const [el, setEl] = useState<TextEl>(() =>
    session.existing ?? {
      kind: 'text', id: uid(), x: session.pt.x, y: session.pt.y - textDefaults.size, w: 360,
      text: '', fontId: textDefaults.fontId, size: textDefaults.size, color: textDefaults.color,
      bold: textDefaults.bold, italic: textDefaults.italic, underline: textDefaults.underline,
      align: textDefaults.align, z: 0,
    },
  );
  const [colorOpen, setColorOpen] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const original = useRef(session.existing);
  const isNew = !session.existing;

  useEffect(() => {
    taRef.current?.focus();
    taRef.current?.select();
  }, []);

  // hide the canvas copy of the element while editing
  useEffect(() => {
    if (session.existing) setHiddenIds(session.pageId, new Set([session.existing.id]));
    return () => setHiddenIds(session.pageId, null);
  }, [session]);

  const commit = () => {
    const st = useApp.getState();
    const text = el.text.replace(/\s+$/g, '');
    if (isNew) {
      if (text.trim()) {
        void st.ensureDoc(session.pageId).then((doc) => {
          const z = doc.elements.reduce((acc, e) => Math.max(acc, e.z), 0) + 1;
          st.addElements(session.pageId, [{ ...el, text, z }]);
        });
      }
    } else if (original.current) {
      if (!text.trim()) st.removeElements(session.pageId, [el.id]);
      else if (original.current.text !== text || styleChanged(original.current, el)) {
        st.patchElements(session.pageId, [{ id: el.id, before: original.current, after: { ...el, text } }], 'text');
      }
    }
    // persist style tweaks as new defaults
    st.setTextDefaults({
      fontId: el.fontId, size: el.size, color: el.color,
      bold: el.bold, italic: el.italic, underline: el.underline, align: el.align,
    });
    onDone();
  };

  const pos = useMemo(() => {
    const s = worldToScreen(el.x, session.layoutY + el.y);
    return { left: s.x, top: s.y };
  }, [el.x, el.y, session.layoutY, vp.tx, vp.ty, vp.scale]);

  const rtl = /[\u0590-\u08FF]/.test(el.text);
  const fontDef = TEXT_FONTS.find((f) => f.id === el.fontId) ?? TEXT_FONTS[0];

  const alignIcon = el.align === 'start' ? AlignStartVertical : el.align === 'center' ? AlignCenterVertical : AlignEndVertical;
  const nextAlign = () => setEl((p) => ({ ...p, align: p.align === 'start' ? 'center' : p.align === 'center' ? 'end' : 'start' }));

  return (
    <div className="absolute z-40" style={{ left: pos.left, top: Math.max(48, pos.top - 44), pointerEvents: 'none' }} dir="ltr">
      {/* styling bar */}
      <div
        className="mb-1 flex items-center gap-0.5 rounded-full border border-border bg-card/95 p-1 shadow-ink-2 backdrop-blur"
        style={{ pointerEvents: 'auto' }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <select
          aria-label={t('tool.text.font')}
          value={el.fontId}
          onChange={(e) => setEl((p) => ({ ...p, fontId: e.target.value }))}
          className="h-8 rounded-full bg-transparent px-2 text-xs outline-none"
        >
          {TEXT_FONTS.map((f) => (
            <option key={f.id} value={f.id}>{f.label}</option>
          ))}
        </select>
        <div className="flex items-center rounded-full bg-surface-variant">
          <button type="button" aria-label={t('tool.text.size')} className="flex h-8 w-7 items-center justify-center rounded-full hover:bg-accent" onClick={() => setEl((p) => ({ ...p, size: Math.max(10, p.size - 2) }))}><Minus className="h-3.5 w-3.5" /></button>
          <span className="w-8 text-center text-xs tabular-nums">{Math.round(el.size)}</span>
          <button type="button" aria-label={t('tool.text.size')} className="flex h-8 w-7 items-center justify-center rounded-full hover:bg-accent" onClick={() => setEl((p) => ({ ...p, size: Math.min(120, p.size + 2) }))}><Plus className="h-3.5 w-3.5" /></button>
        </div>
        <TB active={el.bold} label={t('tool.text.bold')} onClick={() => setEl((p) => ({ ...p, bold: !p.bold }))}><Bold className="h-4 w-4" /></TB>
        <TB active={el.italic} label={t('tool.text.italic')} onClick={() => setEl((p) => ({ ...p, italic: !p.italic }))}><Italic className="h-4 w-4" /></TB>
        <TB active={el.underline} label={t('tool.text.underline')} onClick={() => setEl((p) => ({ ...p, underline: !p.underline }))}><Underline className="h-4 w-4" /></TB>
        <TB label={t('tool.text.align')} onClick={nextAlign}>{(() => { const Icon = alignIcon; return <Icon className="h-4 w-4" /> })()}</TB>
        <div className="relative">
          <button type="button" aria-label={t('common.color')} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-accent" onClick={() => setColorOpen((v) => !v)}>
            <span className="h-4 w-4 rounded-full border border-black/20" style={{ background: el.color }} />
          </button>
          {colorOpen && (
            <div className="absolute start-0 top-10 z-50">
              <ColorPopover current={el.color} onPick={(hex) => { setEl((p) => ({ ...p, color: hex })); setColorOpen(false) }} onClose={() => setColorOpen(false)} />
            </div>
          )}
        </div>
        {!isNew && (
          <TB label={t('common.delete')} onClick={() => { useApp.getState().removeElements(session.pageId, [el.id]); onDone() }}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </TB>
        )}
        <TB label={t('common.done')} onClick={commit}><Check className="h-4 w-4 text-success" /></TB>
      </div>

      {/* textarea anchored to page position */}
      <textarea
        ref={taRef}
        dir={rtl ? 'rtl' : 'ltr'}
        value={el.text}
        onChange={(e) => setEl((p) => ({ ...p, text: e.target.value }))}
        onBlur={(e) => { if (!e.relatedTarget && !colorOpen) commit() }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); commit() }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit() }
          e.stopPropagation();
        }}
        placeholder={t('tool.text.placeholder')}
        rows={Math.max(1, el.text.split('\n').length)}
        className="resize-none overflow-hidden rounded-md bg-transparent outline-none placeholder:text-muted-foreground/60 focus:outline-none"
        style={{
          position: 'absolute',
          left: 0,
          top: 44,
          width: Math.max(120, el.w * vp.scale),
          height: 'auto',
          fontFamily: fontDef.css,
          fontSize: el.size * vp.scale,
          lineHeight: 1.35,
          color: el.color,
          fontWeight: el.bold ? 700 : 400,
          fontStyle: el.italic ? 'italic' : 'normal',
          textDecoration: el.underline ? 'underline' : 'none',
          textAlign: el.align === 'center' ? 'center' : el.align === 'end' ? (rtl ? 'left' : 'right') : rtl ? 'right' : 'left',
          caretColor: el.color,
          pointerEvents: 'auto',
        }}
      />
    </div>
  );
}

function styleChanged(a: TextEl, b: TextEl): boolean {
  return (
    a.x !== b.x || a.y !== b.y || a.w !== b.w || a.fontId !== b.fontId || a.size !== b.size ||
    a.color !== b.color || a.bold !== b.bold || a.italic !== b.italic ||
    a.underline !== b.underline || a.align !== b.align
  );
}

function TB({ children, label, onClick, active }: { children: React.ReactNode; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-full press-scale',
        active ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
      )}
    >
      {children}
    </button>
  );
}
