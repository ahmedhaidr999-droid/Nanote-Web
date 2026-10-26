// Nanote Pen Engine v2 — stylus identification + hardware-capability tracking.
//
// Every pen PointerEvent the editor receives is fed to observePenEvent().
// The engine accumulates evidence (pressure behaviour, tilt, in-range hover,
// hardware button bits, coalesced-sample rate) and classifies the pen into a
// family, exposing:
//   • a human-readable label — resolved against the PEN_MODELS registry
//     (Apple Pencil, Samsung S Pen / Wacom EMR, USI, MPP/Surface, and the
//     Android-vendor pens: Xiaomi Smart Pen, Huawei M-Pencil, Honor Magic
//     Pencil, OnePlus Stylo, OPPO Pen, vivo Pencil, realme Pen, Lenovo…) with
//     optional manual override ("Pen & input" sheet → Pen model);
//   • live capability flags — which hardware inputs actually exist on THIS
//     pen (barrel button, second button, eraser end, pressure, tilt, hover,
//     report rate) — so the Pen & input settings can coordinate the shortcut
//     mapping with the pen the user is actually holding;
//   • ADAPTIVE PRESSURE CALIBRATION — many digitizers report pressure in a
//     compressed band (a Huawei M-Pencil might never leave 0.18–0.72; some
//     USI pens floor at 0.12). The engine tracks the observed contact
//     envelope and normalizePenPressure() remaps it to the full 0–1 range,
//     so every pen's light/heavy stroke response is correct;
//   • BARREL-BIT AUTO-MAPPING — vendors surface the side button on different
//     PointerEvent.buttons bits (S Pen hover → bit 2, Surface/MPP barrel →
//     bit 4, some Android pens → 8/16). The engine locks the FIRST bit the
//     physical pen actually reports as the primary barrel and routes the
//     shortcut accordingly, so "the pen button" works no matter which bit it
//     arrives on.
//
// Why an engine: the browser only exposes raw PointerEvents. Different pen
// families surface their hardware differently. Sampling and classifying those
// signals once — instead of scattering heuristics through the input handlers —
// lets the app "read" any pen and wire its real buttons to the user's
// shortcuts.
//
// Pure client-side, zero dependencies, safe on every platform (all access is
// guarded; SSR/private-mode must never throw).

import { clamp } from './util';

export type PenFamily =
  | 'apple-pencil'
  | 'emr'        // Samsung S Pen & other Wacom EMR pens
  | 'usi'        // Chromebook USI styluses
  | 'mpp'        // Microsoft Pen Protocol (Surface, Lenovo, HP…)
  | 'vendor'     // identified Android-vendor pen (Xiaomi / Huawei / Honor…)
  | 'generic'    // active stylus, family unknown
  | 'none';

// ---------------------------------------------------------------- pen model registry
/**
 * Known stylus models. The browser cannot read USB/BLE vendor IDs, so
 * detection combines platform + report signals + Android UA device markers
 * (tablet models usually appear in the UA string) — and the user can always
 * pick their exact pen in Pen & input, which also tunes the shortcut hints.
 */
export interface PenModel {
  id: string;
  vendor: string;
  name: string;
  nameAr: string;
  protocol: 'emr' | 'usi' | 'mpp' | 'apple' | 'wgp' | 'vendor-bt';
  buttons: number;        // physical barrel buttons (excluding tip & eraser end)
  eraserEnd: boolean;     // dedicated eraser cap/end
  pressureLevels: number; // 0 = none
  tilt: boolean;
  hover: boolean;
  bodyDoubleTap: boolean; // double-tap gesture on the pen body (Bluetooth)
  ua?: RegExp;            // Android UA device markers for auto-detection
}

export const PEN_MODELS: PenModel[] = [
  // ---- Apple
  { id: 'apple-pencil-usb', vendor: 'Apple', name: 'Apple Pencil (USB‑C)', nameAr: 'آبل بنسل (USB‑C)', protocol: 'apple', buttons: 0, eraserEnd: false, pressureLevels: 0, tilt: false, hover: true, bodyDoubleTap: false },
  { id: 'apple-pencil-1', vendor: 'Apple', name: 'Apple Pencil (1st gen)', nameAr: 'آبل بنسل (الجيل الأول)', protocol: 'apple', buttons: 0, eraserEnd: false, pressureLevels: 0, tilt: false, hover: false, bodyDoubleTap: false },
  { id: 'apple-pencil-2', vendor: 'Apple', name: 'Apple Pencil (2nd gen)', nameAr: 'آبل بنسل (الجيل الثاني)', protocol: 'apple', buttons: 0, eraserEnd: false, pressureLevels: 0, tilt: true, hover: true, bodyDoubleTap: true },
  // ---- Samsung
  { id: 's-pen-tab', vendor: 'Samsung', name: 'S Pen (Galaxy Tab)', nameAr: 'قلم S Pen (جالكسي تاب)', protocol: 'emr', buttons: 1, eraserEnd: false, pressureLevels: 4096, tilt: true, hover: true, bodyDoubleTap: false, ua: /SM-(T|P|X9|X8)/ },
  { id: 's-pen-phone', vendor: 'Samsung', name: 'S Pen (Galaxy Note/Ultra)', nameAr: 'قلم S Pen (نوت / ألترا)', protocol: 'emr', buttons: 1, eraserEnd: false, pressureLevels: 4096, tilt: true, hover: true, bodyDoubleTap: true, ua: /SM-(N|S9|S1)/ },
  // ---- Xiaomi
  { id: 'xiaomi-smart-pen-2', vendor: 'Xiaomi', name: 'Xiaomi Smart Pen (2nd gen)', nameAr: 'قلم شاومي الذكي (الجيل الثاني)', protocol: 'wgp', buttons: 1, eraserEnd: false, pressureLevels: 8192, tilt: true, hover: true, bodyDoubleTap: true, ua: /\b(Mi\s|Redmi|POCO|Mix|2212|2202|Pad\s?[56])/ },
  { id: 'xiaomi-smart-pen', vendor: 'Xiaomi', name: 'Xiaomi Smart Pen', nameAr: 'قلم شاومي الذكي', protocol: 'wgp', buttons: 1, eraserEnd: false, pressureLevels: 4096, tilt: false, hover: false, bodyDoubleTap: false, ua: /\b(Mi\s|Redmi|POCO|Pad\s?5)/ },
  // ---- Huawei
  { id: 'huawei-mpencil-3', vendor: 'Huawei', name: 'Huawei M‑Pencil (3rd gen)', nameAr: 'قلم هواوي M‑Pencil (الجيل الثالث)', protocol: 'vendor-bt', buttons: 1, eraserEnd: false, pressureLevels: 4096, tilt: true, hover: true, bodyDoubleTap: true, ua: /(HUAWEI|Huawei|HW-|HarmonyOS)/ },
  { id: 'huawei-mpencil-2', vendor: 'Huawei', name: 'Huawei M‑Pencil (2nd gen)', nameAr: 'قلم هواوي M‑Pencil (الجيل الثاني)', protocol: 'vendor-bt', buttons: 1, eraserEnd: false, pressureLevels: 4096, tilt: true, hover: false, bodyDoubleTap: true, ua: /(HUAWEI|Huawei|HW-|HarmonyOS)/ },
  { id: 'huawei-mpencil', vendor: 'Huawei', name: 'Huawei M‑Pencil', nameAr: 'قلم هواوي M‑Pencil', protocol: 'vendor-bt', buttons: 1, eraserEnd: false, pressureLevels: 4096, tilt: false, hover: false, bodyDoubleTap: false, ua: /(HUAWEI|Huawei|HW-)/ },
  // ---- Honor
  { id: 'honor-magic-pencil-3', vendor: 'Honor', name: 'Honor Magic Pencil 3', nameAr: 'قلم هونر ماجيك 3', protocol: 'vendor-bt', buttons: 1, eraserEnd: false, pressureLevels: 4096, tilt: true, hover: true, bodyDoubleTap: true, ua: /(HONOR|honor|HonorOS|MagicOS)/ },
  { id: 'honor-magic-pencil-2', vendor: 'Honor', name: 'Honor Magic Pencil 2', nameAr: 'قلم هونر ماجيك 2', protocol: 'vendor-bt', buttons: 1, eraserEnd: false, pressureLevels: 4096, tilt: false, hover: false, bodyDoubleTap: true, ua: /(HONOR|honor)/ },
  // ---- OnePlus / OPPO / vivo / realme
  { id: 'oneplus-stylo-2', vendor: 'OnePlus', name: 'OnePlus Stylo 2', nameAr: 'قلم ون بلس ستايلو 2', protocol: 'wgp', buttons: 1, eraserEnd: false, pressureLevels: 4096, tilt: true, hover: true, bodyDoubleTap: true, ua: /(OnePlus|OPD2|OP4)/ },
  { id: 'oppo-pen', vendor: 'OPPO', name: 'OPPO Pen', nameAr: 'قلم أوبو', protocol: 'wgp', buttons: 1, eraserEnd: false, pressureLevels: 4096, tilt: true, hover: false, bodyDoubleTap: true, ua: /(OPPO|OPD2|PAD)/ },
  { id: 'vivo-pen-2', vendor: 'vivo', name: 'vivo Pencil 2', nameAr: 'قلم فيفو 2', protocol: 'wgp', buttons: 1, eraserEnd: false, pressureLevels: 4096, tilt: true, hover: true, bodyDoubleTap: true, ua: /(vivo|V2[0-9]{3}A|PAD)/ },
  { id: 'realme-pen', vendor: 'realme', name: 'realme Pen', nameAr: 'قلم ريلمي', protocol: 'wgp', buttons: 1, eraserEnd: false, pressureLevels: 4096, tilt: true, hover: false, bodyDoubleTap: true, ua: /(realme|RMX)/ },
  // ---- Lenovo / Google
  { id: 'lenovo-tab-pen', vendor: 'Lenovo', name: 'Lenovo Tab Pen Plus', nameAr: 'قلم لينوفو تاب', protocol: 'emr', buttons: 2, eraserEnd: true, pressureLevels: 4096, tilt: true, hover: true, bodyDoubleTap: false, ua: /(Lenovo|TB-|TB3)/ },
  { id: 'pixel-stylus', vendor: 'Google', name: 'Pixel Tablet Pen', nameAr: 'قلم جوجل بيكسل', protocol: 'usi', buttons: 1, eraserEnd: false, pressureLevels: 2048, tilt: false, hover: false, bodyDoubleTap: false, ua: /(Pixel|GT52)/ },
  // ---- Microsoft / MPP
  { id: 'surface-slim-2', vendor: 'Microsoft', name: 'Surface Slim Pen 2', nameAr: 'سيرفيس سليم بن 2', protocol: 'mpp', buttons: 1, eraserEnd: true, pressureLevels: 4096, tilt: true, hover: true, bodyDoubleTap: false },
  { id: 'surface-pen', vendor: 'Microsoft', name: 'Surface Pen (MPP)', nameAr: 'قلم سيرفيس (MPP)', protocol: 'mpp', buttons: 1, eraserEnd: true, pressureLevels: 4096, tilt: true, hover: true, bodyDoubleTap: false },
  // ---- Wacom / USI
  { id: 'wacom-one', vendor: 'Wacom', name: 'Wacom One Pen', nameAr: 'قلم واكوم ون', protocol: 'emr', buttons: 2, eraserEnd: true, pressureLevels: 4096, tilt: true, hover: true, bodyDoubleTap: false },
  { id: 'usi-generic', vendor: 'USI', name: 'USI Stylus', nameAr: 'قلم USI', protocol: 'usi', buttons: 1, eraserEnd: false, pressureLevels: 2048, tilt: false, hover: true, bodyDoubleTap: false },
];

export function penModelById(id: string | null | undefined): PenModel | null {
  if (!id || id === 'auto') return null;
  return PEN_MODELS.find((m) => m.id === id) ?? null;
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
  maxPressure: 0, pressureFloor: 0, pressureCeil: 1, tilt: false, hover: false,
  buttons: 0, rateHz: 0, lastSeen: 0,
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

// multiple pointers: remember which pen pointerId we are profiling (a second
// pen swapped mid-session re-seeds the profile)
let profiledPointerId: number | null = null;

// barrel-bit auto-mapping: vendors surface the side button on different
// PointerEvent.buttons bits (S Pen hover → 2, Surface/MPP → 4, some Android
// pens → 8/16). The FIRST bit the physical pen reports locks as the primary
// barrel; other observed barrel bits route to the secondary shortcut.
const BARREL_CANDIDATES = [2, 4, 8, 16] as const;
let primaryBarrelBit = 0; // 0 = not locked yet

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

function uaVendorModel(): PenModel | null {
  try {
    const ua = navigator.userAgent;
    const plat = platform();
    if (plat === 'ios') {
      if (/Pencil/.test(ua)) return PEN_MODELS.find((m) => m.id === 'apple-pencil-2') ?? null;
      return null; // Apple Pencil family handled by classify()
    }
    if (plat !== 'android') return null;
    for (const m of PEN_MODELS) {
      if (m.ua && m.ua.test(ua)) return m;
    }
  } catch { /* guarded */ }
  return null;
}

/** resolve the current label/family against the registry + evidence */
function resolveProfile(): { family: PenFamily; label: string; model: PenModel | null } {
  const manual = penModelById(manualProfileId);
  if (manual) {
    const fam: PenFamily =
      manual.protocol === 'apple' ? 'apple-pencil'
      : manual.protocol === 'emr' ? 'emr'
      : manual.protocol === 'usi' ? 'usi'
      : manual.protocol === 'mpp' ? 'mpp'
      : 'vendor';
    return { family: fam, label: manual.name, model: manual };
  }
  const plat = platform();
  const highRate = info.rateHz >= 110;
  const vendor = uaVendorModel();
  if (vendor) {
    // the device markers say which pen family the tablet takes — trust them
    // (the physical pen is that vendor's, or a compatible clone)
    const fam: PenFamily =
      vendor.protocol === 'emr' ? 'emr'
      : vendor.protocol === 'usi' ? 'usi'
      : vendor.protocol === 'apple' ? 'apple-pencil'
      : 'vendor';
    return { family: fam, label: vendor.name, model: vendor };
  }
  switch (plat) {
    case 'ios':
      return { family: 'apple-pencil', label: 'Apple Pencil', model: null };
    case 'cros':
      return { family: 'usi', label: 'USI stylus', model: null };
    case 'windows':
      // Windows pens: MPP/Slim report buttons (incl. eraser bit 32) + tilt
      return { family: 'mpp', label: 'MPP stylus (Surface / Slim Pen)', model: null };
    case 'android':
      // hover + high report rate = Wacom EMR digitizer (Galaxy S Pen, Lenovo…)
      if (info.hover && highRate) return { family: 'emr', label: 'Samsung S Pen / Wacom EMR', model: null };
      if (info.hover) return { family: 'emr', label: 'EMR stylus', model: null };
      if (info.buttons) return { family: 'generic', label: 'Active stylus (buttons)', model: null };
      return { family: 'generic', label: 'Active stylus', model: null };
    default:
      if (info.buttons) return { family: 'generic', label: 'Active stylus (buttons)', model: null };
      return { family: 'generic', label: 'Active stylus', model: null };
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
    info = { ...NO_PEN, detected: true, lastSeen: now, profileId: manualProfileId ?? 'auto' };
    rateTs = [];
    pressureValues = [];
    tiltSeen = false;
    primaryBarrelBit = 0;
    profiledPointerId = e.pointerId;
  }
  info.lastSeen = now;

  // ---- pressure evidence (contact only; hover reports 0). Track the
  // envelope for adaptive calibration: many digitizers report a compressed
  // band (never near 0 at light touch, never near 1 at full press).
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
      // robust envelope: ignore single-sample spikes at both ends
      const lo = sorted[Math.floor(sorted.length * 0.05)];
      const hi = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.97))];
      info.pressureFloor = lo;
      info.pressureCeil = Math.max(hi, lo + 0.001);
    }
  } else if (e.pressure === 0) {
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

  // ---- hardware buttons (barrel candidates 2/4/8/16, eraser end = 32;
  // bit 1 is the tip contact itself and is not a "button")
  const barrel = e.buttons & (2 | 4 | 8 | 16);
  if (barrel) {
    info.buttons |= barrel;
    if (primaryBarrelBit === 0) primaryBarrelBit = barrel & -barrel; // lowest set bit
  }
  if (e.buttons & 32) info.buttons |= 32;

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

  const { family, label } = resolveProfile();
  info.family = family;
  info.label = label;
  info.profileId = manualProfileId ?? 'auto';
  emit();
}

/**
 * Adaptive pressure normalization: remaps the pen's observed contact
 * envelope onto the full 0–1 range. Pens already reporting the full range
 * pass through unchanged (floor≈0, ceil≥0.75). Called by the ink pipeline
 * for every pen sample BEFORE the pressure curve — light touches go thin,
 * hard presses go bold, on every digitizer.
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
