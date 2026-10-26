// Nanote Pen Engine v3 — stylus identification, capability tracking and the
// hardware-button PATTERN state machine.
//
// Every pen PointerEvent the editor receives is fed to observePenEvent()
// (down/move/up). The engine accumulates evidence and exposes:
//   • a human-readable label resolved against the pen DATABASE (pendb.ts —
//     25+ sourced models incl. Xiaomi Focus Pen Pro / Smart Pen, Samsung S Pen,
//     Apple Pencil, Huawei M-Pencil, Honor Magic Pencil, Lenovo Tab/Precision
//     pens, Surface/MPP, Wacom One, USI, OnePlus/OPPO/vivo/realme, generic
//     active + capacitive) with manual override;
//   • live capability flags (pressure / tilt / hover / report rate / buttons
//     actually reported by THIS pen) — capability-based, never name-only;
//   • ADAPTIVE PRESSURE CALIBRATION — compressed digitizer bands are remapped
//     onto the full 0–1 range so light/heavy response is correct everywhere;
//   • BARREL-BIT AUTO-MAPPING — the FIRST bit the pen actually reports locks
//     as the primary barrel (S Pen hover → 2, MPP → 4, some pens → 8/16);
//   • BUTTON PATTERNS — press / double press / long press per physical bit,
//     each tagged with its CONTEXT (hover vs. writing) so bindings can
//     differentiate "press while hovering" from "press while writing";
//   • a live SAMPLE feed for the pen test pad (pressure/tilt/hover/buttons
//     in real time — the Pen & input management UI subscribes to it).
//
// Detection truthfulness: the browser cannot read USB/BLE vendor IDs. We
// combine platform + report evidence + Android UA device markers, keep the UA
// as a HINT only, and always allow the manual profile picker. When the model
// cannot be pinned we fall back to the capability-based generic profile.
//
// Pure client-side, zero dependencies, guarded for SSR/private mode.

import { clamp } from './util';
import { getPenSpecs, type StylusSpec } from './pendb';

export type PenFamily =
  | 'apple-pencil'
  | 'emr'        // Samsung S Pen & other Wacom EMR pens
  | 'usi'        // Chromebook USI styluses
  | 'mpp'        // Microsoft Pen Protocol (Surface, Lenovo, HP…)
  | 'vendor'     // identified Android-vendor pen (Xiaomi / Huawei / Honor…)
  | 'generic'    // active stylus, family unknown
  | 'none';

// ---------------------------------------------------------------- pen model view
/** compact capability view of a DB record — what the engine/UI reason about */
export interface PenModel {
  id: string;
  vendor: string;
  name: string;
  nameAr: string;
  protocol: StylusSpec['protocol'];
  buttons: number;        // physical barrel buttons (excluding tip & eraser end)
  eraserEnd: boolean;
  pressureLevels: number; // 0 = none/unknown
  tilt: boolean;
  hover: boolean;
  bodyDoubleTap: boolean;
  ua?: RegExp;
}

function modelOf(s: StylusSpec): PenModel {
  return {
    id: s.id,
    vendor: s.vendor,
    name: s.name,
    nameAr: s.nameAr,
    protocol: s.protocol,
    buttons: s.buttons.filter((b) => b.id === 'barrel' || b.id === 'barrel2').length,
    eraserEnd: s.eraserEnd === true,
    pressureLevels: s.pressureLevels ?? 0,
    tilt: s.tilt === true,
    hover: s.hover === true,
    bodyDoubleTap: s.bodyDoubleTap === true,
    ua: s.ua,
  };
}

/** registry derived from the live pen DB (updates after a DB merge) */
export function PEN_MODELS(): PenModel[] {
  return getPenSpecs().map(modelOf);
}

export function penModelById(id: string | null | undefined): PenModel | null {
  if (!id || id === 'auto') return null;
  const s = getPenSpecs().find((m) => m.id === id);
  return s ? modelOf(s) : null;
}

export function penSpecById(id: string | null | undefined): StylusSpec | null {
  if (!id || id === 'auto') return null;
  return getPenSpecs().find((m) => m.id === id) ?? null;
}

// ---------------------------------------------------------------- profile state

export interface PenInfo {
  /** a pen pointer has been observed in this session */
  detected: boolean;
  family: PenFamily;
  /** best human-readable name for the detected pen */
  label: string;
  /** registry id of the manually-selected pen profile ('auto' = automatic) */
  profileId: string;
  /** pressure values vary — a real digitizer (vs. a fixed 0.5 reporter) */
  pressure: boolean;
  /** highest pressure seen (0..1) */
  maxPressure: number;
  /** observed contact-pressure envelope (adaptive calibration, 0..1) */
  pressureFloor: number;
  pressureCeil: number;
  /** tiltX/tiltY vary */
  tilt: boolean;
  /** last observed tilt magnitude (degrees, 0 = upright) */
  tiltDeg: number;
  /** the pen reported motion with pressure 0 — in-range hovering (EMR/USI) */
  hover: boolean;
  /** observed hardware buttons (bitmask over 2 | 4 | 8 | 16 | 32) */
  buttons: number;
  /** estimated digitizer report rate in Hz (0 = not enough samples) */
  rateHz: number;
  /** performance.now() of the last pen event */
  lastSeen: number;
}

const NO_PEN: PenInfo = {
  detected: false, family: 'none', label: '', profileId: 'auto', pressure: false,
  maxPressure: 0, pressureFloor: 0, pressureCeil: 1, tilt: false, tiltDeg: 0,
  hover: false, buttons: 0, rateHz: 0, lastSeen: 0,
};

let info: PenInfo = { ...NO_PEN };

/** manual profile override (persisted in Settings.penProfileId) */
let manualProfileId: string | null = null;

// rolling sample window for the rate estimate
const RATE_SAMPLES = 24;
let rateTs: number[] = [];

// pressure-variance evidence + adaptive envelope
let pressureValues: number[] = [];

// tilt evidence
let tiltSeen = false;

// multiple pointers: remember which pen pointerId we are profiling
let profiledPointerId: number | null = null;

// barrel-bit auto-mapping: the FIRST bit the physical pen reports locks as
// the primary barrel; other observed barrel bits route to the secondary.
const BARREL_CANDIDATES = [2, 4, 8, 16] as const;
let primaryBarrelBit = 0; // 0 = not locked yet

type Listener = (info: PenInfo) => void;
const listeners = new Set<Listener>();

function emit() { for (const l of listeners) l(info) }

// ---------------------------------------------------------------- live sample feed
/** raw per-event pen data for the test pad / live meters */
export interface PenSample {
  pressure: number;   // raw 0..1
  tiltX: number;
  tiltY: number;
  tiltDeg: number;
  hover: boolean;      // pressure 0 + no tip button
  buttons: number;     // raw bits
  t: number;           // performance.now()
}
type SampleListener = (s: PenSample) => void;
const sampleListeners = new Set<SampleListener>();

export function subscribePenSamples(cb: SampleListener): () => void {
  sampleListeners.add(cb);
  return () => { sampleListeners.delete(cb) };
}

// ---------------------------------------------------------------- button patterns
export type PenPatternKind = 'press' | 'double' | 'long' | 'release';
export interface PenButtonEvent {
  bit: number;               // 2/4/8/16 barrel or 32 eraser end
  primary: boolean;          // routed through the locked primary mapping?
  pattern: PenPatternKind;
  /** true when the tip is in contact (writing) at the moment of the press */
  writing: boolean;
}
type ButtonListener = (ev: PenButtonEvent) => void;
const buttonListeners = new Set<ButtonListener>();

export function onPenButtonEvent(cb: ButtonListener): () => void {
  buttonListeners.add(cb);
  return () => { buttonListeners.delete(cb) };
}

const DBL_MS = 450;      // double-press window
const LONG_MS = 650;     // long-press threshold
/** per-bit pattern tracking: press time + long-press timer */
const btnState = new Map<number, { downAt: number; longTimer: ReturnType<typeof setTimeout> | null }>();
/** per-bit "moment of the previous release" — feeds the double-press detector */
const btnLastUp = new Map<number, number>();

const bitsOf = (buttons: number) => {
  const out: number[] = [];
  for (const b of [2, 4, 8, 16, 32] as const) if (buttons & b) out.push(b);
  return out;
};

function emitButton(bit: number, pattern: PenPatternKind, writing: boolean) {
  const ev: PenButtonEvent = { bit, primary: bit !== 32 && bit === barrelMap().primary, pattern, writing };
  for (const l of buttonListeners) l(ev);
}

/** clear all pending pattern state (pointer cancelled / pen left range) */
function resetButtonPatterns(keepBits = 0) {
  for (const [bit, st] of btnState) {
    if (st.longTimer) clearTimeout(st.longTimer);
    if (!(keepBits & bit)) btnState.delete(bit);
  }
}

// ---------------------------------------------------------------- platform helpers
function platform(): 'android' | 'ios' | 'cros' | 'windows' | 'mac' | 'other' {
  try {
    const ua = navigator.userAgent;
    const tp = navigator.maxTouchPoints || 0;
    if (/CrOS/.test(ua)) return 'cros';
    if (/Android/.test(ua)) return 'android';
    if (/iPhone|iPad|iPod/.test(ua) || (/(Macintosh|Mac OS X)/.test(ua) && tp > 1)) return 'ios';
    if (/Windows/.test(ua)) return 'windows';
    if (/Mac/.test(ua)) return 'mac';
  } catch { /* guarded */ }
  return 'other';
}

function uaVendorModel(): StylusSpec | null {
  try {
    const ua = navigator.userAgent;
    const plat = platform();
    if (plat === 'ios') return null; // Apple Pencil family handled by classify()
    if (plat !== 'android') return null;
    for (const m of getPenSpecs()) {
      if (m.ua && m.ua.test(ua)) return m;
    }
  } catch { /* guarded */ }
  return null;
}

/** resolve the current label/family against the DB + evidence */
function resolveProfile(): { family: PenFamily; label: string; spec: StylusSpec | null } {
  const manual = penSpecById(manualProfileId);
  if (manual) {
    const fam: PenFamily =
      manual.protocol === 'apple' ? 'apple-pencil'
      : manual.protocol === 'emr' ? 'emr'
      : manual.protocol === 'usi' ? 'usi'
      : manual.protocol === 'mpp' ? 'mpp'
      : 'vendor';
    return { family: fam, label: manual.name, spec: manual };
  }
  const plat = platform();
  const highRate = info.rateHz >= 110;
  const vendor = uaVendorModel();
  if (vendor) {
    // device markers say which pen family the tablet takes — a strong hint,
    // but still just a hint (the user can always pin the exact model)
    const fam: PenFamily =
      vendor.protocol === 'emr' ? 'emr'
      : vendor.protocol === 'usi' ? 'usi'
      : vendor.protocol === 'apple' ? 'apple-pencil'
      : 'vendor';
    return { family: fam, label: vendor.name, spec: vendor };
  }
  switch (plat) {
    case 'ios':
      return { family: 'apple-pencil', label: 'Apple Pencil', spec: null };
    case 'cros':
      return { family: 'usi', label: 'USI stylus', spec: null };
    case 'windows':
      return { family: 'mpp', label: 'MPP stylus (Surface / Slim Pen)', spec: null };
    case 'android':
      if (info.hover && highRate) return { family: 'emr', label: 'Samsung S Pen / Wacom EMR', spec: null };
      if (info.hover) return { family: 'emr', label: 'EMR stylus', spec: null };
      if (info.buttons) return { family: 'generic', label: 'Active stylus (buttons)', spec: null };
      return { family: 'generic', label: 'Active stylus', spec: null };
    default:
      if (info.buttons) return { family: 'generic', label: 'Active stylus (buttons)', spec: null };
      return { family: 'generic', label: 'Active stylus', spec: null };
  }
}

/**
 * Feed one pen pointer event into the engine. Call for EVERY pen event
 * (pointerdown / pointermove / pointerup). Runs the button-edge detector +
 * the press/double/long pattern state machine and emits PenButtonEvent's —
 * subscribers (the shortcut router) fire the user's bindings.
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
    // (re)seed the profile for this pen (a new pen swapped mid-session)
    info = { ...NO_PEN, detected: true, lastSeen: now, profileId: manualProfileId ?? 'auto' };
    rateTs = [];
    pressureValues = [];
    tiltSeen = false;
    primaryBarrelBit = 0;
    profiledPointerId = e.pointerId;
    resetButtonPatterns(0);
  }
  info.lastSeen = now;

  // ---- pressure evidence + adaptive envelope (contact only; hover reports 0)
  if (e.pressure > 0.015) {
    info.maxPressure = Math.max(info.maxPressure, e.pressure);
    pressureValues.push(e.pressure);
    if (pressureValues.length > 96) pressureValues.shift();
    if (!info.pressure && pressureValues.length >= 6) {
      const lo = Math.min(...pressureValues);
      const hi = Math.max(...pressureValues);
      info.pressure = hi - lo > 0.06; // varies → real digitizer
    }
    if (pressureValues.length >= 8) {
      const sorted = [...pressureValues].sort((a, b) => a - b);
      const lo = sorted[Math.floor(sorted.length * 0.05)];
      const hi = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.97))];
      info.pressureFloor = lo;
      info.pressureCeil = Math.max(hi, lo + 0.001);
    }
  } else if (e.pressure === 0) {
    info.hover = true; // motion with pressure 0 while in range = hover-capable
  }

  // ---- tilt evidence + live magnitude
  const tx = Number(e.tiltX) || 0;
  const ty = Number(e.tiltY) || 0;
  if (!tiltSeen && (Math.abs(tx) > 2 || Math.abs(ty) > 2)) tiltSeen = true;
  info.tilt = tiltSeen;
  info.tiltDeg = Math.min(90, Math.hypot(tx, ty) * 0.5);

  // ---- hardware buttons: edge detection + pattern machine
  const barrel = e.buttons & (2 | 4 | 8 | 16);
  if (barrel) {
    info.buttons |= barrel;
    if (primaryBarrelBit === 0) primaryBarrelBit = barrel & -barrel; // lowest set bit locks
  }
  if (e.buttons & 32) info.buttons |= 32;

  const writing = (e.buttons & 1) === 1 && e.pressure > 0.015;
  const curBits = bitsOf(e.buttons);
  // newly pressed bits → press/double event + long-press timer;
  // released bits → cancel their timers and record the release moment
  for (const bit of curBits) {
    if (!btnState.has(bit)) {
      const st = { downAt: now, longTimer: null as ReturnType<typeof setTimeout> | null };
      btnState.set(bit, st);
      const prevUp = btnLastUp.get(bit) ?? 0;
      if (prevUp && now - prevUp < DBL_MS) {
        emitButton(bit, 'double', writing);
      } else {
        emitButton(bit, 'press', writing);
      }
      btnLastUp.set(bit, 0);
      st.longTimer = setTimeout(() => {
        st.longTimer = null;
        emitButton(bit, 'long', writing);
      }, LONG_MS);
    }
  }
  for (const [bit, st] of [...btnState]) {
    if (!curBits.includes(bit)) {
      if (st.longTimer) { clearTimeout(st.longTimer); st.longTimer = null }
      btnLastUp.set(bit, now);
      btnState.delete(bit);
      emitButton(bit, 'release', writing);
    }
  }

  // ---- live sample feed (test pad + meters)
  const sample: PenSample = {
    pressure: e.pressure, tiltX: tx, tiltY: ty, tiltDeg: info.tiltDeg,
    hover: e.pressure === 0 && (e.buttons & 1) === 0, buttons: e.buttons, t: now,
  };
  for (const l of sampleListeners) l(sample);

  // ---- report-rate estimate (coalesced batches refine it)
  rateTs.push(now);
  if (rateTs.length > RATE_SAMPLES) rateTs.shift();
  if (rateTs.length >= 8) {
    const dts: number[] = [];
    for (let i = 1; i < rateTs.length; i++) dts.push(rateTs[i] - rateTs[i - 1]);
    dts.sort((a, b) => a - b);
    const median = dts[Math.floor(dts.length / 2)] || 1;
    if (median > 0 && median < 120) {
      const est = Math.round((1000 / median) * Math.max(1, coalescedCount));
      info.rateHz = Math.max(info.rateHz, Math.min(est, 480));
    }
  }

  const { family, label } = resolveProfile();
  info.family = family;
  info.label = label;
  info.profileId = manualProfileId ?? 'auto';
  emit();
}

/**
 * Adaptive pressure normalization: remaps the pen's observed contact
 * envelope onto the full 0–1 range (compressed bands → full response).
 * Called by the ink pipeline for every pen sample BEFORE the pressure curve.
 */
export function normalizePenPressure(raw: number): number {
  const r = clamp(raw, 0, 1);
  if (!info.detected || !info.pressure) return r;
  const lo = info.pressureFloor;
  const hi = Math.max(info.pressureCeil, 0.75); // don't over-amplify small ceilings
  if (hi - lo < 0.12) return r;                 // already (nearly) full range
  return clamp((r - lo) / (hi - lo), 0.04, 1);
}

/** Current pen profile (frozen snapshot — treat as read-only). */
export function getPenInfo(): PenInfo {
  return info;
}

/**
 * Which buttons bits route to the primary/secondary barrel shortcuts.
 * The first bit the physical pen reports locks as primary — the S Pen
 * surfaces its side button as bit 2 while hovering, Surface/MPP pens report
 * bit 4, and some Android pens use 8/16. Defaults follow the classic
 * convention (2 = primary, 4 = secondary).
 */
export function barrelMap(): { primary: number; secondary: number | null } {
  if (primaryBarrelBit !== 0) {
    const secondary = BARREL_CANDIDATES.find((b) => b !== primaryBarrelBit && (info.buttons & b) !== 0);
    return { primary: primaryBarrelBit, secondary: secondary ?? null };
  }
  return { primary: 2, secondary: 4 };
}

/** Set the manual pen profile ('auto' clears the override). */
export function setPenProfile(id: string | null): void {
  manualProfileId = id && id !== 'auto' ? id : null;
  const { family, label } = resolveProfile();
  if (info.detected) {
    info = { ...info, family, label, profileId: manualProfileId ?? 'auto' };
  }
  emit();
}

/** Subscribe to profile changes (settings sheet live updates). Returns unsubscribe. */
export function subscribePen(cb: Listener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb) };
}

/** names for the observed hardware buttons — for UI hints */
export function observedButtons(): string[] {
  const out: string[] = [];
  if (info.buttons & (2 | 4 | 8 | 16)) out.push('barrel');
  if (barrelMap().secondary) out.push('second');
  if (info.buttons & 32) out.push('eraser');
  return out;
}

/** reset all engine state (used when the editor closes / test hooks) */
export function resetPenEngine(): void {
  info = { ...NO_PEN };
  rateTs = [];
  pressureValues = [];
  tiltSeen = false;
  primaryBarrelBit = 0;
  profiledPointerId = null;
  resetButtonPatterns(0);
  btnLastUp.clear();
  emit();
}
