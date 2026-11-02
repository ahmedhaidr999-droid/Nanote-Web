'use client';
// SplitWorkspace — two independent workspaces side by side:
//   • pane A = the live editor instance (this app, `children`) — never remounts
//     when the split opens/closes/resizes (same React position in the tree),
//     so nothing reloads and no ink is lost while dragging the divider;
//   • pane B = a second notebook in an embedded same-origin instance
//     (iframe). It runs the exact same editor engine — its own viewport, its
//     own undo/redo stack, its own autosave into the same IndexedDB — so both
//     panes write independently with full pen quality.
// The divider is draggable (live ratio 20–80%, double-tap resets 50%) with a
// small control cluster: swap panes, flip orientation, close pane B.
// Cross-pane transfers (clipboard sync, send-selection, drag-to-edge) run
// over the splitbus postMessage protocol.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRightLeft, Columns2, Rows2, X } from 'lucide-react';
import { useApp, useT } from '@/lib/nanote/store';
import { PageElement } from '@/lib/nanote/types';
import { cn } from '@/lib/utils';
import {
  onChildMessage, postToChild, receiveDroppedElements, registerParentSender,
  type SplitMessage,
} from './splitbus';

const MIN_RATIO = 0.2;
const MAX_RATIO = 0.8;

export function SplitWorkspace({ children, notebookA }: { children: React.ReactNode; notebookA: string }) {
  const { t } = useT();
  const split = useApp((s) => s.split);
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [dragging, setDragging] = useState(false);
  const [liveRatio, setLiveRatio] = useState<number | null>(null);
  /** which notebook pane B has finished loading (loading overlay per source) */
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const loaded = loadedFor === (split.notebookB ?? '');

  const open = split.open && !!split.notebookB && split.notebookB !== notebookA;
  const vertical = split.orientation === 'vertical';
  const ratio = liveRatio ?? split.ratio;

  // -------------------------------------------------- outgoing: parent → child
  const send = useCallback((msg: SplitMessage) => {
    postToChild(iframeRef.current, msg);
  }, []);

  useEffect(() => {
    registerParentSender(send);
    return () => registerParentSender(null);
  }, [send]);

  // keep the child informed about which side its divider is on
  useEffect(() => {
    if (open) send({ type: 'splitLayout', orientation: split.orientation });
  }, [open, split.orientation, send]);

  // clipboard: pane A copies → pane B can paste (loop-suppressed)
  const suppressBroadcastRef = useRef(false);
  useEffect(() => {
    if (!open) return;
    const unsub = useApp.subscribe((state, prev) => {
      if (state.editor.clipboard === prev.editor.clipboard) return;
      if (suppressBroadcastRef.current) { suppressBroadcastRef.current = false; return }
      if (state.editor.clipboard?.length) send({ type: 'clipboardPut', elements: state.editor.clipboard });
    });
    return unsub;
  }, [open, send]);

  // -------------------------------------------------- incoming: child → parent
  useEffect(() => {
    if (!open) return;
    return onChildMessage((msg, reply) => {
      switch (msg.type) {
        case 'ready':
          reply({ type: 'splitLayout', orientation: useApp.getState().split.orientation });
          break;
        case 'closeRequest':
          useApp.getState().closeSplit();
          break;
        case 'clipboardPut':
          // pane B copied → pane A's paste works with it (no echo back)
          suppressBroadcastRef.current = true;
          useApp.setState({ editor: { ...useApp.getState().editor, clipboard: msg.elements as PageElement[] } });
          break;
        case 'transferOut':
          receiveDroppedElements(msg.elements as PageElement[]);
          break;
        case 'receiveDrop':
          receiveDroppedElements(msg.elements as PageElement[]);
          break;
        default:
          break;
      }
    });
  }, [open]);

  // -------------------------------------------------- divider drag
  const startDividerDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    try { (e.target as HTMLElement).setPointerCapture(e.pointerId) } catch { /* gone */ }
    setDragging(true);
    const host = containerRef.current;
    if (!host) return;
    const onMove = (ev: PointerEvent) => {
      const r = host.getBoundingClientRect();
      let k = vertical ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height;
      k = Math.min(MAX_RATIO, Math.max(MIN_RATIO, k));
      setLiveRatio(k);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setDragging(false);
      setLiveRatio((k) => {
        if (k != null) useApp.getState().setSplit({ ratio: k });
        return null;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  if (!open) {
    // single pane — children keep their exact tree position (no remount)
    return <div className="flex min-h-0 flex-1 flex-col">{children}</div>;
  }

  return (
    <div
      ref={containerRef}
      className={cn('flex min-h-0 min-w-0 flex-1', vertical ? 'flex-row' : 'flex-col')}
      dir="ltr"
    >
      {/* pane A — the live editor */}
      <div
        className="relative flex min-h-0 min-w-0 flex-col"
        style={vertical ? { width: `${ratio * 100}%` } : { height: `${ratio * 100}%` }}
      >
        {children}
      </div>

      {/* draggable divider */}
      <div
        role="separator"
        aria-orientation={vertical ? 'vertical' : 'horizontal'}
        aria-label={t('split.divider', 'Resize panes', 'تغيير حجم المساحات')}
        tabIndex={0}
        onPointerDown={startDividerDrag}
        onDoubleClick={() => useApp.getState().setSplit({ ratio: 0.5 })}
        onKeyDown={(e) => {
          const step = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -0.05 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 0.05 : 0;
          if (step) {
            e.preventDefault();
            useApp.getState().setSplit({ ratio: Math.min(MAX_RATIO, Math.max(MIN_RATIO, useApp.getState().split.ratio + step)) });
          }
        }}
        className={cn(
          'group relative z-30 flex shrink-0 items-center justify-center bg-border transition-colors hover:bg-primary/40',
          vertical ? 'w-2.5 cursor-col-resize' : 'h-2.5 cursor-row-resize',
          dragging && 'bg-primary/60',
        )}
        style={{ touchAction: 'none' }}
      >
        {/* grip */}
        <div className={cn('rounded-full bg-muted-foreground/40', vertical ? 'h-10 w-1' : 'h-1 w-10')} />
        {/* control cluster — floats on the divider */}
        <div
          className={cn(
            'absolute z-40 flex items-center gap-0.5 rounded-full border border-border bg-card/95 p-1 shadow-ink-2 backdrop-blur',
            vertical ? 'top-1/2 -translate-y-1/2' : 'left-1/2 -translate-x-1/2',
            'opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100',
          )}
          style={{ [vertical ? 'left' : 'top']: '50%', transform: vertical ? 'translate(-50%, -50%)' : 'translate(-50%, -50%)' } as React.CSSProperties}
        >
          <SplitBtn
            label={t('split.swap', 'Swap panes', 'تبديل المساحات')}
            onClick={() => useApp.getState().swapSplit()}
          >
            <ArrowRightLeft className="h-4 w-4" />
          </SplitBtn>
          <SplitBtn
            label={vertical ? t('split.horizontal', 'Horizontal split', 'تقسيم أفقي') : t('split.vertical', 'Vertical split', 'تقسيم عمودي')}
            onClick={() => useApp.getState().setSplit({ orientation: vertical ? 'horizontal' : 'vertical' })}
          >
            {vertical ? <Rows2 className="h-4 w-4" /> : <Columns2 className="h-4 w-4" />}
          </SplitBtn>
          <SplitBtn label={t('split.close', 'Close split', 'إغلاق التقسيم')} onClick={() => useApp.getState().closeSplit()}>
            <X className="h-4 w-4 text-destructive" />
          </SplitBtn>
        </div>
      </div>

      {/* pane B — embedded instance */}
      <div className="relative min-h-0 min-w-0 flex-1 bg-background">
        <iframe
          ref={iframeRef}
          key={split.notebookB ?? 'b'}
          src={`/?embed=1&nb=${encodeURIComponent(split.notebookB ?? '')}`}
          title={t('split.paneB', 'Split workspace', 'مساحة مقسّمة')}
          className="h-full w-full border-0"
          allow="clipboard-read; clipboard-write; autoplay"
          style={{ pointerEvents: dragging ? 'none' : 'auto' }}
          onLoad={() => setLoadedFor(split.notebookB ?? '')}
        />
        {!loaded && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background">
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" aria-hidden />
              <span className="text-xs font-medium">{t('split.loading', 'Opening workspace…', 'جارٍ فتح المساحة…')}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SplitBtn({ children, label, onClick }: { children: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-full text-foreground transition-colors press-scale hover:bg-accent active:bg-accent"
    >
      {children}
    </button>
  );
}
