'use client';
// InkSurface — the editor's input engine. Routes pointer input by device class:
//   • stylus ('pen')  → always writes. Real-world stylus data baked in:
//     Apple Pencil (240 Hz, pressure 0–1, tiltX/tiltY, hover on M2 iPads),
//     Samsung S Pen (Wacom EMR, 360 Hz, pressure, tilt), Surface/Slim Pen,
//     generic active pens — all surface as pointerType 'pen' with coalesced
//     events. Pressure drives width; tilt widens fountain/brush like a real
//     angled nib; hover shows a tracked cursor ring.
//   • mouse           → writes (space / middle button / pan tool = pan).
//   • touch           → navigates by default (one finger pan, two finger pinch,
//     double-tap zoom). Draws ONLY when "finger drawing" is enabled — and
//     never while a pen is in range (palm rejection: touches are ignored
//     ENTIRELY — no draw and no pan — so the page can never drift under a
//     resting hand), and never when the contact is palm-sized.
// Latency work: coalesced-event capture (all 240 Hz samples, not one/frame),
// zoom-adaptive input decimation, two-tier live outline (cached Path2D head +
// cheap recomputed tail), committed strokes linger on the overlay until the
// page raster catches up (no vanish-frame), smooth animated double-tap zoom.
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useApp, useT } from '@/lib/nanote/store';
import { StrokeEl, ToolId, TextEl } from '@/lib/nanote/types';
import { uid, clamp } from '@/lib/nanote/util';
import { computeOutline, OP } from '@/lib/nanote/outline';
import {
  elementInLasso, strokeIntersectsCircle, elementIntersectsCircle, strokeErasedByArea,
  snapAngle, shapePath,
} from '@/lib/nanote/geometry';
import {
  Painter, addPainter, getVp, screenToWorld, worldToScreen, zoomAt, animateZoomTo, cancelZoomAnim,
  panBy, setVp, clampScale, requestOverlayRepaint, setHiddenIds, snapToRuler,
  type PageLayout, pageAtWorldY, axisBounds, VIEWPORT_PAD,
  beginVpGesture, endVpGesture, vpAnimGen, animateVpTo,
} from './viewport';

const AUTO_CONTINUE_PTS = 2400;   // very long strokes continue as a fresh stroke
const PEN_IDLE_MS = 3000;         // pen "in range" window after last pen event
const PALM_DRAW_PX = 50;          // touch contact axis (px) too big to draw with
const PALM_NAV_PX = 75;           // touch contact axis (px) too big to even navigate
const TAIL_PTS = 26;              // live tail recomputed each frame (two-tier render)
const HEAD_REBUILD = 18;          // rebuild cached head every N new points

// ---- modern pan physics (Xodo / GoodNotes feel) ----
const PAN_OVERSHOOT = 110;        // max px of elastic overscroll beyond a bound
const PAN_RESIST = 0.32;          // rubber-band damping while overscrolled
const MOMENTUM_TAU = 240;         // ms — flick glide decay constant
const FLICK_MAX_V = 3;            // px/ms release-velocity cap
const SAMPLE_WINDOW = 90;         // ms of recent motion used for release velocity
const HOLD_STILL_MS = 120;        // release after this much stillness ⇒ no flick

type Mode =
  | { type: 'none' }
  | { type: 'stroke'; pointerId: number; pageId: string; pageY: number; points: OP[]; tool: ToolId; color: string; width: number; startAbs: number; lastAbs: number; lastTs: number; minDist: number; pSmooth: number; straight: boolean; cached: Path2D | null; cachedUpTo: number }
  | { type: 'erase'; pointerId: number; pageId: string; pageY: number; path: { x: number; y: number }[]; removed: Set<string>; lastScreen: { x: number; y: number } }
  | { type: 'lasso'; pointerId: number; pageId: string; pageY: number; poly: { x: number; y: number }[] }
  | { type: 'shape'; pointerId: number; pageId: string; pageY: number; ax: number; ay: number; bx: number; by: number }
  | { type: 'pan'; pointerId: number; lastX: number; lastY: number; rawX: number; rawY: number;
      lockX: boolean; lockY: boolean; minX: number; maxX: number; minY: number; maxY: number;
      samples: { t: number; x: number; y: number }[]; lastMoveT: number }
  | { type: 'pinch'; ids: [number, number]; d0: number; scale0: number; mid0: { x: number; y: number }; tx0: number; ty0: number }

type PanMode = Extract<Mode, { type: 'pan' }>;

interface LingerItem { pageY: number; path: Path2D; color: string; hi: boolean; darkPaper: boolean; elId: string }

const HOVER_TOOLS: Set<string> = new Set(['fountain', 'ballpoint', 'brush', 'fineliner', 'highlighter', 'shape']);

const isDarkPaper = (hex: string | undefined): boolean => {
  if (!hex) return false;
  const m = hex.replace('#', '');
  if (m.length < 6) return false;
  const r = parseInt(m.slice(0, 2), 16), g = parseInt(m.slice(2, 4), 16), b = parseInt(m.slice(4, 6), 16);
  return (r * 0.299 + g * 0.587 + b * 0.114) / 255 < 0.45;
};

/** trace a closed outline into a Path2D (or ctx) */
function tracePath(target: Path2D | CanvasRenderingContext2D, outline: number[]) {
  for (let i = 0; i < outline.length; i += 2) {
    if (i === 0) target.moveTo(outline[0], outline[1]);
    else target.lineTo(outline[i], outline[i + 1]);
  }
  target.closePath();
}

/** all coalesced samples of an event (high-Hz digitizers batch many per frame) */
function coalescedOf(e: PointerEvent): PointerEvent[] {
  const ce = (e as PointerEvent & { getCoalescedEvents?: () => PointerEvent[] }).getCoalescedEvents?.();
  return ce && ce.length ? ce : [e];
}

export interface InkSurfaceProps {
  layouts: PageLayout[];
  pageW: number;
  onTextTap: (pageId: string, pt: { x: number; y: number }, existing: TextEl | null) => void;
}

export default function InkSurface({ layouts, pageW, onTextTap }: InkSurfaceProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef<Mode>({ type: 'none' });
  const pointersRef = useRef(new Map<number, { x: number; y: number; type: string }>());
  const penSeenRef = useRef(0);          // last time ANY pen event arrived (contact or hover)
  const activeTypeRef = useRef<string | null>(null); // device class of the active gesture
  const hoverRef = useRef<{ x: number; y: number } | null>(null);
  const lingerRef = useRef<LingerItem[]>([]);
  const palmToastRef = useRef(false);
  const spaceRef = useRef(false);
  const lastTapRef = useRef<{ t: number; x: number; y: number } | null>(null);
  const downInfoRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const scrollRafRef = useRef(0);   // momentum / settle rAF (one at a time)
  const { t, lang } = useT();
  const langRef = useRef(lang);
  const tRef = useRef(t);
  useEffect(() => {
    langRef.current = lang;
    tRef.current = t;
  }, [lang, t]);

  // -------------------------------------------------- helpers
  const localPt = (e: PointerEvent | React.PointerEvent) => {
    const rect = hostRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const worldFromEvent = (e: PointerEvent | React.PointerEvent) => {
    const l = localPt(e);
    return screenToWorld(l.x, l.y);
  };

  const pageForWorld = (wy: number) => pageAtWorldY(layouts, wy);

  /** sin of the stylus tilt angle from vertical (0 = upright, 1 = flat). */
  const tiltSinOf = (e: PointerEvent): number => {
    if (e.pointerType !== 'pen') return 0;
    const tx = Number(e.tiltX) || 0;
    const ty = Number(e.tiltY) || 0;
    if (tx === 0 && ty === 0) return 0;
    const t2 = Math.tan(tx * Math.PI / 180) ** 2 + Math.tan(ty * Math.PI / 180) ** 2;
    if (!isFinite(t2)) return 1; // ≥90° → pen flat
    if (t2 <= 0) return 0;
    return Math.min(1, Math.sqrt(t2 / (1 + t2)));
  };

  /** stylus pressure → ink pressure; angled fountain/brush nibs widen. */
  const pressureOf = (e: PointerEvent, tool: ToolId): number => {
    if (e.pointerType === 'pen') {
      let p = e.pressure > 0 ? clamp(e.pressure, 0.04, 1) : 0.5;
      if (tool === 'fountain' || tool === 'brush') p = clamp(p * (1 + 0.5 * tiltSinOf(e)), 0.04, 1);
      return p;
    }
    return 0.5; // mouse & finger
  };

  const palmToast = () => {
    if (palmToastRef.current) return;
    palmToastRef.current = true;
    toast.info(tRef.current('tool.palmReject'), { duration: 2600 });
    setTimeout(() => { palmToastRef.current = false }, 15000);
  };

  /** touch pointer we refuse outright (palm rejection / oversized contact)? */
  const rejectTouch = (e: PointerEvent): boolean => {
    const contact = Math.max(e.width || 0, e.height || 0);
    if (contact > PALM_NAV_PX) return true;                       // palm-sized — never
    const now = performance.now();
    if (activeTypeRef.current === 'pen') return true;             // writing right now
    if (penSeenRef.current > 0 && now - penSeenRef.current < PEN_IDLE_MS) {
      if (e.width === 0 || contact <= PALM_DRAW_PX) palmToast();  // explain only plausible fingers
      return true;                                                // pen in range — palm/pause window
    }
    return false;
  };

  /** may this pointer use the active drawing/erase/shape tool? */
  const canDrawWith = (e: PointerEvent): boolean => {
    if (e.pointerType === 'pen' || e.pointerType === 'mouse') return true;
    const st = useApp.getState();
    if (e.pointerType !== 'touch') return false;
    if (Math.max(e.width || 0, e.height || 0) > PALM_DRAW_PX) return false;
    if (!st.settings.fingerDrawing) return false;
    if (st.settings.stylusOnly && penSeenRef.current > 0) return false; // pen-only mode
    return true;
  };

  // -------------------------------------------------- live overlay painter
  useEffect(() => {
    const painter: Painter = (ctx, vp) => {
      const m = modeRef.current;
      ctx.save();

      // committed strokes lingering until the page raster catches up
      for (const lg of lingerRef.current) {
        ctx.save();
        ctx.translate(vp.tx, lg.pageY * vp.scale + vp.ty);
        ctx.scale(vp.scale, vp.scale);
        if (lg.hi) {
          ctx.globalAlpha = lg.darkPaper ? 0.45 : 0.5;
          ctx.globalCompositeOperation = lg.darkPaper ? 'source-over' : 'multiply';
        }
        ctx.fillStyle = lg.color;
        ctx.fill(lg.path);
        ctx.restore();
      }

      if (m.type === 'stroke') {
        ctx.translate(vp.tx, m.pageY * vp.scale + vp.ty);
        ctx.scale(vp.scale, vp.scale);
        const st = useApp.getState();
        const gamma = st.settings.pressureCurve;
        const opts = { tool: m.tool, width: m.width, gamma };
        if (m.tool === 'highlighter') {
          const page = st.editor.pages.find((p) => p.id === m.pageId);
          const dark = isDarkPaper(page?.backgroundHex);
          ctx.globalAlpha = dark ? 0.45 : 0.5;
          ctx.globalCompositeOperation = dark ? 'source-over' : 'multiply';
        }
        ctx.fillStyle = m.color;
        const n = m.points.length;
        if (m.tool !== 'highlighter' && n > 80) {
          // two-tier: cached head Path2D + cheap live tail (opaque inks — overlap invisible)
          if (!m.cached || n - m.cachedUpTo >= HEAD_REBUILD) {
            const head = m.points.slice(0, Math.max(2, n - TAIL_PTS + 3));
            const outline = computeOutline(head, opts);
            const p = new Path2D();
            tracePath(p, outline);
            m.cached = p;
            m.cachedUpTo = head.length;
          }
          const tail = m.points.slice(Math.max(0, m.cachedUpTo - 3));
          if (m.cached) ctx.fill(m.cached);
          const tailOutline = computeOutline(tail, opts);
          if (tailOutline.length) {
            const tp = new Path2D();
            tracePath(tp, tailOutline);
            ctx.fill(tp);
          }
        } else {
          const outline = computeOutline(m.points, opts);
          if (outline.length) {
            const p = new Path2D();
            tracePath(p, outline);
            ctx.fill(p);
          }
        }
      } else if (m.type === 'lasso') {
        ctx.strokeStyle = '#1E6FF2';
        ctx.lineWidth = 1.6;
        ctx.setLineDash([7, 5]);
        ctx.lineDashOffset = -(performance.now() / 40) % 12;
        ctx.beginPath();
        m.poly.forEach((p, i) => {
          const s = worldToScreen(p.x, p.y);
          if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (m.type === 'shape') {
        ctx.translate(vp.tx, m.pageY * vp.scale + vp.ty);
        ctx.scale(vp.scale, vp.scale);
        const st = useApp.getState().editor.shape;
        ctx.strokeStyle = st.color;
        ctx.fillStyle = st.color;
        ctx.lineWidth = st.width;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        shapePath(ctx, st.type, Math.min(m.ax, m.bx), Math.min(m.ay, m.by), Math.abs(m.bx - m.ax), Math.abs(m.by - m.ay));
        if (st.filled) ctx.fill(); else ctx.stroke();
      } else if (m.type === 'erase') {
        const st = useApp.getState().editor.eraser;
        ctx.beginPath();
        ctx.arc(m.lastScreen.x, m.lastScreen.y, st.size / 2, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(229,72,77,0.9)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = 'rgba(229,72,77,0.10)';
        ctx.fill();
      } else if (m.type === 'none') {
        // pen hover cursor ring (Apple Pencil hover / stylus tracking)
        const hover = hoverRef.current;
        if (hover && HOVER_TOOLS.has(useApp.getState().editor.tool)) {
          const st = useApp.getState();
          const ts = st.editor.toolStates[st.editor.lastPen];
          const r = ts ? clamp(ts.width * vp.scale / 2, 2.5, 18) : 3;
          ctx.beginPath();
          ctx.arc(hover.x, hover.y, r, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(30,111,242,0.55)';
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
      }
      ctx.restore();
    };
    return addPainter(painter);
  }, []);

  // -------------------------------------------------- stroke commit + linger
  const clearLinger = (elId: string) => {
    lingerRef.current = lingerRef.current.filter((x) => x.elId !== elId);
    requestOverlayRepaint();
  };

  const commitStroke = async (m: Extract<Mode, { type: 'stroke' }>, isFinal: boolean) => {
    const st = useApp.getState();
    const page = st.editor.pages.find((p) => p.id === m.pageId);
    if (!page) return;
    const doc = await st.ensureDoc(m.pageId);
    const z = doc.elements.reduce((acc, e) => Math.max(acc, e.z), 0) + 1;
    const pts = m.points.length === 1
      ? [{ ...m.points[0], t: 16 }]
      : m.points.map((p, i) => ({ x: p.x, y: p.y, p: p.p, t: i * 16 }));
    const el: StrokeEl = {
      kind: 'stroke', id: uid(), tool: m.tool, color: m.color, width: m.width, points: pts, z,
    };
    // linger the finished ink on the overlay until the page raster paints it
    const outline = computeOutline(m.points, { tool: m.tool, width: m.width, gamma: st.settings.pressureCurve });
    if (outline.length) {
      const p = new Path2D();
      tracePath(p, outline);
      lingerRef.current.push({
        pageY: m.pageY, path: p, color: m.color, hi: m.tool === 'highlighter',
        darkPaper: isDarkPaper(page.backgroundHex), elId: el.id,
      });
      if (lingerRef.current.length > 4) lingerRef.current.shift();
      requestOverlayRepaint();
      requestAnimationFrame(() => requestAnimationFrame(() => clearLinger(el.id)));
      setTimeout(() => clearLinger(el.id), 700);
    }
    st.addElements(m.pageId, [el]);
    if (st.editor.activeRecording) st.noteStrokeTimes(el.id, m.startAbs, m.lastAbs);
    st.pushRecentColor(m.color);
    // infinite page growth
    const nb = st.notebooks.find((n) => n.id === st.editor.notebookId);
    if (nb?.pageSize === 'infinite') {
      const maxY = Math.max(...m.points.map((p) => p.y));
      if (maxY > (page.height ?? 1123) - 140) {
        void st.updatePage(m.pageId, { height: (page.height ?? 1123) + 512 });
      }
    }
    if (!isFinal) {
      // auto-continue: restart the session from the last point
      const last = m.points[m.points.length - 1];
      modeRef.current = {
        ...m, points: [last], startAbs: m.lastAbs, cached: null, cachedUpTo: 0,
      };
    }
  };

  // -------------------------------------------------- pointer handlers
  useEffect(() => {
    const host = hostRef.current!;
    const pointers = pointersRef.current;

    const isPanGesture = (e: PointerEvent) => {
      const st = useApp.getState();
      return (
        st.editor.tool === 'pan' ||
        spaceRef.current ||
        e.button === 1 ||
        (e.pointerType === 'touch' && !canDrawWith(e) && st.editor.tool !== 'lasso' && st.editor.tool !== 'text')
      );
    };

    // ================================================ modern pan physics
    // While a pan gesture / momentum / settle is in flight it OWNS the viewport
    // (global clamp stands down via the gesture guard) and applies:
    //   • axis lock — when a page fits the width the horizontal axis is
    //     pinned dead-center (diagonal swipes can NEVER drift pages sideways);
    //   • elastic bounds — rubber-band overshoot with resistance, capped;
    //   • momentum — release-velocity glide with exponential decay;
    //   • settle — overshoot springs back, flicks land aligned to a page top
    //     when one is near (soft snap), so flipping pages always ends "مرتب".
    const worldHOfLayouts = () => {
      let h = 0;
      for (const l of layouts) { const b = l.y + l.h; if (b > h) h = b }
      return h;
    };

    const resist = (v: number, min: number, max: number) => {
      if (v >= min && v <= max) return v;
      if (v > max) return max + Math.min((v - max) * PAN_RESIST, PAN_OVERSHOOT);
      return min - Math.min((min - v) * PAN_RESIST, PAN_OVERSHOOT);
    };

    /** apply the un-resisted drag offsets with locks + rubber-band */
    const applyPanRaw = (m: PanMode, rawX: number, rawY: number) => {
      const vp = getVp();
      const tx = m.lockX ? m.minX : resist(rawX, m.minX, m.maxX); // minX==maxX==center when locked
      const ty = m.lockY ? m.minY : resist(rawY, m.minY, m.maxY);
      if (tx !== vp.tx || ty !== vp.ty) setVp({ tx, ty });
      return { tx, ty };
    };

    const cancelLocalScroll = () => {
      if (scrollRafRef.current) { cancelAnimationFrame(scrollRafRef.current); scrollRafRef.current = 0 }
      endVpGesture();
    };

    const startPan = (e: PointerEvent, l: { x: number; y: number }) => {
      cancelLocalScroll();               // any in-flight glide ends; the drag owns the viewport
      const vp = getVp();
      const bx = axisBounds(pageW * vp.scale, host.clientWidth);
      const by = axisBounds(worldHOfLayouts() * vp.scale, host.clientHeight);
      beginVpGesture();
      const rawX = Math.min(bx.max, Math.max(bx.min, vp.tx)); // spring into bounds if mid-settle
      const rawY = Math.min(by.max, Math.max(by.min, vp.ty));
      if (rawX !== vp.tx || rawY !== vp.ty) setVp({ tx: rawX, ty: rawY });
      const now = performance.now();
      modeRef.current = {
        type: 'pan', pointerId: e.pointerId, lastX: l.x, lastY: l.y,
        rawX, rawY, lockX: bx.lock, lockY: by.lock,
        minX: bx.min, maxX: bx.max, minY: by.min, maxY: by.max,
        samples: [{ t: now, x: rawX, y: rawY }], lastMoveT: now,
      };
    };

    /** spring back into bounds (+ optional soft page-top snap) and release the guard */
    const settleScroll = (m: PanMode, fromTx: number, fromTy: number, snap: boolean) => {
      const vp = getVp();
      let targetTy = Math.min(m.maxY, Math.max(m.minY, fromTy));
      if (snap && !m.lockY) {
        // align the nearest page top with the top pad when it is close by
        const chH = host.clientHeight;
        let best = targetTy, bestDist = Infinity;
        for (const l of layouts) {
          const tyP = VIEWPORT_PAD - l.y * vp.scale;
          if (tyP < m.minY - 1 || tyP > m.maxY + 1) continue; // not reachable
          const d = Math.abs(tyP - fromTy);
          if (d < bestDist) { bestDist = d; best = tyP }
        }
        if (bestDist <= chH * 0.25) targetTy = best;
      }
      const targetTx = Math.min(m.maxX, Math.max(m.minX, fromTx));
      animateVpTo({ tx: targetTx, ty: targetTy }, 260, undefined, () => endVpGesture());
    };

    const startMomentum = (m: PanMode, vx0: number, vy0: number) => {
      const myGen = vpAnimGen();
      let vx = vx0, vy = vy0;
      let rawX = m.rawX, rawY = m.rawY;
      let last = performance.now();
      const t0 = last;
      const step = () => {
        const now = performance.now();
        if (vpAnimGen() !== myGen) { scrollRafRef.current = 0; endVpGesture(); return } // jump/zoom took over
        const dt = Math.min(34, now - last);
        last = now;
        const decay = Math.exp(-dt / MOMENTUM_TAU);
        vx *= decay; vy *= decay;
        rawX += vx * dt; rawY += vy * dt;
        const { tx, ty } = applyPanRaw(m, rawX, rawY);
        if (!m.lockX && (tx <= m.minX + 0.5 || tx >= m.maxX - 0.5)) vx = 0; // absorbed at edge
        if (!m.lockY && (ty <= m.minY + 0.5 || ty >= m.maxY - 0.5)) vy = 0;
        if (Math.hypot(vx, vy) < 0.02 || now - t0 > 3200) {
          scrollRafRef.current = 0;
          const cur = getVp();
          settleScroll(m, cur.tx, cur.ty, true);
          return;
        }
        scrollRafRef.current = requestAnimationFrame(step);
      };
      scrollRafRef.current = requestAnimationFrame(step);
    };

    /** called on pan release: flicks glide, overscroll springs back, still releases just end */
    const releasePanScroll = (m: PanMode, pointerType: string) => {
      const cur = getVp();
      const outX = !m.lockX && (cur.tx < m.minX - 0.5 || cur.tx > m.maxX + 0.5);
      const outY = !m.lockY && (cur.ty < m.minY - 0.5 || cur.ty > m.maxY + 0.5);
      let vx = 0, vy = 0;
      const now = performance.now();
      const s = m.samples;
      if (s.length >= 2 && now - m.lastMoveT <= HOLD_STILL_MS) {
        const a = s[0], b = s[s.length - 1];
        const dt = Math.max(1, b.t - a.t);
        vx = (b.x - a.x) / dt;
        vy = (b.y - a.y) / dt;
      }
      if (m.lockX) vx = 0;
      if (m.lockY) vy = 0;
      vx = Math.min(FLICK_MAX_V, Math.max(-FLICK_MAX_V, vx));
      vy = Math.min(FLICK_MAX_V, Math.max(-FLICK_MAX_V, vy));
      const speed = Math.hypot(vx, vy);

      if (pointerType !== 'touch' || (speed < 0.06 && !outX && !outY)) {
        // mouse / pen pans never glide; a still in-bounds touch release just ends
        if (outX || outY) settleScroll(m, cur.tx, cur.ty, false);
        else endVpGesture();
        return;
      }
      if (speed < 0.06) { settleScroll(m, cur.tx, cur.ty, false); return } // stretched: spring back
      startMomentum(m, vx, vy);
    };

    const addStrokePoint = (m: Extract<Mode, { type: 'stroke' }>, ev: PointerEvent, page: PageLayout) => {
      const vp = getVp();
      m.minDist = clamp(0.7 / vp.scale, 0.25, 2.5); // ~0.7 screen px at any zoom
      const l = localPt(ev);
      const world = screenToWorld(l.x, l.y);
      let px = clamp(world.x, -200, pageW + 200);
      let py = world.y - page.y;
      const snapped = snapToRuler(world.x, world.y, 18 / vp.scale);
      if (snapped) { px = snapped.x; py = snapped.y - page.y }
      const p = pressureOf(ev, m.tool);
      m.pSmooth = m.pSmooth + (p - m.pSmooth) * 0.6; // light pressure smoothing for steppy sensors
      if (m.straight) {
        const first = m.points[0];
        m.points = [first, { x: px, y: py, p: m.pSmooth, v: 0.4 }];
        m.lastTs = ev.timeStamp;
        m.lastAbs = performance.now();
        return;
      }
      const last = m.points[m.points.length - 1];
      const d = Math.hypot(px - last.x, py - last.y);
      const dt = Math.max(0.5, ev.timeStamp - m.lastTs);
      if (d >= m.minDist) {
        m.points.push({ x: px, y: py, p: m.pSmooth, v: clamp(d / dt, 0, 5) });
        m.lastTs = ev.timeStamp;
        m.lastAbs = performance.now();
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'pen') penSeenRef.current = performance.now(); // pen contact

      // ---- palm rejection gate (touches only; pens & mice always pass)
      if (e.pointerType === 'touch' && rejectTouch(e)) return;

      const rect = host.getBoundingClientRect();
      pointers.set(e.pointerId, { x: e.clientX - rect.left, y: e.clientY - rect.top, type: e.pointerType });

      if (pointers.size === 2) {
        // second touch → pinch (commit a finger stroke rather than dropping it)
        const m = modeRef.current;
        if (m.type === 'stroke') {
          const a0 = m.points[0];
          const aN = m.points[m.points.length - 1];
          const meaningful = m.points.length > 2 || Math.hypot(aN.x - a0.x, aN.y - a0.y) > 4;
          if (meaningful) void commitStroke(m, true);
          modeRef.current = { type: 'none' };
        }
        if (m.type === 'pan') { modeRef.current = { type: 'none' }; endVpGesture() }
        const [a, b] = [...pointers.entries()].map(([id, p]) => ({ id, ...p }));
        const d0 = Math.hypot(a.x - b.x, a.y - b.y);
        if (d0 > 10) {
          cancelZoomAnim();
          cancelLocalScroll();   // a pinch takes the viewport back from any glide
          const vp = getVp();
          modeRef.current = {
            type: 'pinch', ids: [a.id, b.id], d0, scale0: vp.scale,
            mid0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, tx0: vp.tx, ty0: vp.ty,
          };
          try { host.setPointerCapture(e.pointerId) } catch { /* pointer gone */ }
        }
        return;
      }
      if (pointers.size > 2) return;

      cancelZoomAnim();
      cancelLocalScroll();   // any new pointer input ends an in-flight glide/settle
      hoverRef.current = null;
      const st = useApp.getState();
      const tool = st.editor.tool;
      downInfoRef.current = { x: e.clientX, y: e.clientY, t: performance.now() };
      try { host.setPointerCapture(e.pointerId) } catch { /* pointer already gone */ }
      activeTypeRef.current = e.pointerType;

      if (isPanGesture(e)) {
        startPan(e, localPt(e));
        return;
      }

      const world = worldFromEvent(e);
      const page = pageForWorld(world.y);
      if (!page) {
        startPan(e, localPt(e));
        return;
      }
      const stEd = st.editor;
      void st.ensureDoc(page.id);
      st.setActivePage(page.id);

      const pagePt = { x: clamp(world.x, 0, pageW), y: clamp(world.y - page.y, 0, page.h) };

      if (tool === 'eraser') {
        modeRef.current = {
          type: 'erase', pointerId: e.pointerId, pageId: page.id, pageY: page.y,
          path: [pagePt], removed: new Set(), lastScreen: localPt(e),
        };
        requestOverlayRepaint();
        return;
      }

      if (tool === 'lasso') {
        modeRef.current = {
          type: 'lasso', pointerId: e.pointerId, pageId: page.id, pageY: page.y,
          poly: [{ x: world.x, y: world.y }],
        };
        requestOverlayRepaint();
        return;
      }

      if (tool === 'text') {
        modeRef.current = { type: 'none' };
        return; // taps resolved on pointerup
      }

      if (tool === 'shape') {
        modeRef.current = {
          type: 'shape', pointerId: e.pointerId, pageId: page.id, pageY: page.y,
          ax: pagePt.x, ay: pagePt.y, bx: pagePt.x, by: pagePt.y,
        };
        requestOverlayRepaint();
        return;
      }

      // pens + highlighter
      const ts = stEd.toolStates[tool as ToolId] ?? stEd.toolStates.fountain;
      const straight =
        e.shiftKey ||
        (tool === 'highlighter' && stEd.highlighterStraight);
      const snapped = snapToRuler(world.x, world.y, 18 / getVp().scale) ?? null;
      const p0 = pressureOf(e, tool as ToolId);
      modeRef.current = {
        type: 'stroke', pointerId: e.pointerId, pageId: page.id, pageY: page.y,
        points: [{
          x: snapped ? snapped.x : pagePt.x,
          y: snapped ? snapped.y - page.y : pagePt.y,
          p: p0, v: 0.4,
        }],
        tool: tool as ToolId, color: ts.color, width: ts.width,
        startAbs: performance.now(), lastAbs: performance.now(), lastTs: e.timeStamp,
        minDist: clamp(0.7 / getVp().scale, 0.25, 2.5), pSmooth: p0,
        straight, cached: null, cachedUpTo: 0,
      };
      requestOverlayRepaint();
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'pen') penSeenRef.current = performance.now(); // hover keeps the pen "in range"
      const rect = host.getBoundingClientRect();
      const l = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const known = pointers.get(e.pointerId);
      if (known) pointers.set(e.pointerId, { ...known, ...l });
      const m = modeRef.current;

      // pen hover cursor when idle
      if (m.type === 'none' && e.pointerType === 'pen') {
        hoverRef.current = { x: l.x, y: l.y };
        requestOverlayRepaint();
      }

      if (m.type === 'pinch') {
        const a = pointers.get(m.ids[0]);
        const b = pointers.get(m.ids[1]);
        if (!a || !b) return;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const scale = clampScale(m.scale0 * (d / m.d0));
        const wx = (m.mid0.x - m.tx0) / m.scale0;
        const wy = (m.mid0.y - m.ty0) / m.scale0;
        setVp({ scale, tx: mid.x - wx * scale, ty: mid.y - wy * scale });
        return;
      }

      if (m.type === 'pan') {
        if (e.pointerId !== m.pointerId) return;
        const dx = l.x - m.lastX, dy = l.y - m.lastY;
        m.lastX = l.x; m.lastY = l.y;
        m.rawX += dx; m.rawY += dy;
        const now = performance.now();
        m.samples.push({ t: now, x: m.rawX, y: m.rawY });
        while (m.samples.length > 2 && now - m.samples[0].t > SAMPLE_WINDOW) m.samples.shift();
        m.lastMoveT = now;
        applyPanRaw(m, m.rawX, m.rawY);
        return;
      }

      if (m.type === 'stroke' && e.pointerId === m.pointerId) {
        const page = layouts.find((p) => p.id === m.pageId);
        if (!page) return;
        for (const ev of coalescedOf(e)) addStrokePoint(m, ev, page);
        if (m.points.length >= AUTO_CONTINUE_PTS) {
          void commitStroke(m, false);
        }
        requestOverlayRepaint();
        return;
      }

      if (m.type === 'erase' && e.pointerId === m.pointerId) {
        const st = useApp.getState();
        const vp = getVp();
        const page = layouts.find((p) => p.id === m.pageId);
        if (!page) return;
        for (const ev of coalescedOf(e)) {
          const el = localPt(ev);
          const world = screenToWorld(el.x, el.y);
          const pagePt = { x: clamp(world.x, 0, pageW), y: clamp(world.y - page.y, 0, page.h) };
          m.path.push(pagePt);
          m.lastScreen = el;
          const doc = st.editor.docs[m.pageId];
          if (doc) {
            const r = st.editor.eraser.size / 2 / vp.scale;
            const removed = m.removed;
            for (const el2 of doc.elements) {
              if (removed.has(el2.id)) continue;
              if (st.editor.eraser.mode === 'stroke') {
                if (el2.kind === 'stroke' && strokeIntersectsCircle(el2, pagePt.x, pagePt.y, r)) removed.add(el2.id);
              } else {
                if (el2.kind === 'stroke') {
                  if (strokeErasedByArea(el2, m.path, r)) removed.add(el2.id);
                } else {
                  for (let i = 0; i < m.path.length; i += 2) {
                    if (elementIntersectsCircle(el2, m.path[i].x, m.path[i].y, r)) { removed.add(el2.id); break }
                  }
                }
              }
            }
            setHiddenIds(m.pageId, new Set(removed));
          }
        }
        requestOverlayRepaint();
        return;
      }

      if (m.type === 'lasso' && e.pointerId === m.pointerId) {
        for (const ev of coalescedOf(e)) {
          const el = localPt(ev);
          const world = screenToWorld(el.x, el.y);
          m.poly.push({ x: world.x, y: world.y });
        }
        requestOverlayRepaint();
        return;
      }

      if (m.type === 'shape' && e.pointerId === m.pointerId) {
        const world = screenToWorld(l.x, l.y);
        const page = layouts.find((p) => p.id === m.pageId);
        if (!page) return;
        let bx = clamp(world.x, 0, pageW);
        let by = clamp(world.y - page.y, 0, page.h);
        const st = useApp.getState();
        const shape = st.editor.shape.type;
        if (shape === 'line' || shape === 'arrow') {
          const s = snapAngle(m.ax, m.ay, bx, by, 5);
          bx = s.x; by = s.y;
        } else if (e.shiftKey) {
          const dx = bx - m.ax, dy = by - m.ay;
          const size = Math.max(Math.abs(dx), Math.abs(dy));
          m.bx = m.ax + Math.sign(dx || 1) * size;
          m.by = m.ay + Math.sign(dy || 1) * size;
          requestOverlayRepaint();
          return;
        }
        m.bx = bx; m.by = by;
        requestOverlayRepaint();
        return;
      }
    };

    const tryDoubleTap = (e: PointerEvent) => {
      const last = lastTapRef.current;
      const now = performance.now();
      if (last && now - last.t < 320 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 28) {
        const vp = getVp();
        const l = localPt(e);
        animateZoomTo(l.x, l.y, vp.scale > 1.4 ? 1 : 2.5, 260);
        lastTapRef.current = null;
      } else {
        lastTapRef.current = { t: now, x: e.clientX, y: e.clientY };
      }
    };

    const finishGesture = (e: PointerEvent) => {
      const m = modeRef.current;
      const known = pointers.has(e.pointerId); // rejected (palm) pointers were never tracked
      pointers.delete(e.pointerId);
      const st = useApp.getState();

      if (m.type === 'pinch') {
        if (m.ids.includes(e.pointerId)) modeRef.current = { type: 'none' };
        return;
      }
      const down = downInfoRef.current;
      const dist = down ? Math.hypot(e.clientX - down.x, e.clientY - down.y) : 99;
      const quick = down && dist < 7 && performance.now() - down.t < 420;

      if (m.type === 'pan' && e.pointerId === m.pointerId) {
        modeRef.current = { type: 'none' };
        activeTypeRef.current = null;
        // a clean finger tap while navigating = double-tap zoom candidate
        if (known && quick && e.pointerType === 'touch') tryDoubleTap(e);
        releasePanScroll(m, e.pointerType);
        return;
      }
      if (m.type === 'stroke' && e.pointerId === m.pointerId) {
        void commitStroke(m, true);
        modeRef.current = { type: 'none' };
        activeTypeRef.current = null;
        requestOverlayRepaint();
        return;
      }
      if (m.type === 'erase' && e.pointerId === m.pointerId) {
        if (m.removed.size) st.removeElements(m.pageId, [...m.removed]);
        setHiddenIds(m.pageId, null);
        modeRef.current = { type: 'none' };
        activeTypeRef.current = null;
        requestOverlayRepaint();
        return;
      }
      if (m.type === 'lasso' && e.pointerId === m.pointerId) {
        if (m.poly.length > 6) {
          const doc = st.editor.docs[m.pageId];
          if (doc) {
            const pagePoly = m.poly.map((p) => ({ x: p.x, y: p.y - m.pageY }));
            const ids = doc.elements.filter((el) => elementInLasso(el, pagePoly)).map((el) => el.id);
            st.setSelection(ids.length ? { pageId: m.pageId, ids } : null);
            if (ids.length) st.setTool('lasso');
          }
        } else {
          st.setSelection(null);
        }
        modeRef.current = { type: 'none' };
        activeTypeRef.current = null;
        requestOverlayRepaint();
        return;
      }
      if (m.type === 'shape' && e.pointerId === m.pointerId) {
        const w = m.bx - m.ax, h = m.by - m.ay;
        const isLine = st.editor.shape.type === 'line' || st.editor.shape.type === 'arrow';
        if (Math.hypot(w, h) > (isLine ? 4 : 8)) {
          const shape = st.editor.shape;
          void st.ensureDoc(m.pageId).then((doc) => {
            const z = doc.elements.reduce((acc, el) => Math.max(acc, el.z), 0) + 1;
            st.addElements(m.pageId, [{
              kind: 'shape', id: uid(), shape: shape.type,
              x: m.ax, y: m.ay, w, h,
              stroke: shape.color, strokeWidth: shape.width,
              fill: shape.filled ? shape.color : null, z,
            }]);
          });
        }
        modeRef.current = { type: 'none' };
        activeTypeRef.current = null;
        requestOverlayRepaint();
        return;
      }

      // text taps (mode was 'none')
      const tool = st.editor.tool;
      if (known && quick && tool === 'text') {
        const world = worldFromEvent(e);
        const page = pageForWorld(world.y);
        if (page) {
          void st.ensureDoc(page.id).then((doc) => {
            const pt = { x: world.x, y: world.y - page.y };
            let existing: TextEl | null = null;
            // hit-test text boxes (approximate heights)
            for (const el of doc.elements) {
              if (el.kind !== 'text') continue;
              const lines = el.text.split('\n').length || 1;
              const h = lines * el.size * 1.35;
              if (pt.x >= el.x - 6 && pt.x <= el.x + el.w + 6 && pt.y >= el.y - 6 && pt.y <= el.y + h + 8) {
                existing = el;
                break;
              }
            }
            onTextTap(page.id, pt, existing);
          });
        }
        return;
      }
      if (known && quick && e.pointerType === 'touch') tryDoubleTap(e);
    };

    const onPointerUp = (e: PointerEvent) => { finishGesture(e) };
    const onPointerCancel = (e: PointerEvent) => {
      const m = modeRef.current;
      if (m.type === 'stroke' && e.pointerId === m.pointerId) { modeRef.current = { type: 'none' }; activeTypeRef.current = null; requestOverlayRepaint() }
      if (m.type === 'erase' && e.pointerId === m.pointerId) { setHiddenIds(m.pageId, null); modeRef.current = { type: 'none' }; activeTypeRef.current = null }
      if (m.type === 'lasso' && e.pointerId === m.pointerId) { modeRef.current = { type: 'none' }; activeTypeRef.current = null }
      if (m.type === 'shape' && e.pointerId === m.pointerId) { modeRef.current = { type: 'none' }; activeTypeRef.current = null }
      if (m.type === 'pan' && e.pointerId === m.pointerId) {
        modeRef.current = { type: 'none' };
        activeTypeRef.current = null;
        const cur = getVp();
        const out = (!m.lockX && (cur.tx < m.minX - 0.5 || cur.tx > m.maxX + 0.5)) ||
                    (!m.lockY && (cur.ty < m.minY - 0.5 || cur.ty > m.maxY + 0.5));
        if (out) settleScroll(m, cur.tx, cur.ty, false); else endVpGesture();
      }
      if (m.type === 'pinch') modeRef.current = { type: 'none' };
      pointers.delete(e.pointerId);
    };

    const onPointerLeave = (e: PointerEvent) => {
      if (e.pointerType === 'pen' && hoverRef.current) {
        hoverRef.current = null;
        requestOverlayRepaint();
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cancelLocalScroll();   // wheel takes over from any touch glide
      const rect = host.getBoundingClientRect();
      const l = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      if (e.ctrlKey || e.metaKey) {
        // pinch-trackpad / ctrl+wheel zoom — normalize wheel units, clamp per-event jump
        const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? Math.max(240, rect.height) : 1;
        const dy = e.deltaY * unit;
        const factor = clamp(Math.exp(-dy * 0.0022), 0.75, 1.33);
        zoomAt(l.x, l.y, factor);
      } else if (e.shiftKey && e.deltaX === 0) {
        const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? Math.max(240, rect.height) : 1;
        panBy(-e.deltaY * unit, 0);
      } else {
        const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? Math.max(240, rect.height) : 1;
        panBy(-e.deltaX * unit, -e.deltaY * unit);
      }
    };

    const onContext = (e: Event) => { e.preventDefault() }; // pen barrel button / long-press
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceRef.current = e.type === 'keydown';
    };
    const onBlurWin = () => { spaceRef.current = false };

    host.addEventListener('pointerdown', onPointerDown);
    host.addEventListener('pointermove', onPointerMove);
    host.addEventListener('pointerup', onPointerUp);
    host.addEventListener('pointercancel', onPointerCancel);
    host.addEventListener('pointerleave', onPointerLeave);
    host.addEventListener('wheel', onWheel, { passive: false });
    host.addEventListener('contextmenu', onContext);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', onBlurWin);
    return () => {
      cancelLocalScroll();
      host.removeEventListener('pointerdown', onPointerDown);
      host.removeEventListener('pointermove', onPointerMove);
      host.removeEventListener('pointerup', onPointerUp);
      host.removeEventListener('pointercancel', onPointerCancel);
      host.removeEventListener('pointerleave', onPointerLeave);
      host.removeEventListener('wheel', onWheel);
      host.removeEventListener('contextmenu', onContext);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', onBlurWin);
    };
  }, [layouts, pageW, onTextTap]);

  return (
    <div
      ref={hostRef}
      className="absolute inset-0 z-10 touch-none select-none"
      style={{ cursor: useApp((s) => s.editor.tool) === 'pan' ? 'grab' : 'crosshair' }}
      role="application"
      aria-label={t('app.name')}
    />
  );
}
