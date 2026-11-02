'use client';
// Split Workspace bus — postMessage protocol between the main app (pane A)
// and the embedded instance in pane B (same-origin iframe). Both panes run the
// exact same editor engine with independent viewport/undo state; this bus only
// syncs what the user wants to MOVE between them:
//   • clipboardPut  — copy in one pane → paste works in the other
//   • transferOut   — "send selection to the other pane" / edge-drag transfer
//   • receiveDrop   — the other pane pastes the elements at its view center
//   • splitLayout   — parent tells the child which side the divider is on
//   • closeRequest  — the child's exit button closes the split
import { useApp } from '@/lib/nanote/store';
import { PAGE_SIZES, PageElement } from '@/lib/nanote/types';
import { getViewportSize, getVp, layoutPages, pageAtWorldY } from './viewport';

export type SplitMessage =
  | { type: 'ready' }
  | { type: 'closeRequest' }
  | { type: 'clipboardPut'; elements: PageElement[] }
  | { type: 'transferOut'; elements: PageElement[] }
  | { type: 'receiveDrop'; elements: PageElement[] }
  | { type: 'splitLayout'; orientation: 'vertical' | 'horizontal' };

const ORIGIN = typeof window !== 'undefined' ? window.location.origin : '*';
/** how close to the divider-facing edge a drag must end to transfer (px) */
const EDGE_PX = 56;

/** true inside the embedded pane-B instance */
export function isEmbedded(): boolean {
  return typeof window !== 'undefined' && window.parent !== window;
}

// ---------------------------------------------------------------- child side
export function postToParent(msg: SplitMessage): void {
  if (!isEmbedded()) return;
  try { window.parent.postMessage(msg, ORIGIN) } catch { /* parent gone */ }
}

export function onParentMessage(handler: (msg: SplitMessage) => void): () => void {
  const onMsg = (ev: MessageEvent) => {
    if (ev.source !== window.parent) return;
    if (ev.origin !== ORIGIN) return;
    handler(ev.data as SplitMessage);
  };
  window.addEventListener('message', onMsg);
  return () => window.removeEventListener('message', onMsg);
}

// ---------------------------------------------------------------- parent side
export function postToChild(iframe: HTMLIFrameElement | null, msg: SplitMessage): void {
  const win = iframe?.contentWindow;
  if (!win) return;
  try { win.postMessage(msg, ORIGIN) } catch { /* child gone */ }
}

export function onChildMessage(handler: (msg: SplitMessage, reply: (m: SplitMessage) => void) => void): () => void {
  const onMsg = (ev: MessageEvent) => {
    if (ev.origin !== ORIGIN) return;
    const src = ev.source as Window | null;
    if (!src) return;
    handler(ev.data as SplitMessage, (m) => { try { src.postMessage(m, ORIGIN) } catch { /* gone */ } });
  };
  window.addEventListener('message', onMsg);
  return () => window.removeEventListener('message', onMsg);
}

// ---------------------------------------------------------------- shared: drop at view center
/** paste received elements at the center of THIS pane's current view */
export function receiveDroppedElements(elements: PageElement[]): void {
  if (!elements?.length) return;
  const st = useApp.getState();
  const notebook = st.notebooks.find((n) => n.id === st.editor.notebookId);
  if (!notebook) return;
  const pageW = PAGE_SIZES[notebook.pageSize].w;
  const { layouts } = layoutPages(st.editor.pages, pageW);
  if (!layouts.length) return;
  const vp = getVp();
  const { w, h } = getViewportSize();
  const cx = (w / 2 - vp.tx) / vp.scale;
  const cy = (h / 2 - vp.ty) / vp.scale;
  const layout = pageAtWorldY(layouts, cy) ?? layouts[0];
  void st.ensureDoc(layout.id).then(() => {
    useApp.setState({ editor: { ...useApp.getState().editor, clipboard: elements.map((e) => ({ ...e }) as PageElement) } });
    useApp.getState().pasteClipboard(layout.id, { x: cx, y: cy - layout.y });
  });
}

// ---------------------------------------------------------------- edge-drop + send
/** which edge of THIS pane faces the divider ('start' = left/top) */
function facingEdge(): 'start' | 'end' | null {
  if (isEmbedded()) return 'start'; // pane B always sits after the divider
  const st = useApp.getState();
  if (!st.split.open) return null;
  return 'end';
}

/** orientation of the split for THIS instance ('vertical' = side-by-side).
 *  the child learns it from splitLayout messages; the parent reads its store. */
let childOrientation: 'vertical' | 'horizontal' = 'vertical';

export function noteSplitLayout(orientation: 'vertical' | 'horizontal'): void {
  childOrientation = orientation;
}

/** is the pointer inside the divider-facing edge zone of this pane? */
export function inEdgeZone(clientX: number, clientY: number): boolean {
  const edge = facingEdge();
  if (!edge) return false;
  const vertical = isEmbedded() ? childOrientation === 'vertical' : useApp.getState().split.orientation === 'vertical';
  const host = document.querySelector('[data-viewport]') as HTMLElement | null;
  if (!host) return false;
  const r = host.getBoundingClientRect();
  if (edge === 'end') {
    // vertical split → right edge; horizontal → bottom edge
    return vertical
      ? clientX > r.right - EDGE_PX
      : clientY > r.bottom - EDGE_PX;
  }
  // child: start edge (left for vertical, top for horizontal)
  return vertical
    ? clientX < r.left + EDGE_PX
    : clientY < r.top + EDGE_PX;
}

/** send the given elements to the OTHER pane (pasted at its view center) */
export function sendElementsToOtherPane(elements: PageElement[]): void {
  if (!elements.length) return;
  if (isEmbedded()) {
    postToParent({ type: 'transferOut', elements });
  } else {
    // parent → child goes through the SplitWorkspace's registered sender
    parentSender?.({ type: 'receiveDrop', elements });
  }
}

/** registered by SplitWorkspace — the only place that knows the iframe ref */
let parentSender: ((m: SplitMessage) => void) | null = null;
export function registerParentSender(send: ((m: SplitMessage) => void) | null): void {
  parentSender = send;
}

/** can this instance currently send things to another pane? */
export function splitActiveHere(): boolean {
  return isEmbedded() || useApp.getState().split.open;
}
