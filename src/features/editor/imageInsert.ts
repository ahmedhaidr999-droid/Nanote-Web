'use client';
// Shared placement helper — drops an images-store record onto the current page
// as an ImageEl at the CENTER of the viewport, auto-selects it (its edit panel
// appears immediately) and switches to the image tool. Used by both the image
// tool and the sticker picker so stickers behave exactly like images.
import { useApp } from '@/lib/nanote/store';
import { uid } from '@/lib/nanote/util';
import { getVp, layoutPages } from './viewport';

export async function placeImageElement(opts: {
  imageId: string;
  w: number;
  h: number;
  pageW: number;
  /** fraction of the page width the element spans on insert (default 0.5) */
  targetScale?: number;
}): Promise<string | null> {
  const st = useApp.getState();
  const pageId = st.editor.activePageId;
  if (!pageId) return null;
  const doc = await st.ensureDoc(pageId);
  const z = doc.elements.reduce((acc, e) => Math.max(acc, e.z), 0) + 1;
  const targetW = Math.max(24, opts.pageW * (opts.targetScale ?? 0.5));
  const ih = targetW * (opts.h / Math.max(1, opts.w));

  // Place at the CENTER of what the user is looking at. screen→world works
  // in CONTAINER-RELATIVE coordinates (InkSurface subtracts the viewport rect
  // before calling screenToWorld — see worldFromEvent), so the container
  // center is exactly (clientWidth/2, clientHeight/2). The REAL bug the old
  // math had: pages after the first sit at layout.y inside the world (page 2
  // ≈ +1152), and the world point was treated as page-LOCAL — inserting while
  // viewing page 2+ dropped the element a full page-height BELOW the visible
  // area, often completely off the page ("the image never appeared").
  const vp = getVp();
  const host = typeof document !== 'undefined' ? document.querySelector('[data-viewport]') : null;
  let vx: number, vy: number;
  if (host) {
    const hw = (host as HTMLElement).clientWidth;
    const hh = (host as HTMLElement).clientHeight;
    const wx = (hw / 2 - vp.tx) / vp.scale;
    const wy = (hh / 2 - vp.ty) / vp.scale;
    // world x IS page-local x (pages share the x axis); world y needs the
    // active page's stacked offset. layoutPages is the same pure function
    // the editor uses, so this can never drift from the real geometry.
    const layout = layoutPages(st.editor.pages, opts.pageW).layouts.find((l) => l.id === pageId);
    vx = wx;
    vy = layout ? wy - layout.y : wy;
  } else {
    vx = 200; vy = 200; // headless fallback — somewhere harmless on the page
  }

  const elId = uid();
  st.addElements(pageId, [{
    kind: 'image', id: elId, x: vx - targetW / 2, y: vy - ih / 2, w: targetW, h: ih,
    imageId: opts.imageId, rotation: 0, z,
  }]);
  // the element's edit options appear IMMEDIATELY: the image tool + selection
  // open the handles/action bar around the fresh element; tapping empty space
  // applies the changes, and lasso (or image-tool tap) brings them back.
  st.setTool('image');
  st.setSelection({ pageId, ids: [elId] });
  return elId;
}
