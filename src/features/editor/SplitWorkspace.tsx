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
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowRightLeft, Columns2, Rows2, X } from 'lucide-react';
import { useApp, useT } from '@/lib/nanote/store';
import { PageElement } from '@/lib/nanote/types';
import { cn } from '@/lib/utils';
import { markInteraction } from './viewport';
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

  // -------------------------------------------------- definite pane sizing (px)
  // WHY PIXELS: pane heights as PERCENTAGES collapse to auto in the horizontal
  // orientation — the split container's own height is flex-derived (indefinite
  // for percentage resolution), so `height: 66%` fell back to the pane's
  // content height (the editor's h-dvh), pushing pane B entirely BELOW the
  // viewport (the "horizontal split shows one pane" bug). Measuring the
  // container and sizing BOTH panes in exact pixels is definite at every
  // level: the editor clamps into pane A (h-dvh max-h-full) and pane B's
  // iframe (h-full) resolves against a real height.
  const [boxSize, setBoxSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      setBoxSize((s) => (Math.abs(s.w - r.width) < 1 && Math.abs(s.h - r.height) < 1 ? s : { w: r.width, h: r.height }));
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(measure) };
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    measure();
    return () => {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [open]);
  const DIVIDER_PX = 10; // w-2.5 / h-2.5 separator thickness
  const paneA = {
    w: vertical ? Math.round((boxSize.w - DIVIDER_PX) * ratio) : boxSize.w,
    h: vertical ? boxSize.h : Math.round((boxSize.h - DIVIDER_PX) * ratio),
  };
  const paneB = {
    // the DIVIDER sits on the split axis only — the cross axis is full-size
    w: vertical ? Math.max(24, boxSize.w - DIVIDER_PX - paneA.w) : boxSize.w,
    h: vertical ? boxSize.h : Math.max(24, boxSize.h - DIVIDER_PX - paneA.h),
  };

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
  // PERF MODEL: pointermove fires up to 120+/s (stylus/tablet digitizers);
  // every live ratio update re-lays-out BOTH panes. Three rules keep it jank-free:
  //   1. ratio updates are rAF-COALESCED — at most one React render per frame;
  //   2. pane B (iframe = a whole second document) is FROZEN at its drag-start
  //      pixel size and merely clipped by the wrapper — the embedded document
  //      never re-lays-out mid-drag (its ResizeObserver storm was the
      //      "terrible stutter while resizing panes" killer); it reflows ONCE
  //      on release;
  //   3. pane A's page canvases are told the user is interacting (viewport bus
  //      markInteraction) so no idle re-raster fires mid-drag.
  const [frozenB, setFrozenB] = useState<{ w: number; h: number } | null>(null);
  const startDividerDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    try { (e.target as HTMLElement).setPointerCapture(e.pointerId) } catch { /* gone */ }
    setDragging(true);
    const host = containerRef.current;
    const iframeEl = iframeRef.current;
    if (!host) return;
    // freeze pane B at its current pixel size; scale it via a compositor-only
    // transform while the divider moves (no reflow inside the embedded doc)
    let b0 = { w: 0, h: 0 };
    if (iframeEl) {
      const r = iframeEl.getBoundingClientRect();
      if (r.width > 4 && r.height > 4) {
        b0 = { w: r.width, h: r.height };
        setFrozenB(b0);
      }
    }
    let pending: number | null = null;
    let latestK: number | null = null;
    const applyK = () => {
      pending = null;
      if (latestK == null) return;
      const k = latestK;
      latestK = null;
      setLiveRatio(k);
      markInteraction(); // suppress pane-A idle re-rasters while the divider moves
      // scale the frozen iframe to visually fill pane B at the new ratio —
      // compositor-only (the embedded document never re-lays-out)
      if (iframeEl && b0.w > 4 && b0.h > 4) {
        if (vertical) {
          const bw = Math.max(24, boxSize.w - k * (boxSize.w - DIVIDER_PX));
          iframeEl.style.transform = `scaleX(${bw / b0.w})`;
        } else {
          const bh = Math.max(24, boxSize.h - k * (boxSize.h - DIVIDER_PX));
          iframeEl.style.transform = `scaleY(${bh / b0.h})`;
        }
      }
    };
    const onMove = (ev: PointerEvent) => {
      const r = host.getBoundingClientRect();
      let k = vertical ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height;
      k = Math.min(MAX_RATIO, Math.max(MIN_RATIO, k));
      latestK = k;
      if (pending == null) pending = requestAnimationFrame(applyK);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (pending != null) { cancelAnimationFrame(pending); pending = null }
      if (latestK != null) setLiveRatio(latestK);
      setDragging(false);
      setFrozenB(null); // one final reflow of pane B at the committed ratio
      if (iframeEl) iframeEl.style.transform = '';
      setLiveRatio((k) => {
        if (k != null) useApp.getState().setSplit({ ratio: k });
        return null;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  if (!open) {
    // single pane — children keep their exact tree position (no remount).
    // The wrapper gets the measured pixel size so the editor's max-h-full
    // clamp has a definite reference (same definite-sizing rule as the panes).
    return (
      <div ref={containerRef} className="flex min-h-0 flex-1 flex-col" style={boxSize.w > 0 ? { width: boxSize.w, height: boxSize.h } : undefined}>
        {children}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={cn('flex min-h-0 min-w-0 flex-1 overflow-hidden', vertical ? 'flex-row' : 'flex-col')}
      dir="ltr"
    >
      {/* pane A — the live editor (pointer-dead while the divider drags).
          Exact PIXEL size: percentage heights collapse to auto against the
          flex-derived container height (pane B ended up below the viewport). */}
      <div
        className="relative flex min-h-0 min-w-0 flex-col overflow-hidden"
        style={{
          width: Math.max(24, paneA.w),
          height: Math.max(24, paneA.h),
          ...(dragging ? { pointerEvents: 'none' } : null),
        }}
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

      {/* pane B — embedded instance, exact PIXEL size (definite for the
          iframe's h-full). FROZEN at its drag-start pixel size while the
          divider moves (no document reflow mid-drag) and scaled by a
          compositor transform until the release reflow. */}
      <div
        className="relative min-h-0 min-w-0 overflow-hidden bg-background"
        style={{ width: Math.max(24, paneB.w), height: Math.max(24, paneB.h) }}
      >
        <iframe
          ref={iframeRef}
          key={split.notebookB ?? 'b'}
          src={`/?embed=1&nb=${encodeURIComponent(split.notebookB ?? '')}`}
          title={t('split.paneB', 'Split workspace', 'مساحة مقسّمة')}
          className="h-full w-full border-0"
          allow="clipboard-read; clipboard-write; autoplay"
          style={{
            pointerEvents: dragging ? 'none' : 'auto',
            ...(frozenB
              ? { position: 'absolute' as const, left: 0, top: 0, width: frozenB.w, height: frozenB.h, transformOrigin: '0 0' }
              : null),
          }}
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
