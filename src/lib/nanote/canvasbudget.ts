// Canvas budget — adaptive device-aware bitmap limits.
//
// The old code used two compile-time constants (8192 px side, 16.6M px area)
// for EVERY device. 16.6M px is the classic iOS Safari canvas ceiling, but on
// mid/low-RAM Android WebViews a canvas that big (≈66 MB) can fail to allocate
// its backing store — Chromium then silently serves a BLANK canvas, which the
// user sees as the "zoomed to max → black screen" bug. With the Split
// Workspace open there are TWO full app instances rastering at once, doubling
// the pressure.
//
// This module sizes the budget from real evidence, once per session:
//   • navigator.deviceMemory (Android Chrome/WebView exposes 0.5–8 GB) picks
//     the starting candidate;
//   • a canvas ALLOCATION PROBE (draw + getImageData read-back at descending
//     candidate areas) verifies the device can actually back a canvas that
//     large — a failed/blank allocation steps the budget down;
//   • an embedded split pane (window !== top) halves the budget — two
//     instances share the same device RAM;
//   • a runtime ESCAPE HATCH: paint code that catches a failed allocation can
//     force the budget down and re-probe smaller, self-healing mid-session.
//
// All getters are synchronous after the (lazy) first call; the probe runs on
// the main thread ONCE and costs ~10–40 ms.

const SIDE_CAP = 8192;              // per-side cap stays conservative everywhere
const IOS_SAFARI_AREA = 16.6e6;     // never exceed the classic iOS ceiling
const MIN_AREA = 3.2e6;             // last-resort budget (≈1.5 screens @dpr2)

let probedArea: number | null = null;
let forceSmall = false;

function deviceMemoryGB(): number {
  try {
    const nav = navigator as Navigator & { deviceMemory?: number };
    return nav.deviceMemory ?? 4;
  } catch {
    return 4;
  }
}

/** embedded split pane B (same-origin iframe) — half the device RAM to spend */
export function isEmbeddedInstance(): boolean {
  try {
    return window !== window.top;
  } catch {
    return true; // cross-origin access threw → assume embedded
  }
}

function candidateLadder(): number[] {
  const mem = deviceMemoryGB();
  const ladder: number[] = [];
  if (!forceSmall) {
    if (mem >= 6) ladder.push(IOS_SAFARI_AREA);
    if (mem >= 4) ladder.push(12e6);
    ladder.push(8e6);
  }
  ladder.push(4.5e6);
  ladder.push(MIN_AREA);
  return [...new Set(ladder)].sort((a, b) => b - a).filter((a) => a <= IOS_SAFARI_AREA);
}

/**
 * Verify a square canvas of `area` pixels can be allocated AND drawn to.
 * Over-budget canvases on constrained devices allocate but read back as
 * transparent garbage — the read-back is the actual test.
 */
function probeArea(area: number): boolean {
  try {
    const side = Math.floor(Math.sqrt(area));
    const c = document.createElement('canvas');
    c.width = side;
    c.height = side;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, side, side);
    const px = ctx.getImageData(0, 0, 2, 2).data; // forces the backing store
    const ok = px[0] === 255 && px[3] === 255;
    c.width = 0; // release immediately
    c.height = 0;
    return ok;
  } catch {
    return false;
  }
}

function probeSync(): number {
  if (typeof document === 'undefined') return 8e6;
  for (const area of candidateLadder()) {
    if (probeArea(area)) return area;
  }
  return MIN_AREA;
}

/** Current bitmap AREA budget (px). Embedded split panes get half. */
export function bitmapAreaBudget(): number {
  if (probedArea === null) probedArea = probeSync();
  let budget = probedArea;
  if (isEmbeddedInstance()) budget = Math.min(budget, 8e6);
  return Math.max(MIN_AREA, budget);
}

/** Current per-side bitmap cap (px). */
export function bitmapSideCap(): number {
  return SIDE_CAP;
}

/**
 * Runtime degradation — a paint failed (allocation/contexts throwing or the
 * canvas reading back blank). Halve the budget so the NEXT window render asks
 * for a smaller bitmap instead of blanking forever.
 */
export function degradeBitmapBudget(): void {
  const cur = probedArea ?? 8e6;
  probedArea = Math.max(MIN_AREA, Math.floor(cur / 2));
  forceSmall = probedArea <= 4.5e6;
}

/** Human-readable diagnostics (Pen/input diagnostics panel). */
export function bitmapBudgetInfo(): { areaPx: number; sidePx: number; memoryGB: number; embedded: boolean } {
  return {
    areaPx: bitmapAreaBudget(),
    sidePx: SIDE_CAP,
    memoryGB: deviceMemoryGB(),
    embedded: isEmbeddedInstance(),
  };
}
