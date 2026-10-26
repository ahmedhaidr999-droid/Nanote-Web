'use client';
// SelectionLayer — dashed selection box + transform handles + action bar for the
// lasso selection. Drags (move/scale/rotate) preview on the live overlay and
// commit as a single undoable command.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Scissors, ClipboardPaste, Trash2, CopyPlus, Palette, X, RotateCw, RotateCcw, FlipHorizontal, FlipVertical, BringToFront, SendToBack, Image as ImageIcon, Squircle, Crop, Check } from 'lucide-react';
import { toast } from 'sonner';
import { useApp, useT } from '@/lib/nanote/store';
import { PageElement, PageDoc, TextEl, ImageEl } from '@/lib/nanote/types';
import { drawStroke, drawText, drawShape, drawImageEl } from '@/lib/nanote/render';
import { resolveImage, imageNatural } from '@/lib/nanote/images';
import { elementBBox, imageLocalPoint, resizeImageCorner, transformElement, unionBBox } from '@/lib/nanote/geometry';
import { cn } from '@/lib/utils';
import { Slider } from '@/components/ui/slider';
import {
  Painter, addPainter, getVp, useVp, worldToScreen, setHiddenIds,
  requestOverlayRepaint, requestRepaint, type PageLayout,
} from './viewport';
import { ColorPopover } from './ColorPopover';

type Drag =
  | { kind: 'move'; startWorld: { x: number; y: number }; dx: number; dy: number }
  | { kind: 'resize'; corner: 'nw' | 'ne' | 'sw' | 'se'; startWorld: { x: number; y: number }; startBBox: { x0: number; y0: number; x1: number; y1: number }; sx: number; sy: number; startEl: ImageEl | null; previewEl: ImageEl | null }
  | { kind: 'rotate'; startAngle: number; rotation: number }
  | null;

/** crop window in IMAGE-LOCAL coordinates (top-left based, 0..el.w × 0..el.h) */
interface CropRect { x0: number; y0: number; x1: number; y1: number }

export function SelectionLayer({
  layouts,
  pageW,
}: {
  layouts: PageLayout[];
  pageW: number;
}) {
  const vp = useVp();
  const selection = useApp((s) => s.editor.selection);
  const tool = useApp((s) => s.editor.tool);
  const clipboard = useApp((s) => s.editor.clipboard);
  const doc = useApp((s) => (s.editor.selection ? s.editor.docs[s.editor.selection.pageId] : undefined));
  const gamma = useApp((s) => s.settings.pressureCurve);
  const { t } = useT();
  const dragRef = useRef<Drag>(null);
  const [recolorOpen, setRecolorOpen] = useState(false);
  const [cornersOpen, setCornersOpen] = useState(false);
  const cornerPreviewRef = useRef<number | null>(null); // live slider preview radius
  const cornerPageRef = useRef<string | null>(null);   // page whose ids are hidden for the preview
  const cornersAnchorRef = useRef<HTMLDivElement>(null); // toggle button wrapper (outside-click ignore)
  const [imgOptsOpen, setImgOptsOpen] = useState(false);
  const [cropState, setCropState] = useState<{ forId: string; rect: CropRect } | null>(null);
  const imgOptsAnchorRef = useRef<HTMLDivElement>(null); // toggle button wrapper (outside-click ignore)

  const activePageLayout = useMemo(
    () => layouts.find((l) => l.id === selection?.pageId) ?? null,
    [layouts, selection],
  );

  const selectedEls = useMemo(() => {
    if (!selection || !doc) return [];
    return doc.elements.filter((e) => selection.ids.includes(e.id));
  }, [selection, doc]);

  const bbox = useMemo(() => {
    if (!selectedEls.length) return null;
    return unionBBox(selectedEls.map((e) => elementBBox(e, 6)));
  }, [selectedEls]);

  // hide originals + paint moved copies while dragging; live-preview the
  // corner-radius slider on a selected image (same hidden-ids mechanism)
  useEffect(() => {
    const painter: Painter = (ctx, v) => {
      const drag = dragRef.current;
      const preview = cornerPreviewRef.current;
      if ((!drag && preview == null) || !selection || !doc) return;
      const layout = layouts.find((l) => l.id === selection.pageId);
      if (!layout) return;
      ctx.save();
      ctx.translate(v.tx, layout.y * v.scale + v.ty);
      ctx.scale(v.scale, v.scale);
      const els = doc.elements.filter((e) => selection.ids.includes(e.id));
      if (drag) {
        for (const el of els) {
          if (drag.kind === 'move') {
            const moved = transformElement(el, { dx: drag.dx, dy: drag.dy });
            drawTransformed(ctx, moved, gamma);
          } else if (drag.kind === 'resize') {
            if (drag.previewEl && el.kind === 'image') {
              drawTransformed(ctx, drag.previewEl, gamma); // exact rotated resize preview
            } else {
              const moved = transformElement(el, {
                sx: drag.sx, sy: drag.sy,
                ox: drag.startBBox.x0, oy: drag.startBBox.y0,
              });
              drawTransformed(ctx, moved, gamma);
            }
          } else if (drag.kind === 'rotate') {
            if (el.kind === 'image' && selectedEls.length === 1) {
              drawTransformed(ctx, { ...el, rotation: drag.rotation }, gamma);
            } else {
              drawTransformed(ctx, el, gamma);
            }
          }
        }
      } else if (preview != null && els.length === 1 && els[0].kind === 'image') {
        drawTransformed(ctx, { ...(els[0] as ImageEl), cornerRadius: preview }, gamma);
      }
      ctx.restore();
    };
    return addPainter(painter);
  }, [selection, doc, gamma, layouts, selectedEls]);

  /** live-preview a corner radius: hide the committed image, paint the preview */
  const previewCorners = (radius: number | null) => {
    if (radius != null) {
      const sel = useApp.getState().editor.selection;
      if (!sel) return;
      cornerPreviewRef.current = radius;
      cornerPageRef.current = sel.pageId;
      setHiddenIds(sel.pageId, new Set(sel.ids));
    } else {
      cornerPreviewRef.current = null;
      const pg = cornerPageRef.current;
      cornerPageRef.current = null;
      if (pg) setHiddenIds(pg, null);
    }
  };

  /** commit a corner-radius change as ONE undoable command (before/after) */
  const commitCorners = (radius: number) => {
    const sel = useApp.getState().editor.selection;
    if (!sel) return;
    const st = useApp.getState();
    const doc = st.editor.docs[sel.pageId];
    const el = doc?.elements.find((x) => x.id === sel.ids[0]);
    if (!el || el.kind !== 'image' || (el.cornerRadius ?? 0) === radius) return;
    st.patchElements(sel.pageId, [{ id: el.id, before: el, after: { ...el, cornerRadius: radius } }], 'corners');
  };

  const isImageOnly = selectedEls.length === 1 && selectedEls[0].kind === 'image';
  const interactive = tool === 'lasso' || tool === 'image';


  // ---------------------------------------------------------------- crop session
  const startCrop = () => {
    if (!imgEl) return;
    setImgOptsOpen(false);
    setCornersOpen(false);
    setCropState({ forId: imgEl.id, rect: { x0: 0, y0: 0, x1: imgEl.w, y1: imgEl.h } });
  };

  const dragCropCorner = (e: React.PointerEvent, corner: 'nw' | 'ne' | 'sw' | 'se') => {
    if (!imgEl || !cropRect || !activePageLayout) return;
    e.stopPropagation();
    try { (e.target as HTMLElement).setPointerCapture(e.pointerId) } catch { /* pointer gone */ }
    const host = (e.currentTarget as HTMLElement).closest('[data-viewport]') as HTMLElement;
    const rect = host.getBoundingClientRect();
    const minW = Math.max(12, imgEl.w * 0.04);
    const minH = Math.max(12, imgEl.h * 0.04);
    const onMove = (ev: PointerEvent) => {
      const v = getVp();
      const px = ev.clientX - rect.left, py = ev.clientY - rect.top;
      const world = { x: (px - v.tx) / v.scale, y: (py - v.ty) / v.scale };
      // world → image-local (image coords are PAGE-LOCAL: shift world y by the page origin)
      const lp = imageLocalPoint(imgEl, world.x, world.y - activePageLayout.y);
      const lx = lp.x + imgEl.w / 2;
      const ly = lp.y + imgEl.h / 2;
      setCropState((cs) => {
        const r = cs && cs.forId === imgEl.id ? cs.rect : null;
        if (!r || !cs) return cs;
        let { x0, y0, x1, y1 } = r;
        if (corner === 'nw' || corner === 'sw') x0 = Math.min(Math.max(0, lx), x1 - minW);
        else x1 = Math.max(Math.min(imgEl.w, lx), x0 + minW);
        if (corner === 'nw' || corner === 'ne') y0 = Math.min(Math.max(0, ly), y1 - minH);
        else y1 = Math.max(Math.min(imgEl.h, ly), y0 + minH);
        return { forId: cs.forId, rect: { x0, y0, x1, y1 } };
      });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  /** Apply the crop window: the visible region becomes the image's new bounds
   * (a normalized source-rect `crop` on the element — undoable, lossless). */
  const applyCrop = () => {
    if (!imgEl || !cropRect || !selection) return;
    const nat = imageNatural(imgEl.imageId) ?? { w: imgEl.w, h: imgEl.h };
    // current source window (existing crop or the whole bitmap)
    let s0 = 0, s1 = nat.w, t0 = 0, t1 = nat.h;
    if (imgEl.crop) {
      s0 = imgEl.crop.x * nat.w; t0 = imgEl.crop.y * nat.h;
      s1 = s0 + imgEl.crop.w * nat.w; t1 = t0 + imgEl.crop.h * nat.h;
    }
    const sw = Math.max(1, s1 - s0), sh = Math.max(1, t1 - t0);
    // cover-fit transform of the source window into the element box
    const s = Math.max(Math.abs(imgEl.w) / sw, Math.abs(imgEl.h) / sh);
    const ox = (Math.abs(imgEl.w) - sw * s) / 2;
    const oy = (Math.abs(imgEl.h) - sh * s) / 2;
    // element-local crop window → natural source pixels
    const su0 = s0 + (cropRect.x0 - ox) / s, su1 = s0 + (cropRect.x1 - ox) / s;
    const sv0 = t0 + (cropRect.y0 - oy) / s, sv1 = t0 + (cropRect.y1 - oy) / s;
    // new element box = the world-space rect of the local crop window
    const newW = Math.max(1, cropRect.x1 - cropRect.x0);
    const newH = Math.max(1, cropRect.y1 - cropRect.y0);
    const cx = imgEl.x + imgEl.w / 2, cy = imgEl.y + imgEl.h / 2;
    const midX = (cropRect.x0 + cropRect.x1) / 2 - imgEl.w / 2;
    const midY = (cropRect.y0 + cropRect.y1) / 2 - imgEl.h / 2;
    const cos = Math.cos(imgEl.rotation), sin = Math.sin(imgEl.rotation);
    const ncx = cx + midX * cos - midY * sin;
    const ncy = cy + midX * sin + midY * cos;
    const after: ImageEl = {
      ...imgEl,
      x: ncx - newW / 2, y: ncy - newH / 2, w: newW, h: newH,
      crop: {
        x: Math.max(0, su0 / nat.w),
        y: Math.max(0, sv0 / nat.h),
        w: Math.min(1, (su1 - su0) / nat.w),
        h: Math.min(1, (sv1 - sv0) / nat.h),
      },
    };
    if (after.crop!.x <= 0.001 && after.crop!.y <= 0.001 && after.crop!.w >= 0.999 && after.crop!.h >= 0.999) {
      delete after.crop; // degenerate full-frame crop → drop the field
    }
    useApp.getState().patchElements(selection.pageId, [{ id: imgEl.id, before: imgEl, after }], 'image');
    setCropState(null);
    requestRepaint();
    toast.success(t('tool.image.crop.done', 'Cropped', 'تم القص'));
  };

  // ---------------------------------------------------------------- drag handling
  const startDrag = (e: React.PointerEvent, kind: 'move' | 'resize' | 'rotate', corner?: 'nw' | 'ne' | 'sw' | 'se') => {
    if (!selection || !bbox || !activePageLayout) return;
    if (cropping && kind !== 'move') return; // the crop session owns the gestures
    e.stopPropagation();
    try { (e.target as HTMLElement).setPointerCapture(e.pointerId) } catch { /* pointer gone */ }
    const host = (e.currentTarget as HTMLElement).closest('[data-viewport]') as HTMLElement;
    const rect = host.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const world = { x: (sx - vp.tx) / vp.scale, y: (sy - vp.ty) / vp.scale };
    const startEl = kind === 'resize' && singleImage && imgEl ? imgEl : null;
    if (kind === 'move') dragRef.current = { kind: 'move', startWorld: world, dx: 0, dy: 0 };
    if (kind === 'resize' && corner) dragRef.current = { kind: 'resize', corner, startWorld: world, startBBox: bbox, sx: 1, sy: 1, startEl, previewEl: startEl };
    if (kind === 'rotate') {
      const img = selectedEls[0] as Extract<PageElement, { kind: 'image' }>;
      const cx = img.x + img.w / 2, cy = img.y + img.h / 2;
      dragRef.current = { kind: 'rotate', startAngle: Math.atan2(world.y - cy, world.x - cx) - img.rotation, rotation: img.rotation };
    }
    setHiddenIds(selection.pageId, new Set(selection.ids));

    const onMove = (ev: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const v = getVp(); // live viewport — never a stale snapshot mid-gesture
      const px = ev.clientX - rect.left, py = ev.clientY - rect.top;
      const w = { x: (px - v.tx) / v.scale, y: (py - v.ty) / v.scale };
      if (drag.kind === 'move') {
        drag.dx = w.x - drag.startWorld.x;
        drag.dy = w.y - drag.startWorld.y;
      } else if (drag.kind === 'resize') {
        if (drag.startEl) {
          // single image: exact corner-anchored, rotation-aware, aspect-locked
          // by default (Shift = free), clamped to min/max side bounds — the
          // opposite corner stays GLUED to the screen (the old AABB scaling
          // visibly swam rotated images around)
          drag.previewEl = resizeImageCorner(drag.startEl, drag.corner, w, { free: ev.shiftKey });
        }
        const b = drag.startBBox;
        const wSpan = Math.max(8, b.x1 - b.x0);
        const hSpan = Math.max(8, b.y1 - b.y0);
        let sx = drag.corner === 'nw' || drag.corner === 'sw'
          ? (b.x1 - w.x) / wSpan
          : (w.x - b.x0) / wSpan;
        let sy = drag.corner === 'nw' || drag.corner === 'ne'
          ? (b.y1 - w.y) / hSpan
          : (w.y - b.y0) / hSpan;
        if (ev.shiftKey) { const u = (Math.abs(sx) + Math.abs(sy)) / 2; sx = Math.sign(sx) * u; sy = Math.sign(sy) * u }
        drag.sx = Math.max(0.05, sx);
        drag.sy = Math.max(0.05, sy);
      } else if (drag.kind === 'rotate') {
        const img = selectedEls[0] as Extract<PageElement, { kind: 'image' }>;
        const cx = img.x + img.w / 2, cy = img.y + img.h / 2;
        let rot = Math.atan2(w.y - cy, w.x - cx) - drag.startAngle;
        if (ev.shiftKey) rot = Math.round(rot / (Math.PI / 12)) * (Math.PI / 12); // 15° snapping
        drag.rotation = rot;
      }
      requestOverlayRepaint();
    };
    const onUp = () => {
      const drag = dragRef.current;
      dragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (!drag || !selection || !doc) { setHiddenIds(selection?.pageId ?? '', null); return }
      const els = doc.elements.filter((el) => selection.ids.includes(el.id));
      const changed =
        (drag.kind === 'move' && (Math.abs(drag.dx) > 0.5 || Math.abs(drag.dy) > 0.5)) ||
        (drag.kind === 'resize' && (drag.previewEl
          ? (drag.previewEl.w !== drag.startEl!.w || drag.previewEl.h !== drag.startEl!.h || drag.previewEl.x !== drag.startEl!.x || drag.previewEl.y !== drag.startEl!.y)
          : (Math.abs(drag.sx - 1) > 0.01 || Math.abs(drag.sy - 1) > 0.01))) ||
        (drag.kind === 'rotate');
      if (!changed) { setHiddenIds(selection.pageId, null); requestRepaint(); return }
      const patches = els.map((el) => {
        let after: PageElement;
        if (drag.kind === 'move') after = transformElement(el, { dx: drag.dx, dy: drag.dy });
        else if (drag.kind === 'resize') {
          if (drag.previewEl && el.kind === 'image') after = drag.previewEl as PageElement;
          else after = transformElement(el, { sx: drag.sx, sy: drag.sy, ox: drag.startBBox.x0, oy: drag.startBBox.y0 });
        }
        else after = { ...el } as PageElement;
        if (drag.kind === 'rotate' && el.kind === 'image') {
          after = { ...(after as Extract<PageElement, { kind: 'image' }>), rotation: drag.rotation } as PageElement;
        }
        return { id: el.id, before: el, after };
      });
      useApp.getState().patchElements(selection.pageId, patches, drag.kind);
      setHiddenIds(selection.pageId, null);
      requestRepaint();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  if (!selection || !bbox || !activePageLayout) return null;

  const tl = worldToScreen(bbox.x0, activePageLayout.y + bbox.y0);
  const br = worldToScreen(bbox.x1, activePageLayout.y + bbox.y1);
  const boxW = br.x - tl.x, boxH = br.y - tl.y;
  const singleImage = selectedEls.length === 1 && selectedEls[0].kind === 'image';
  const imgEl = singleImage ? (selectedEls[0] as Extract<PageElement, { kind: 'image' }>) : null;
  const rotC = imgEl ? worldToScreen(imgEl.x + imgEl.w / 2, activePageLayout.y + imgEl.y + imgEl.h / 2) : null;
  const rotHandle = imgEl && rotC
    ? { x: rotC.x + Math.cos(imgEl.rotation) * (boxH / 2 + 34), y: rotC.y + Math.sin(imgEl.rotation) * (boxH / 2 + 34) }
    : null;

  // the crop session belongs to ONE image id — selecting anything else ends it
  const cropRect = cropState && imgEl && cropState.forId === imgEl.id ? cropState.rect : null;
  const cropping = !!cropRect && !!imgEl;

  const barTop = tl.y - 52 < 8 ? br.y + 12 : tl.y - 52;

  // ---- crop overlay (rotated frame riding the image, dim outside the window)
  const cropOverlay = (() => {
    if (!cropping || !imgEl || !cropRect || !rotC) return null;
    const sc = vp.scale;
    const imgW = imgEl.w * sc, imgH = imgEl.h * sc;
    const cw = (cropRect.x1 - cropRect.x0) * sc;
    const ch = (cropRect.y1 - cropRect.y0) * sc;
    const cx0 = cropRect.x0 * sc, cy0 = cropRect.y0 * sc;
    const cornerAt = (c: 'nw' | 'ne' | 'sw' | 'se') => ({
      left: (c === 'nw' || c === 'sw' ? cx0 : cx0 + cw) - 14,
      top: (c === 'nw' || c === 'ne' ? cy0 : cy0 + ch) - 14,
    });
    return (
      <div
        className="absolute z-20"
        style={{
          left: rotC.x, top: rotC.y,
          width: 0, height: 0,
          transform: `rotate(${imgEl.rotation}rad)`,
          pointerEvents: 'none',
        }}
        aria-label={t('tool.image.crop', 'Crop image', 'قص الصورة')}
      >
        {/* dim everything outside the crop window (huge box-shadow = the hole) */}
        <div
          className="absolute bg-transparent"
          style={{
            left: -imgW / 2 + cx0, top: -imgH / 2 + cy0, width: Math.max(4, cw), height: Math.max(4, ch),
            boxShadow: '0 0 0 9999px rgba(9,14,26,0.45)',
            border: '1.6px solid #1E6FF2',
            pointerEvents: 'none',
          }}
        />
        {/* rule-of-thirds grid */}
        <div className="absolute" style={{ left: -imgW / 2 + cx0, top: -imgH / 2 + cy0, width: cw, height: ch, pointerEvents: 'none' }}>
          <div className="absolute top-0 bottom-0 w-px bg-white/25" style={{ left: cw / 3 }} />
          <div className="absolute top-0 bottom-0 w-px bg-white/25" style={{ left: (2 * cw) / 3 }} />
          <div className="absolute left-0 right-0 h-px bg-white/25" style={{ top: ch / 3 }} />
          <div className="absolute left-0 right-0 h-px bg-white/25" style={{ top: (2 * ch) / 3 }} />
        </div>
        {/* corner handles (drag to frame the crop) */}
        {(['nw', 'ne', 'sw', 'se'] as const).map((c) => {
          const pos = cornerAt(c);
          return (
            <div
              key={c}
              role="button"
              tabIndex={0}
              aria-label={`${t('tool.image.crop', 'Crop image', 'قص الصورة')} · ${c}`}
              className="absolute h-7 w-7 rounded-full border-2 border-white bg-primary shadow-ink-1"
              style={{ left: pos.left, top: pos.top, pointerEvents: 'auto', cursor: `${c}-resize`, touchAction: 'none' }}
              onPointerDown={(e) => dragCropCorner(e, c)}
            />
          );
        })}
      </div>
    );
  })();

  return (
    <>
      {/* crop Apply/Cancel bar (replaces the normal bar during a crop session) */}
      {cropping ? (
        <div
          className="absolute z-40 flex items-center gap-1 rounded-full border border-border bg-card/95 p-1 shadow-ink-2 backdrop-blur"
          style={{ left: Math.max(8, Math.min(tl.x, window.innerWidth - 260)), top: Math.max(8, barTop), pointerEvents: 'auto' }}
          dir="ltr"
          role="toolbar"
          aria-label={t('tool.image.crop', 'Crop image', 'قص الصورة')}
        >
          <span className="px-2 text-xs font-medium text-muted-foreground">{t('tool.image.crop', 'Crop image', 'قص الصورة')}</span>
          <SBtn label={t('common.cancel')} onClick={() => setCropState(null)}><X className="h-4 w-4 text-destructive" /></SBtn>
          <SBtn label={t('common.apply', 'Apply', 'تطبيق')} onClick={applyCrop}><Check className="h-4 w-4 text-emerald-600" /></SBtn>
        </div>
      ) : (
      <div
        className="absolute z-30 flex items-center gap-0.5 rounded-full border border-border bg-card/95 p-1 shadow-ink-2 backdrop-blur"
        style={{ left: Math.max(8, Math.min(tl.x, window.innerWidth - 320)), top: Math.max(8, barTop), pointerEvents: 'auto' }}
        dir="ltr"
      >
        <SBtn label={t('lasso.duplicate')} onClick={() => useApp.getState().duplicateSelection()}><CopyPlus className="h-4 w-4" /></SBtn>
        <SBtn label={t('lasso.copy')} onClick={() => { useApp.getState().copySelection(); toast.success(t('lasso.copy')) }}><Copy className="h-4 w-4" /></SBtn>
        <SBtn label={t('lasso.cut')} onClick={() => useApp.getState().cutSelection()}><Scissors className="h-4 w-4" /></SBtn>
        <SBtn label={t('lasso.paste')} disabled={!clipboard} onClick={() => { const ok = useApp.getState().pasteClipboard(selection.pageId); if (!ok) toast(t('lasso.empty')) }}><ClipboardPaste className="h-4 w-4" /></SBtn>
        <div className="relative">
          <SBtn label={t('lasso.recolor')} onClick={() => setRecolorOpen((v) => !v)}><Palette className="h-4 w-4" /></SBtn>
          {recolorOpen && (
            <div className="absolute start-0 top-10 z-40" style={{ pointerEvents: 'auto' }}>
              <ColorPopover
                current={selectedEls[0]?.kind === 'stroke' || selectedEls[0]?.kind === 'text' ? (selectedEls[0] as TextEl).color : (selectedEls[0] as { color?: string })?.color ?? '#1E6FF2'}
                onPick={(hex) => { useApp.getState().recolorSelection(hex); setRecolorOpen(false) }}
                onClose={() => setRecolorOpen(false)}
              />
            </div>
          )}
        </div>
        {singleImage && imgEl && doc && (
          <div className="relative" ref={imgOptsAnchorRef}>
            <SBtn label={t('tool.image.options')} onClick={() => { setImgOptsOpen((v) => !v); setCornersOpen(false) }}><ImageIcon className="h-4 w-4" /></SBtn>
            {imgOptsOpen && (
              <ImageOptionsPopover
                key={imgEl.id}
                imgEl={imgEl}
                doc={doc}
                anchorRef={imgOptsAnchorRef}
                onCrop={startCrop}
                onClose={() => setImgOptsOpen(false)}
              />
            )}
          </div>
        )}
        {singleImage && (
          <div className="relative" ref={cornersAnchorRef}>
            <SBtn label={t('tool.image.corners')} onClick={() => { setCornersOpen((v) => !v); setImgOptsOpen(false) }}><Squircle className="h-4 w-4" /></SBtn>
            {cornersOpen && imgEl && (
              <div className="absolute start-0 top-10 z-40" style={{ pointerEvents: 'auto' }}>
                <CornersPopover
                  key={imgEl.id}
                  imgEl={imgEl}
                  anchorRef={cornersAnchorRef}
                  onPreview={previewCorners}
                  onCommit={commitCorners}
                  onClose={() => { previewCorners(null); setCornersOpen(false) }}
                />
              </div>
            )}
          </div>
        )}
        {singleImage && imgEl && (
          <SBtn label={t('tool.image.crop', 'Crop image', 'قص الصورة')} onClick={startCrop}><Crop className="h-4 w-4" /></SBtn>
        )}
        <SBtn label={t('lasso.delete')} onClick={() => useApp.getState().deleteSelection()}><Trash2 className="h-4 w-4 text-destructive" /></SBtn>
        <SBtn label={t('lasso.clear')} onClick={() => useApp.getState().setSelection(null)}><X className="h-4 w-4" /></SBtn>
      </div>
      )}

      {/* crop overlay (dim + grid + corner handles) */}
      {cropOverlay}

      {/* box + handles */}
      {!cropping && (
      <div
        className="absolute z-20 rounded-[3px]"
        style={{
          left: tl.x, top: tl.y, width: Math.max(6, boxW), height: Math.max(6, boxH),
          border: `1.6px dashed #1E6FF2`,
          pointerEvents: interactive ? 'auto' : 'none',
          cursor: interactive ? 'move' : 'default',
          touchAction: 'none',
        }}
        onPointerDown={(e) => startDrag(e, 'move')}
      >
        {(['nw', 'ne', 'sw', 'se'] as const).map((c) => (
          <div
            key={c}
            className={cn('absolute h-4 w-4 rounded-full border-2 border-white bg-primary shadow-ink-1', {
              '-start-2 -top-2': c === 'nw',
              '-end-2 -top-2': c === 'ne',
              '-start-2 -bottom-2': c === 'sw',
              '-end-2 -bottom-2': c === 'se',
            })}
            style={{ pointerEvents: interactive ? 'auto' : 'none', cursor: `${c}-resize`, touchAction: 'none' }}
            onPointerDown={(e) => startDrag(e, 'resize', c)}
          />
        ))}
      </div>
      )}

      {/* rotate handle for single image */}
      {interactive && !cropping && rotHandle && singleImage && (
        <div
          className="absolute z-20 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-primary text-white shadow-ink-1"
          style={{ left: rotHandle.x - 16, top: rotHandle.y - 16, pointerEvents: 'auto', cursor: 'grab', touchAction: 'none' }}
          onPointerDown={(e) => startDrag(e, 'rotate')}
          role="button"
          aria-label={t('tool.image.rotate')}
        >
          <RotateCw className="h-4 w-4" />
        </div>
      )}
    </>
  );
}

function drawTransformed(ctx: CanvasRenderingContext2D, el: PageElement, gamma: number) {
  const opts = { gamma, resolveImage, imageNatural };
  switch (el.kind) {
    case 'stroke': drawStroke(ctx, el, opts); break;
    case 'text': drawText(ctx, el); break;
    case 'shape': drawShape(ctx, el); break;
    case 'image': drawImageEl(ctx, el, opts); break;
  }
}

/** radians normalized to (-π, π] */
function normRad(r: number): number {
  r = r % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  if (r < -Math.PI) r += Math.PI * 2;
  return r;
}

function patchImage(el: ImageEl, patch: Partial<ImageEl>) {
  const sel = useApp.getState().editor.selection;
  if (!sel) return;
  useApp.getState().patchElements(
    sel.pageId,
    [{ id: el.id, before: el, after: { ...el, ...patch } }],
    'image',
  );
  requestRepaint();
}

/** image quick options — one-tap transforms (rotate ±90°, flips, z-order) */
function ImageOptionsPopover({
  imgEl, doc, anchorRef, onCrop, onClose,
}: {
  imgEl: ImageEl;
  doc: PageDoc;
  anchorRef: React.RefObject<HTMLDivElement | null>;
  onCrop: () => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (boxRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() };
    window.addEventListener('pointerdown', onDown, { capture: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, { capture: true });
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  const act = (patch: Partial<ImageEl>) => { patchImage(imgEl, patch); onClose() };
  const items: { label: string; icon: React.ReactNode; run: () => void }[] = [
    { label: t('tool.image.rotate90'), icon: <RotateCw className="h-4 w-4" />, run: () => act({ rotation: normRad(imgEl.rotation + Math.PI / 2) }) },
    { label: t('tool.image.rotate90ccw'), icon: <RotateCcw className="h-4 w-4" />, run: () => act({ rotation: normRad(imgEl.rotation - Math.PI / 2) }) },
    { label: t('tool.image.flipH'), icon: <FlipHorizontal className="h-4 w-4" />, run: () => act({ flipH: !imgEl.flipH }) },
    { label: t('tool.image.flipV'), icon: <FlipVertical className="h-4 w-4" />, run: () => act({ flipV: !imgEl.flipV }) },
    { label: t('tool.image.crop', 'Crop image', 'قص الصورة'), icon: <Crop className="h-4 w-4" />, run: () => { onClose(); onCrop() } },
    { label: t('tool.image.front'), icon: <BringToFront className="h-4 w-4" />, run: () => act({ z: doc.elements.reduce((m, e) => Math.max(m, e.z), 0) + 1 }) },
    { label: t('tool.image.back'), icon: <SendToBack className="h-4 w-4" />, run: () => act({ z: doc.elements.reduce((m, e) => Math.min(m, e.z), 0) - 1 }) },
  ];
  return (
    <div
      ref={boxRef}
      className="absolute start-0 top-10 z-40 w-52 rounded-xl border border-border bg-card p-1.5 shadow-ink-2"
      style={{ pointerEvents: 'auto' }}
      role="menu"
      aria-label={t('tool.image.options')}
    >
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          role="menuitem"
          onClick={it.run}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-start hover:bg-accent press-scale"
        >
          {it.icon}
          {it.label}
        </button>
      ))}
    </div>
  );
}

/** Corners popover (single selected image): Sharp/Rounded segmented toggle +
 *  a radius slider (0 … min(w,h)/2). Slider drags preview live on the overlay
 *  (original hidden) and commit as ONE undoable command on release. */
function CornersPopover({
  imgEl, anchorRef, onPreview, onCommit, onClose,
}: {
  imgEl: ImageEl;
  anchorRef: React.RefObject<HTMLDivElement | null>;
  onPreview: (radius: number | null) => void;
  onCommit: (radius: number) => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const committed = imgEl.cornerRadius ?? 0;
  const maxR = Math.max(1, Math.floor(Math.min(Math.abs(imgEl.w), Math.abs(imgEl.h)) / 2));
  const [radius, setRadius] = useState(committed);
  const pendingRef = useRef<number | null>(null); // previewed-but-not-yet-committed radius
  const boxRef = useRef<HTMLDivElement>(null);

  // stable flush so the unmount cleanup always commits a pending preview
  const flushRef = useRef<() => void>(() => {});
  useEffect(() => {
    flushRef.current = () => {
      const p = pendingRef.current;
      pendingRef.current = null;
      if (p != null) { onCommit(p); onPreview(null) }
    };
  }, [onCommit, onPreview]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      // the anchor wrapper (toggle button) owns open/close via its own click
      if (boxRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      flushRef.current();
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { flushRef.current(); onClose() }
    };
    window.addEventListener('pointerdown', onDown, { capture: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, { capture: true });
      window.removeEventListener('keydown', onKey);
      flushRef.current(); // e.g. selection deleted while a preview was live
      onPreview(null);
    };
  }, []);

  const applySharp = () => {
    pendingRef.current = null;
    setRadius(0);
    onPreview(null);
    onCommit(0);
  };

  const applyRound = () => {
    const target = radius > 0 ? radius : Math.min(40, maxR);
    pendingRef.current = null;
    setRadius(target);
    onPreview(null);
    onCommit(target);
  };

  const sharpActive = radius === 0;

  return (
    <div
      ref={boxRef}
      className="w-56 rounded-xl border border-border bg-card p-3 shadow-ink-2"
      style={{ pointerEvents: 'auto' }}
      dir="ltr"
      onClick={(e) => e.stopPropagation()}
      role="group"
      aria-label={t('tool.image.corners')}
    >
      <div className="mb-2 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
        <button
          type="button"
          aria-pressed={sharpActive}
          onClick={applySharp}
          className={cn(
            'h-7 rounded-md text-xs font-medium transition-colors press-scale',
            sharpActive ? 'bg-card text-foreground shadow-ink-1' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {t('tool.image.corners.sharp')}
        </button>
        <button
          type="button"
          aria-pressed={!sharpActive}
          onClick={applyRound}
          className={cn(
            'h-7 rounded-md text-xs font-medium transition-colors press-scale',
            !sharpActive ? 'bg-card text-foreground shadow-ink-1' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {t('tool.image.corners.round')}
        </button>
      </div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground">{t('tool.image.radius')}</span>
        <span className="text-[10px] tabular-nums text-muted-foreground/70">{radius}</span>
      </div>
      <Slider
        value={[radius]}
        min={0}
        max={maxR}
        step={1}
        aria-label={t('tool.image.radius')}
        onValueChange={(vals) => {
          const v = vals[0] ?? 0;
          setRadius(v);
          pendingRef.current = v;
          onPreview(v);
        }}
        onValueCommit={(vals) => {
          const v = vals[0] ?? 0;
          pendingRef.current = null;
          onCommit(v);
          onPreview(null);
        }}
      />
    </div>
  );
}

function SBtn({ children, label, onClick, disabled }: { children: React.ReactNode; label: string; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-full text-foreground transition-colors press-scale',
        disabled ? 'opacity-35' : 'hover:bg-accent active:bg-accent',
      )}
    >
      {children}
    </button>
  );
}
