// Nanote Pen Engine — stylus identification + hardware-capability tracking.
//
// Every pen PointerEvent the editor receives is fed to observePenEvent().
// The engine accumulates evidence (pressure behaviour, tilt, in-range hover,
// hardware button bits, coalesced-sample rate) and classifies the pen into a
// family, exposing:
//   • a human-readable label ("Samsung S Pen / Wacom EMR", "Apple Pencil",
//     "USI stylus", "MPP / Surface Pen", generic active stylus…)
//   • live capability flags — which hardware inputs actually exist on THIS
//     pen (barrel button, second button, eraser end, pressure, tilt, hover,
//     report rate) — so the Pen & input settings can coordinate the shortcut
//     mapping with the pen the user is actually holding.
//
// Why an engine: the browser only exposes raw PointerEvents. Different pen
// families surface their hardware differently (S Pen reports the side button
// in `buttons` while HOVERING, Apple Pencil exposes no barrel button at all
// and relies on its own double-tap, Surface Pens report an eraser end as
// button bit 32). Sampling and classifying those signals once — instead of
// scattering heuristics through the input handlers — lets the app "read" any
// pen and wire its real buttons to the user's shortcuts.
//
// Pure client-side, zero dependencies, safe on every platform (all access is
// guarded; SSR/private-mode must never throw).

export type PenFamily =
  | 'apple-pencil'
  | 'emr'        // Samsung S Pen & other Wacom EMR pens
  | 'usi'        // Chromebook USI styluses
  | 'mpp'        // Microsoft Pen Protocol (Surface, Lenovo, HP…)
  | 'generic'    // active stylus, family unknown
  | 'none';

export interface PenInfo {
  /** a pen pointer has been observed in this session */
  detected: boolean;
  family: PenFamily;
  /** best human-readable name for the detected pen */
  label: string;
  /** pressure values vary — a real digitizer (vs. a fixed 0.5 reporter) */
  pressure: boolean;
  /** highest pressure seen (0..1) */
  maxPressure: number;
  /** tiltX/tiltY vary */
  tilt: boolean;
  /** the pen reported motion with pressure 0 — in-range hovering (EMR/USI) */
  hover: boolean;
  /** observed hardware buttons (bitmask: 2 = barrel, 4 = second, 32 = eraser end) */
  buttons: number;
  /** estimated digitizer report rate in Hz (0 = not enough samples) */
  rateHz: number;
  /** performance.now() of the last pen event */
  lastSeen: number;
}

const NO_PEN: PenInfo = {
  detected: false, family: 'none', label: '', pressure: false,
  maxPressure: 0, tilt: false, hover: false, buttons: 0, rateHz: 0, lastSeen: 0,
};

let info: PenInfo = { ...NO_PEN };

// rolling sample window for the rate estimate
const RATE_SAMPLES = 24;
let rateTs: number[] = [];

// pressure-variance evidence
let pressureValues: number[] = [];

// tilt evidence
let tiltSeen = false;

// multiple pointers: remember which pen pointerId we are profiling (a second
// pen swapped mid-session re-seeds the profile)
let profiledPointerId: number | null = null;

type Listener = (info: PenInfo) => void;
const listeners = new Set<Listener>();

function emit() { for (const l of listeners) l(info) }

function platform(): 'android' | 'ios' | 'cros' | 'windows' | 'mac' | 'other' {
  try {
    const ua = navigator.userAgent;
    const tp = navigator.maxTouchPoints || 0;
    if (/CrOS/.test(ua)) return 'cros';
    if (/Android/.test(ua)) return 'android';
    // iPadOS 13+ masquerades as desktop Safari — maxTouchPoints separates it
    if (/iPhone|iPad|iPod/.test(ua) || (/(Macintosh|Mac OS X)/.test(ua) && tp > 1)) return 'ios';
    if (/Windows/.test(ua)) return 'windows';
    if (/Mac/.test(ua)) return 'mac';
  } catch { /* guarded */ }
  return 'other';
}

function classify(): { family: PenFamily; label: string } {
  const plat = platform();
  const highRate = info.rateHz >= 110;
  switch (plat) {
    case 'ios':
      return { family: 'apple-pencil', label: 'Apple Pencil' };
    case 'cros':
      return { family: 'usi', label: 'USI stylus' };
    case 'windows':
      // Windows pens: MPP/Slim report buttons (incl. eraser bit 32) + tilt
      return { family: 'mpp', label: 'MPP stylus (Surface / Slim Pen)' };
    case 'android':
      // hover + high report rate = Wacom EMR digitizer (Galaxy S Pen, Lenovo…)
      if (info.hover && highRate) return { family: 'emr', label: 'Samsung S Pen / Wacom EMR' };
      if (info.hover) return { family: 'emr', label: 'EMR stylus' };
      if (info.buttons) return { family: 'generic', label: 'Active stylus (buttons)' };
      return { family: 'generic', label: 'Active stylus' };
    default:
      if (info.buttons) return { family: 'generic', label: 'Active stylus (buttons)' };
      return { family: 'generic', label: 'Active stylus' };
  }
}

/**
 * Feed one pen pointer event into the engine. Call for EVERY pen event
 * (pointerdown / pointermove / pointerup) with the number of coalesced
 * samples the event carried (1 when none) — the batch size refines the
 * report-rate estimate.
 */
export function observePenEvent(e: {
  pointerType: string;
  pointerId: number;
  pressure: number;
  buttons: number;
  tiltX?: number;
  tiltY?: number;
}, coalescedCount = 1): void {
  if (e.pointerType !== 'pen') return;
  const now = performance.now();

  if (!info.detected || (profiledPointerId !== null && profiledPointerId !== e.pointerId)) {
    // (re)seed the profile for this pen
    info = { ...NO_PEN, detected: true, lastSeen: now };
    rateTs = [];
    pressureValues = [];
    tiltSeen = false;
    profiledPointerId = e.pointerId;
  }
  info.lastSeen = now;

  // ---- pressure evidence (contact only; hover reports 0)
  if (e.pressure > 0) {
    info.maxPressure = Math.max(info.maxPressure, e.pressure);
    pressureValues.push(e.pressure);
    if (pressureValues.length > 64) pressureValues.shift();
    if (!info.pressure && pressureValues.length >= 6) {
      const lo = Math.min(...pressureValues);
      const hi = Math.max(...pressureValues);
      info.pressure = hi - lo > 0.06; // varies → real digitizer
    }
  } else {
    // motion with pressure 0 while a pen is in range = hover-capable
    info.hover = true;
  }

  // ---- tilt evidence
  if (!tiltSeen) {
    const tx = Math.abs(Number(e.tiltX) || 0);
    const ty = Math.abs(Number(e.tiltY) || 0);
    if (tx > 2 || ty > 2) tiltSeen = true;
  }
  info.tilt = tiltSeen;

  // ---- hardware buttons (barrel = bit 2, second = bit 4, eraser end = bit 32;
  // bit 1 is the tip contact itself and is not a "button")
  const hw = e.buttons & (2 | 4 | 32);
  if (hw) info.buttons |= hw;

  // ---- report-rate estimate from inter-event spacing, scaled by the
  // coalesced batch (high-Hz digitizers deliver many samples per event)
  rateTs.push(now);
  if (rateTs.length > RATE_SAMPLES) rateTs.shift();
  if (rateTs.length >= 8) {
    const dts: number[] = [];
    for (let i = 1; i < rateTs.length; i++) dts.push(rateTs[i] - rateTs[i - 1]);
    dts.sort((a, b) => a - b);
    const median = dts[Math.floor(dts.length / 2)] || 1;
    // ignore huge gaps (pen idle between strokes) — median handles them
    if (median > 0 && median < 120) {
      const est = Math.round((1000 / median) * Math.max(1, coalescedCount));
      info.rateHz = Math.max(info.rateHz, Math.min(est, 480));
    }
  }

  const { family, label } = classify();
  info.family = family;
  info.label = label;
  emit();
}

/** Current pen profile (frozen snapshot — treat as read-only). */
export function getPenInfo(): PenInfo {
  return info;
}

/** Subscribe to profile changes (settings sheet live updates). Returns unsubscribe. */
export function subscribePen(cb: Listener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb) };
}

/** names for the observed hardware buttons — for UI hints */
export function observedButtons(): string[] {
  const out: string[] = [];
  if (info.buttons & 2) out.push('barrel');
  if (info.buttons & 4) out.push('second');
  if (info.buttons & 32) out.push('eraser');
  return out;
}
