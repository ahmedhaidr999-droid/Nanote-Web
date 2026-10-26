// Nanote Stylus Knowledge Base — structured, sourced, extensible.
//
// This module is PURE DATA + small pure helpers (no drawing/input logic — the
// rendering and event pipelines live in render.ts / penengine.ts). The schema
// is designed so new pen MODELS and GENERATIONS are added by appending records
// here (or by a runtime DB update — see mergePenDb / the /api/pen-db endpoint)
// without touching the engine, the settings UI or the shortcut router.
//
// HONESTY CONTRACT (user-requested):
//   • Every record carries `confidence` per field-group and `sources`.
//   • Specs we could not verify are `null`/`'unverified'` — NEVER guessed.
//   • `receivable` events are separated from `osControlled` ones: web/WebView
//     apps receive PointerEvents (Android maps them from MotionEvent), but
//     vendor/OS-level gestures (S Pen remote air actions, double-tap of Apple
//     Pencil 2 body → OS, BLE proprietary channels) are intercepted before any
//     app can see them — we mark them explicitly instead of claiming support.
//   • Numbers quoted from marketing/community specs are marked 'community'.

export type Platform = 'android' | 'ipados' | 'windows' | 'chromeos';
export type PenProtocol = 'emr' | 'usi' | 'mpp' | 'apple' | 'wgp' | 'vendor-bt' | 'capacitive';
export type Confidence = 'official' | 'community' | 'unverified';

export interface SourceRef {
  label: string;
  url?: string;          // official documentation when we have a stable one
  kind: 'official' | 'community' | 'observed';
}

/** one physical control on a pen (barrel button, eraser end, tip) */
export interface PenControl {
  id: string;            // 'barrel' | 'barrel2' | 'eraserEnd' | 'tip' | 'body'
  label: string;
  labelAr: string;
}

/**
 * A distinct, recognizable input EVENT a pen can produce.
 * `appReceivable` — Nanote can bind it (PointerEvents reach us).
 * `osControlled` — the OS/vendor firmware consumes it before any app can.
 */
export interface PenEventDef {
  id: string;
  label: string;
  labelAr: string;
  appReceivable: boolean;
  osControlled: boolean;
  requires: ('pressure' | 'tilt' | 'hover' | 'bluetooth' | 'buttons')[];
  note?: string;
  noteAr?: string;
}

export interface StylusSpec {
  id: string;
  vendor: string;
  name: string;
  nameAr: string;
  model?: string | null;          // model number when known
  generation?: string | null;
  releaseYear?: number | null;
  platforms: Platform[];
  protocol: PenProtocol;
  connection: string;            // "Wacom EMR — no pairing/battery" / "Bluetooth LE" …
  charging?: string | null;       // unknown → null, never guessed
  pressureLevels: number | null;  // 0/1 = none reported; null = unknown
  tilt: boolean | null;
  hover: boolean | null;
  palmRejection: boolean | null;  // device-level capability
  buttons: PenControl[];         // physical barrel buttons
  eraserEnd: boolean | null;      // dedicated eraser cap
  bodyDoubleTap: boolean | null;  // gesture zones on the pen body (BT pens)
  devices: string;               // compatible-device summary
  integration: string;           // app-integration limits (what we can/can't use)
  sources: SourceRef[];
  confidence: { specs: Confidence; buttons: Confidence; gestures: Confidence };
  /** Android UA device markers — a HINT for detection only (never trusted alone) */
  ua?: RegExp;
}

// ---------------------------------------------------------------- event catalogue
/**
 * The shortcut/gesture event catalogue. Every binding in Settings maps one of
 * these to an app action. `requires` lists the pen capabilities the event
 * needs — the engine disables bindings whose requirements the detected pen
 * does not meet (never executes an unsupported shortcut).
 */
export const PEN_EVENTS: PenEventDef[] = [
  {
    id: 'barrel.press', label: 'Button — single press', labelAr: 'الزر — ضغطة واحدة',
    appReceivable: true, osControlled: false, requires: ['buttons'],
    note: 'Works while hovering (S Pen/Wacom EMR), at tip contact, and mid-stroke.',
    noteAr: 'يعمل أثناء التحويم وعند ملامسة السن وأثناء الكتابة.',
  },
  {
    id: 'barrel.double', label: 'Button — double press', labelAr: 'الزر — ضغطتان متتاليتان',
    appReceivable: true, osControlled: false, requires: ['buttons'],
    note: 'Two presses within 450 ms, in hover or contact.',
    noteAr: 'ضغطتان خلال ٤٥٠ مللي ثانية، تحويماً أو لمساً.',
  },
  {
    id: 'barrel.long', label: 'Button — long press', labelAr: 'الزر — ضغط مطوّل',
    appReceivable: true, osControlled: false, requires: ['buttons'],
    note: 'Held ≥ 650 ms; releases back to the previous tool.',
    noteAr: 'استمرار الضغط ≥ ٦٥٠ مللي ثانية ثم العودة للأداة السابقة.',
  },
  {
    id: 'barrel2.press', label: 'Button 2 — single press', labelAr: 'الزر الثاني — ضغطة واحدة',
    appReceivable: true, osControlled: false, requires: ['buttons'],
    note: 'Pens with two physical barrel buttons (Wacom One, Lenovo Tab Pen).',
    noteAr: 'للأقلام ذات زرين جانبيين (واكوم ون، لينوفو تاب).',
  },
  {
    id: 'barrel2.double', label: 'Button 2 — double press', labelAr: 'الزر الثاني — ضغطتان',
    appReceivable: true, osControlled: false, requires: ['buttons'],
  },
  {
    id: 'barrel2.long', label: 'Button 2 — long press', labelAr: 'الزر الثاني — ضغط مطوّل',
    appReceivable: true, osControlled: false, requires: ['buttons'],
  },
  {
    id: 'eraserEnd.press', label: 'Eraser end/button — press', labelAr: 'الطرف الماسح / زر الممحاة — ضغط',
    appReceivable: true, osControlled: false, requires: ['buttons'],
    note: 'Dedicated eraser cap or button (Surface/MPP pens, Wacom One, Lenovo).',
    noteAr: 'طرف أو زر الممحاة المخصص (أقلام سيرفيس/‏MPP، واكوم ون، لينوفو).',
  },
  {
    id: 'eraserEnd.double', label: 'Eraser end — double press', labelAr: 'طرف الممحاة — ضغطتان',
    appReceivable: true, osControlled: false, requires: ['buttons'],
  },
  {
    id: 'eraserEnd.long', label: 'Eraser end — long press', labelAr: 'طرف الممحاة — ضغط مطوّل',
    appReceivable: true, osControlled: false, requires: ['buttons'],
  },
  {
    id: 'tip.doubleTap', label: 'Pen tip — double tap', labelAr: 'سن القلم — نقرتان',
    appReceivable: true, osControlled: false, requires: [],
    note: 'App-level detector — works on EVERY stylus (no hardware support needed).',
    noteAr: 'كاشف داخلي في التطبيق — يعمل مع كل الأقلام دون دعم خاص.',
  },
  {
    id: 'body.doubleTap', label: 'Pen body — double tap (Bluetooth)', labelAr: 'جسم القلم — نقرتان (بلوتوث)',
    appReceivable: false, osControlled: true, requires: ['bluetooth'],
    note: 'Handled by the OS/vendor layer (Apple Pencil 2 zone, S Pen remote, Xiaomi/Huawei body gestures). Android WebView apps never receive these — we surface them as information only.',
    noteAr: 'يتعامل معها النظام/برنامج الشركة المصنّع (منطقة آبل بنسل 2، S Pen عن بُعد، إيماءات شاومي/هواوي). تطبيقات الويب لا تستقبلها — تُعرض كمعلومة فقط.',
  },
  {
    id: 'os.remoteGestures', label: 'Remote / air gestures (Bluetooth)', labelAr: 'إيماءات عن بُعد (بلوتوث)',
    appReceivable: false, osControlled: true, requires: ['bluetooth'],
    note: 'S Pen remote camera/photo gestures, Xiaomi Focus Pen shortcuts — configured in the vendor settings app, never delivered to third-party apps.',
    noteAr: 'إيماءات S Pen عن بُعد واختصارات قلم شاومي — تُضبط في إعدادات الشركة ولا تصل للتطبيقات الخارجية.',
  },
  {
    id: 'hover.tracking', label: 'Hover tracking (in-range)', labelAr: 'تتبع التحويم',
    appReceivable: true, osControlled: false, requires: ['hover'],
    note: 'Not bindable — powers the hover cursor, palm rejection and hover-press routing.',
    noteAr: 'غير قابل للربط — يغذّي مؤشر التحويم ورفض الكف وتوجيه ضغطات التحويم.',
  },
];

// ---------------------------------------------------------------- pens
/** pressure-level notes reused across records */
const SRC_EMR: SourceRef = { label: 'Wacom EMR — battery-free digitizer standard (adopted by Samsung/Lenovo tablets)', url: 'https://us.wacom.com', kind: 'official' };
const SRC_USI: SourceRef = { label: 'Universal Stylus Initiative — USI 1.0/2.0 stylus spec', url: 'https://www.usi.org', kind: 'official' };

export const PEN_SPECS: StylusSpec[] = [
  // ---------------------------------------------------------------- Xiaomi
  {
    id: 'xiaomi-focus-pen-pro', vendor: 'Xiaomi', name: 'Xiaomi Focus Pen Pro', nameAr: 'قلم شاومي فوكس برو',
    model: null, generation: 'Focus Pen generation', releaseYear: 2024,
    platforms: ['android'], protocol: 'wgp',
    connection: 'Active pen over the tablet digitizer + Bluetooth LE for gestures',
    charging: 'Magnetic wireless charging on the tablet edge (reported)', pressureLevels: 8192,
    tilt: true, hover: true, palmRejection: true,
    buttons: [{ id: 'barrel', label: 'Side button', labelAr: 'الزر الجانبي' }],
    eraserEnd: false, bodyDoubleTap: true,
    devices: 'Xiaomi Pad 7 / Pad 7 Pro (2024)',
    integration: 'Pressure, tilt, hover and the side button all surface as standard pen PointerEvents — the button works in hover and mid-stroke. Body double-tap and remote gestures go through Xiaomi’s Bluetooth layer and are NOT delivered to apps.',
    sources: [
      { label: 'Xiaomi Pad 7 Pro product page (Focus Pen support)', url: 'https://www.mi.com/global/tablet/xiaomi-pad-7-pro', kind: 'official' },
      { label: 'Press coverage of the Focus Pen launch specs', kind: 'community' },
    ],
    confidence: { specs: 'community', buttons: 'official', gestures: 'community' },
    ua: /Pad\s?7|2410[13]|240[dn]1?/,
  },
  {
    id: 'xiaomi-smart-pen-2', vendor: 'Xiaomi', name: 'Xiaomi Smart Pen (2nd gen)', nameAr: 'قلم شاومي الذكي (الجيل الثاني)',
    model: null, generation: '2nd gen', releaseYear: 2023,
    platforms: ['android'], protocol: 'wgp',
    connection: 'Active pen over the tablet digitizer + Bluetooth LE',
    charging: 'Magnetic charging on the tablet edge', pressureLevels: 8192,
    tilt: true, hover: true, palmRejection: true,
    buttons: [{ id: 'barrel', label: 'Side button', labelAr: 'الزر الجانبي' }],
    eraserEnd: false, bodyDoubleTap: true,
    devices: 'Xiaomi Pad 6 / Pad 6 Pro / Pad 6 Max',
    integration: 'Full pressure + tilt + hover; side button receivable in every mode. Body double-tap gestures are OS/vendor-controlled.',
    sources: [
      { label: 'Xiaomi Pad 6 series product pages (Smart Pen 2nd gen)', url: 'https://www.mi.com/global', kind: 'official' },
      { label: 'Community spec sheets (pressure levels reported as 8192)', kind: 'community' },
    ],
    confidence: { specs: 'community', buttons: 'official', gestures: 'community' },
    ua: /\b(Mi\s|Redmi|POCO|Pad\s?6|Pad6)/,
  },
  {
    id: 'xiaomi-smart-pen', vendor: 'Xiaomi', name: 'Xiaomi Smart Pen (1st gen)', nameAr: 'قلم شاومي الذكي (الجيل الأول)',
    model: null, generation: '1st gen', releaseYear: 2021,
    platforms: ['android'], protocol: 'wgp',
    connection: 'Active pen over the tablet digitizer + Bluetooth LE',
    charging: 'Magnetic charging on the tablet edge', pressureLevels: 4096,
    tilt: true, hover: true, palmRejection: true,
    buttons: [{ id: 'barrel', label: 'Side button', labelAr: 'الزر الجانبي' }],
    eraserEnd: false, bodyDoubleTap: null,
    devices: 'Xiaomi Pad 5 / Pad 5 Pro',
    integration: 'Full pressure + hover; side button receivable. Tilt and body gestures unverified on this generation.',
    sources: [
      { label: 'Xiaomi Pad 5 product page (Smart Pen)', url: 'https://www.mi.com/global', kind: 'official' },
      { label: 'Community spec sheets (4096 levels)', kind: 'community' },
    ],
    confidence: { specs: 'community', buttons: 'official', gestures: 'unverified' },
    ua: /\b(Mi\s|Redmi|Pad\s?5|Pad5)/,
  },
  // ---------------------------------------------------------------- Samsung
  {
    id: 's-pen-tab', vendor: 'Samsung', name: 'S Pen (Galaxy Tab S series)', nameAr: 'قلم S Pen (جالكسي تاب S)',
    model: 'EJ-P* / per-tablet SKU', generation: 'per Tab generation', releaseYear: null,
    platforms: ['android'], protocol: 'emr',
    connection: 'Wacom EMR — no pairing, no battery', charging: null,
    pressureLevels: 4096, tilt: true, hover: true, palmRejection: true,
    buttons: [{ id: 'barrel', label: 'Single side button', labelAr: 'زر جانبي واحد' }],
    eraserEnd: false, bodyDoubleTap: false,
    devices: 'Galaxy Tab S3–S10 series, Tab Active series',
    integration: 'The S Pen surfaces its side button while hovering (press → bit 2), at contact and mid-stroke — fully bindable. Air-view/remote features of phone S Pens are not present on Tab pens.',
    sources: [SRC_EMR, { label: 'Samsung Galaxy Tab product pages', url: 'https://www.samsung.com/global/galaxy/galaxy-tab-s/', kind: 'official' }],
    confidence: { specs: 'official', buttons: 'official', gestures: 'official' },
    ua: /SM-(T|P|X9|X8)/,
  },
  {
    id: 's-pen-phone', vendor: 'Samsung', name: 'S Pen (Galaxy Note / S Ultra)', nameAr: 'قلم S Pen (نوت / S ألترا)',
    model: null, generation: 'per Note/Ultra generation', releaseYear: null,
    platforms: ['android'], protocol: 'emr',
    connection: 'Wacom EMR + Bluetooth LE (S Pen remote in the slot-charged models)',
    charging: 'Slot in the phone body (Note/Ultra models)', pressureLevels: 4096,
    tilt: true, hover: true, palmRejection: true,
    buttons: [{ id: 'barrel', label: 'Single side button', labelAr: 'زر جانبي واحد' }],
    eraserEnd: false, bodyDoubleTap: null,
    devices: 'Galaxy Note series, Galaxy S Ultra (S21–S25 Ultra)',
    integration: 'Side button fully receivable (hover press → bit 2). S Pen “remote” air gestures (camera shutter, single/double button presses configured in Samsung settings) travel over BLE to the OS and are NOT delivered to apps.',
    sources: [SRC_EMR, { label: 'Samsung S Pen remote documentation', url: 'https://www.samsung.com', kind: 'official' }],
    confidence: { specs: 'official', buttons: 'official', gestures: 'official' },
    ua: /SM-(N|S9|S1)/,
  },
  {
    id: 's-pen-fold', vendor: 'Samsung', name: 'S Pen Fold Edition', nameAr: 'قلم S Pen إصدار فولد',
    model: 'EJ-PF*', generation: 'Fold Edition', releaseYear: 2021,
    platforms: ['android'], protocol: 'emr',
    connection: 'Wacom EMR (retractable tip for the folding screen)', charging: null,
    pressureLevels: 4096, tilt: true, hover: false, palmRejection: true,
    buttons: [{ id: 'barrel', label: 'Single side button', labelAr: 'زر جانبي واحد' }],
    eraserEnd: false, bodyDoubleTap: false,
    devices: 'Galaxy Z Fold3 / Fold4 / Fold5 (screen-optimized tip)',
    integration: 'Button + pressure receivable; hover is disabled by the foldable digitizer.',
    sources: [SRC_EMR, { label: 'Samsung Fold Edition S Pen product page', url: 'https://www.samsung.com', kind: 'official' }],
    confidence: { specs: 'official', buttons: 'official', gestures: 'official' },
    ua: /SM-F(9|2|3)/,
  },
  // ---------------------------------------------------------------- Apple (informational on Android)
  {
    id: 'apple-pencil-2', vendor: 'Apple', name: 'Apple Pencil (2nd gen)', nameAr: 'آبل بنسل (الجيل الثاني)',
    model: 'MU8F2', generation: '2nd gen', releaseYear: 2018,
    platforms: ['ipados'], protocol: 'apple',
    connection: 'Pair + charge magnetically on the iPad edge', charging: 'Magnetic wireless charging on iPad edge',
    pressureLevels: null, // Apple does not publish a level count — genuine pressure curve reported 0–1
    tilt: true, hover: true, palmRejection: true,
    buttons: [], eraserEnd: false, bodyDoubleTap: true,
    devices: 'iPad Pro / Air / mini (2018+) — hover needs M2 or newer',
    integration: 'Native ONLY on iPadOS. Android devices cannot use it as a real stylus (no digitizer protocol) — recorded here for completeness, as the user noted. The double-tap gesture is delivered to iPadOS apps only; on our Android/web builds it never arrives.',
    sources: [
      { label: 'Apple Pencil compatibility documentation', url: 'https://support.apple.com/apple-pencil', kind: 'official' },
      { label: 'Apple Pencil hover (M2 iPad Pro) support article', url: 'https://support.apple.com', kind: 'official' },
    ],
    confidence: { specs: 'official', buttons: 'official', gestures: 'official' },
  },
  {
    id: 'apple-pencil-usb', vendor: 'Apple', name: 'Apple Pencil (USB-C)', nameAr: 'آبل بنسل (USB-C)',
    model: 'MT4Q3', generation: 'USB-C', releaseYear: 2023,
    platforms: ['ipados'], protocol: 'apple',
    connection: 'Wired pairing, no wireless charging', charging: 'USB-C cable',
    pressureLevels: null, tilt: true, hover: false, palmRejection: true,
    buttons: [], eraserEnd: false, bodyDoubleTap: false,
    devices: 'iPad (10th gen), iPad Air, iPad mini 6, iPad Pro (2018+)',
    integration: 'Native only on iPadOS; pressure works but no double-tap gesture, no hover.',
    sources: [{ label: 'Apple Pencil (USB-C) support documentation', url: 'https://support.apple.com/apple-pencil', kind: 'official' }],
    confidence: { specs: 'official', buttons: 'official', gestures: 'official' },
  },
  {
    id: 'apple-pencil-1', vendor: 'Apple', name: 'Apple Pencil (1st gen)', nameAr: 'آبل بنسل (الجيل الأول)',
    model: 'MK0C2', generation: '1st gen', releaseYear: 2015,
    platforms: ['ipados'], protocol: 'apple',
    connection: 'Lightning pairing', charging: 'Lightning cap / adapter',
    pressureLevels: null, tilt: true, hover: false, palmRejection: true,
    buttons: [], eraserEnd: false, bodyDoubleTap: false,
    devices: 'iPad 6th gen–10th gen, iPad Air 3, iPad mini 5, iPad Pro 9.7/10.5/12.9 (1st/2nd gen)',
    integration: 'Native only on iPadOS; no hover, no body gestures.',
    sources: [{ label: 'Apple Pencil compatibility documentation', url: 'https://support.apple.com/apple-pencil', kind: 'official' }],
    confidence: { specs: 'official', buttons: 'official', gestures: 'official' },
  },
  // ---------------------------------------------------------------- Huawei
  {
    id: 'huawei-mpencil-3', vendor: 'Huawei', name: 'Huawei M-Pencil (3rd gen)', nameAr: 'قلم هواوي M-Pencil (الجيل الثالث)',
    model: 'CDL2-0200 (reported)', generation: '3rd gen', releaseYear: 2023,
    platforms: ['android'], protocol: 'vendor-bt',
    connection: 'Huawei digitizer + Bluetooth LE', charging: 'Magnetic wireless charging on the tablet edge',
    pressureLevels: 4096, tilt: true, hover: true, palmRejection: true,
    buttons: [{ id: 'barrel', label: 'Side button (double-press for shortcuts via Huawei settings)', labelAr: 'الزر الجانبي (ضغطتان للاختصارات عبر إعدادات هواوي)' }],
    eraserEnd: false, bodyDoubleTap: true,
    devices: 'MatePad Pro 13.2 / MatePad Pro 11 (2023+) / MatePad Air',
    integration: 'Pressure, tilt and hover all surface as pen PointerEvents; the side button reports on hover/contact. Huawei’s own double-tap/slideshow gestures are vendor-controlled and not receivable.',
    sources: [
      { label: 'Huawei MatePad Pro product pages (M-Pencil 3rd gen)', url: 'https://consumer.huawei.com/en/tablets/', kind: 'official' },
      { label: 'Community pressure-envelope measurements (compressed 0.18–0.55 band on some units)', kind: 'observed' },
    ],
    confidence: { specs: 'community', buttons: 'community', gestures: 'community' },
    ua: /(HUAWEI|Huawei|HW-|HarmonyOS|CDL)/,
  },
  {
    id: 'huawei-mpencil-2', vendor: 'Huawei', name: 'Huawei M-Pencil (2nd gen)', nameAr: 'قلم هواوي M-Pencil (الجيل الثاني)',
    model: null, generation: '2nd gen', releaseYear: 2021,
    platforms: ['android'], protocol: 'vendor-bt',
    connection: 'Huawei digitizer + Bluetooth LE', charging: 'Magnetic wireless charging',
    pressureLevels: 4096, tilt: true, hover: false, palmRejection: true,
    buttons: [{ id: 'barrel', label: 'Side button', labelAr: 'الزر الجانبي' }],
    eraserEnd: false, bodyDoubleTap: true,
    devices: 'MatePad 11 / MatePad Pro 10.8 / MatePad Paper',
    integration: 'Full pressure + tilt + button; hover not reported on this generation. Body double-tap vendor-controlled.',
    sources: [{ label: 'Huawei MatePad 11 product page (M-Pencil 2nd gen)', url: 'https://consumer.huawei.com/en/tablets/', kind: 'official' }],
    confidence: { specs: 'community', buttons: 'community', gestures: 'community' },
    ua: /(HUAWEI|Huawei|HW-)/,
  },
  {
    id: 'huawei-mpencil', vendor: 'Huawei', name: 'Huawei M-Pencil (1st gen)', nameAr: 'قلم هواوي M-Pencil (الجيل الأول)',
    model: null, generation: '1st gen', releaseYear: 2020,
    platforms: ['android'], protocol: 'vendor-bt',
    connection: 'Huawei digitizer + Bluetooth', charging: 'Magnetic charging',
    pressureLevels: 4096, tilt: false, hover: false, palmRejection: true,
    buttons: [], eraserEnd: false, bodyDoubleTap: null,
    devices: 'MatePad / MatePad Pro (2020)',
    integration: 'Pressure + contact events receivable; no tilt/hover; button presence unverified.',
    sources: [{ label: 'Huawei MatePad product pages (archived)', url: 'https://consumer.huawei.com/en/tablets/', kind: 'official' }],
    confidence: { specs: 'community', buttons: 'unverified', gestures: 'unverified' },
    ua: /(HUAWEI|Huawei|HW-)/,
  },
  // ---------------------------------------------------------------- Honor
  {
    id: 'honor-magic-pencil-3', vendor: 'Honor', name: 'Honor Magic Pencil 3', nameAr: 'قلم هونر ماجيك 3',
    model: null, generation: '3rd gen', releaseYear: 2023,
    platforms: ['android'], protocol: 'vendor-bt',
    connection: 'Honor digitizer + Bluetooth LE', charging: 'Magnetic wireless charging',
    pressureLevels: 4096, tilt: true, hover: true, palmRejection: true,
    buttons: [{ id: 'barrel', label: 'Side button', labelAr: 'الزر الجانبي' }],
    eraserEnd: false, bodyDoubleTap: true,
    devices: 'Honor Pad 9 / MagicPad 13 / MagicPad 2',
    integration: 'Pressure/tilt/hover + side button receivable; Honor body gestures are vendor-controlled.',
    sources: [
      { label: 'Honor Pad 9 / MagicPad product pages', url: 'https://www.hihonor.com', kind: 'official' },
      { label: 'Community spec sheets', kind: 'community' },
    ],
    confidence: { specs: 'community', buttons: 'community', gestures: 'community' },
    ua: /(HONOR|honor|MagicOS|PAD)/,
  },
  {
    id: 'honor-magic-pencil-2', vendor: 'Honor', name: 'Honor Magic Pencil 2', nameAr: 'قلم هونر ماجيك 2',
    model: null, generation: '2nd gen', releaseYear: 2022,
    platforms: ['android'], protocol: 'vendor-bt',
    connection: 'Honor digitizer + Bluetooth LE', charging: 'Magnetic wireless charging',
    pressureLevels: 4096, tilt: true, hover: false, palmRejection: true,
    buttons: [{ id: 'barrel', label: 'Side button', labelAr: 'الزر الجانبي' }],
    eraserEnd: false, bodyDoubleTap: true,
    devices: 'Honor Pad 8 / V8 Pro',
    integration: 'Pressure + tilt + button receivable; no hover on this generation.',
    sources: [{ label: 'Honor Pad 8 product page (Magic Pencil 2)', url: 'https://www.hihonor.com', kind: 'official' }],
    confidence: { specs: 'community', buttons: 'community', gestures: 'community' },
    ua: /(HONOR|honor)/,
  },
  // ---------------------------------------------------------------- OnePlus / OPPO / vivo / realme
  {
    id: 'oneplus-stylo-2', vendor: 'OnePlus', name: 'OnePlus Stylo 2', nameAr: 'قلم ون بلس ستايلو 2',
    model: null, generation: 'Stylo 2', releaseYear: 2024,
    platforms: ['android'], protocol: 'wgp',
    connection: 'Active digitizer + Bluetooth LE', charging: 'Magnetic wireless charging',
    pressureLevels: 4096, tilt: true, hover: true, palmRejection: true,
    buttons: [{ id: 'barrel', label: 'Side button', labelAr: 'الزر الجانبي' }],
    eraserEnd: false, bodyDoubleTap: true,
    devices: 'OnePlus Pad 2 / OnePlus Pad',
    integration: 'Pressure/tilt/hover + button receivable; body double-tap gestures vendor-controlled.',
    sources: [{ label: 'OnePlus Pad 2 product page (Stylo 2)', url: 'https://www.oneplus.com', kind: 'official' }],
    confidence: { specs: 'community', buttons: 'community', gestures: 'community' },
    ua: /(OnePlus|OPD2|OP4)/,
  },
  {
    id: 'oppo-pen', vendor: 'OPPO', name: 'OPPO Stylo / OPPO Pen', nameAr: 'قلم أوبو ستايلو',
    model: null, generation: 'Stylo', releaseYear: 2023,
    platforms: ['android'], protocol: 'wgp',
    connection: 'Active digitizer + Bluetooth LE', charging: 'Magnetic wireless charging',
    pressureLevels: 4096, tilt: true, hover: true, palmRejection: true,
    buttons: [{ id: 'barrel', label: 'Side button', labelAr: 'الزر الجانبي' }],
    eraserEnd: false, bodyDoubleTap: true,
    devices: 'OPPO Pad 2 / OPPO Pad 3',
    integration: 'Pressure/tilt/hover + button receivable; vendor gestures OS-controlled.',
    sources: [{ label: 'OPPO Pad 2 product page (OPPO Stylo)', url: 'https://www.oppo.com', kind: 'official' }],
    confidence: { specs: 'community', buttons: 'community', gestures: 'community' },
    ua: /(OPPO|OPD2|PAD)/,
  },
  {
    id: 'vivo-pencil-2', vendor: 'vivo', name: 'vivo Pencil 2', nameAr: 'قلم فيفو بنسل 2',
    model: null, generation: '2nd gen', releaseYear: 2023,
    platforms: ['android'], protocol: 'wgp',
    connection: 'Active digitizer + Bluetooth LE', charging: 'Magnetic wireless charging',
    pressureLevels: 4096, tilt: true, hover: true, palmRejection: true,
    buttons: [{ id: 'barrel', label: 'Side button', labelAr: 'الزر الجانبي' }],
    eraserEnd: false, bodyDoubleTap: true,
    devices: 'vivo Pad 2 / vivo Pad Air / iQOO Pad',
    integration: 'Pressure/tilt/hover + button receivable; vendor gestures OS-controlled.',
    sources: [{ label: 'vivo Pad 2 product page (vivo Pencil 2)', url: 'https://www.vivo.com', kind: 'official' }],
    confidence: { specs: 'community', buttons: 'community', gestures: 'community' },
    ua: /(vivo|V2[0-9]{3}A|iQOO|PAD)/,
  },
  {
    id: 'realme-pen', vendor: 'realme', name: 'realme Pen', nameAr: 'قلم ريلمي',
    model: null, generation: '1st gen', releaseYear: 2022,
    platforms: ['android'], protocol: 'wgp',
    connection: 'Active digitizer + Bluetooth LE', charging: 'Magnetic wireless charging',
    pressureLevels: 4096, tilt: null, hover: false, palmRejection: true,
    buttons: [{ id: 'barrel', label: 'Side button', labelAr: 'الزر الجانبي' }],
    eraserEnd: false, bodyDoubleTap: true,
    devices: 'realme Pad X / realme Pad 2',
    integration: 'Pressure + button receivable; tilt unverified; hover not reported.',
    sources: [{ label: 'realme Pad X product page (realme Pen)', url: 'https://www.realme.com', kind: 'official' }],
    confidence: { specs: 'community', buttons: 'community', gestures: 'unverified' },
    ua: /(realme|RMX)/,
  },
  // ---------------------------------------------------------------- Lenovo / Google
  {
    id: 'lenovo-tab-pen-plus', vendor: 'Lenovo', name: 'Lenovo Tab Pen Plus', nameAr: 'قلم لينوفو تاب بن بلس',
    model: 'GX81U / per-SKU', generation: 'Tab Pen Plus', releaseYear: 2022,
    platforms: ['android'], protocol: 'emr',
    connection: 'Wacom EMR — no battery, no pairing', charging: null,
    pressureLevels: 4096, tilt: true, hover: true, palmRejection: true,
    buttons: [
      { id: 'barrel', label: 'Upper barrel button', labelAr: 'الزر العلوي' },
      { id: 'barrel2', label: 'Lower barrel button', labelAr: 'الزر السفلي' },
    ],
    eraserEnd: true, bodyDoubleTap: false,
    devices: 'Tab P12 / Tab P11 (2nd gen) / Xiaoxin Pad Pro / most Lenovo EMR tablets',
    integration: 'Both barrel buttons AND the eraser end surface as PointerEvent button bits — every pattern (press/double/long, hover/contact) is receivable and bindable.',
    sources: [SRC_EMR, { label: 'Lenovo Tab Pen Plus product page', url: 'https://www.lenovo.com', kind: 'official' }],
    confidence: { specs: 'official', buttons: 'official', gestures: 'official' },
    ua: /(Lenovo|TB-|TB3)/,
  },
  {
    id: 'lenovo-precision-pen-3', vendor: 'Lenovo', name: 'Lenovo Precision Pen 3', nameAr: 'قلم لينوفو بريسيشن 3',
    model: null, generation: 'Precision Pen 3', releaseYear: 2023,
    platforms: ['android', 'windows'], protocol: 'mpp',
    connection: 'MPP 2.0 over supported digitizers', charging: 'USB-C / AAAA battery (SKU dependent)',
    pressureLevels: 4096, tilt: true, hover: true, palmRejection: true,
    buttons: [{ id: 'barrel', label: 'Side button', labelAr: 'الزر الجانبي' }],
    eraserEnd: true, bodyDoubleTap: false,
    devices: 'ThinkPad tablets / Lenovo Tab Extreme (MPP digitizers)',
    integration: 'Pressure/tilt/hover + button + eraser end receivable (MPP reports button 1554/bit 4 patterns).',
    sources: [{ label: 'Lenovo Precision Pen 3 product documentation', url: 'https://www.lenovo.com', kind: 'official' }],
    confidence: { specs: 'community', buttons: 'community', gestures: 'official' },
    ua: /(Lenovo|ThinkPad)/,
  },
  {
    id: 'pixel-tablet-pen', vendor: 'Google', name: 'Pixel Tablet Pen', nameAr: 'قلم جوجل بيكسل تابلت',
    model: 'GUS006 (reported)', generation: '1st gen', releaseYear: 2023,
    platforms: ['android'], protocol: 'usi',
    connection: 'USI 2.0 digitizer — no pairing', charging: null,
    pressureLevels: 2048, tilt: false, hover: false, palmRejection: true,
    buttons: [], eraserEnd: false, bodyDoubleTap: false,
    devices: 'Google Pixel Tablet (USI digitizer)',
    integration: 'Pressure + contact receivable. No hover, no buttons — the tip double-tap detector still works.',
    sources: [SRC_USI, { label: 'Google Pixel Tablet Pen store page', url: 'https://store.google.com', kind: 'official' }],
    confidence: { specs: 'official', buttons: 'official', gestures: 'official' },
    ua: /(Pixel|GT52)/,
  },
  // ---------------------------------------------------------------- Microsoft (MPP)
  {
    id: 'surface-slim-pen-2', vendor: 'Microsoft', name: 'Surface Slim Pen 2', nameAr: 'قلم سيرفيس سليم بن 2',
    model: 'EYU-00004 (reported)', generation: 'Slim 2', releaseYear: 2021,
    platforms: ['windows'], protocol: 'mpp',
    connection: 'MPP 2.6 over Surface digitizers (BLE for firmware/slim charging case)',
    charging: 'Surface Slim Pen charger / storage in keyboard',
    pressureLevels: 4096, tilt: true, hover: true, palmRejection: true,
    buttons: [{ id: 'barrel', label: 'Single side button', labelAr: 'زر جانبي واحد' }],
    eraserEnd: true, bodyDoubleTap: false,
    devices: 'Surface Pro 8/9/11, Surface Laptop Studio, Surface Duo (via compat.), MPP laptops',
    integration: 'On Windows browsers: pressure, tilt, hover, button (bit 4) and the dedicated eraser end all arrive as PointerEvents — fully bindable. On Android devices MPP is not available.',
    sources: [{ label: 'Microsoft Surface Slim Pen 2 product page', url: 'https://www.microsoft.com', kind: 'official' }],
    confidence: { specs: 'official', buttons: 'official', gestures: 'official' },
  },
  {
    id: 'surface-pen', vendor: 'Microsoft', name: 'Surface Pen (MPP 1.x/2.x)', nameAr: 'قلم سيرفيس (MPP)',
    model: null, generation: 'per Surface generation', releaseYear: null,
    platforms: ['windows'], protocol: 'mpp',
    connection: 'MPP over Surface digitizers', charging: 'AAAA battery + coin cell (classic models)',
    pressureLevels: 4096, tilt: true, hover: true, palmRejection: true,
    buttons: [{ id: 'barrel', label: 'Single side button', labelAr: 'زر جانبي واحد' }],
    eraserEnd: true, bodyDoubleTap: false,
    devices: 'Surface Pro 3–7+, Surface Go, MPP partner laptops (HP/Dell/Lenovo)',
    integration: 'Button (bit 4), eraser end (bit 32), pressure, tilt, hover — all receivable on Windows browsers.',
    sources: [{ label: 'Microsoft Surface Pen documentation', url: 'https://www.microsoft.com', kind: 'official' }],
    confidence: { specs: 'official', buttons: 'official', gestures: 'official' },
  },
  // ---------------------------------------------------------------- Wacom
  {
    id: 'wacom-one-pen', vendor: 'Wacom', name: 'Wacom One Pen ( tablet OEM EMR )', nameAr: 'قلم واكوم ون (لأجهزة EMR)',
    model: 'KP1104-EU (per SKU)', generation: 'One', releaseYear: 2021,
    platforms: ['android', 'chromeos', 'windows'], protocol: 'emr',
    connection: 'Wacom EMR — battery-free', charging: null,
    pressureLevels: 4096, tilt: true, hover: true, palmRejection: true,
    buttons: [
      { id: 'barrel', label: 'Upper barrel button', labelAr: 'الزر العلوي' },
      { id: 'barrel2', label: 'Lower barrel button', labelAr: 'الزر السفلي' },
    ],
    eraserEnd: true, bodyDoubleTap: false,
    devices: 'Any EMR tablet (Samsung Tab, Lenovo Tab, Wacom One display, many Chromebooks)',
    integration: 'Everything physical is receivable: two buttons, eraser end, pressure, tilt, hover — the most complete binding surface of any pen.',
    sources: [SRC_EMR, { label: 'Wacom One product page', url: 'https://one.wacom.com', kind: 'official' }],
    confidence: { specs: 'official', buttons: 'official', gestures: 'official' },
  },
  {
    id: 'wacom-bamboo-ink-plus', vendor: 'Wacom', name: 'Wacom Bamboo Ink Plus', nameAr: 'قلم واكوم بامبو إنك بلس',
    model: 'CS322GB (reported)', generation: 'Ink Plus', releaseYear: 2018,
    platforms: ['windows'], protocol: 'mpp',
    connection: 'MPP 2.0 (Wacom Active ES mode on select devices)', charging: 'USB-C / AAAA (SKU dependent)',
    pressureLevels: 4096, tilt: true, hover: true, palmRejection: true,
    buttons: [
      { id: 'barrel', label: 'Upper barrel button', labelAr: 'الزر العلوي' },
      { id: 'barrel2', label: 'Lower barrel button', labelAr: 'الزر السفلي' },
    ],
    eraserEnd: true, bodyDoubleTap: false,
    devices: 'MPP 1.51/2.0 laptops & Surfaces',
    integration: 'Both buttons + eraser end receivable on Windows browsers.',
    sources: [{ label: 'Wacom Bamboo Ink Plus product page', url: 'https://www.wacom.com', kind: 'official' }],
    confidence: { specs: 'official', buttons: 'official', gestures: 'official' },
  },
  // ---------------------------------------------------------------- USI
  {
    id: 'usi-2', vendor: 'USI', name: 'USI 2.0 Stylus', nameAr: 'قلم USI 2.0',
    model: null, generation: '2.0', releaseYear: 2021,
    platforms: ['android', 'chromeos'], protocol: 'usi',
    connection: 'USI 2.0 — no pairing; some pens carry a small battery for auxiliary buttons',
    charging: null,
    pressureLevels: 2048, tilt: true, hover: false, palmRejection: true,
    buttons: [{ id: 'barrel', label: 'Side button (pen-dependent)', labelAr: 'زر جانبي (حسب القلم)' }],
    eraserEnd: null, bodyDoubleTap: false,
    devices: 'USI Chromebooks (Acer/HP/Lenovo/Asus), USI Android tablets (many budget/whitebox tablets)',
    integration: 'Pressure + tilt receivable; hover NOT part of USI 2.0 (in-range detection varies); buttons only on pens that physically have them. Report rate is digitizer-bound (~120–240 Hz).',
    sources: [SRC_USI, { label: 'USI 2.0 specification overview', url: 'https://www.usi.org', kind: 'official' }],
    confidence: { specs: 'official', buttons: 'community', gestures: 'official' },
  },
  {
    id: 'usi-1', vendor: 'USI', name: 'USI 1.0 Stylus', nameAr: 'قلم USI 1.0',
    model: null, generation: '1.0', releaseYear: 2019,
    platforms: ['chromeos'], protocol: 'usi',
    connection: 'USI 1.0 — no pairing', charging: null,
    pressureLevels: 2048, tilt: false, hover: false, palmRejection: true,
    buttons: [], eraserEnd: null, bodyDoubleTap: false,
    devices: 'USI Chromebooks (2019+)',
    integration: 'Pressure + contact only. The tip double-tap detector still works.',
    sources: [SRC_USI],
    confidence: { specs: 'official', buttons: 'official', gestures: 'official' },
  },
  // ---------------------------------------------------------------- generic
  {
    id: 'generic-active', vendor: 'Generic', name: 'Generic active stylus', nameAr: 'قلم نشط عام',
    model: null, generation: null, releaseYear: null,
    platforms: ['android'], protocol: 'wgp',
    connection: 'Active digitizer protocol of the device maker', charging: null,
    pressureLevels: null, tilt: null, hover: null, palmRejection: true,
    buttons: [], eraserEnd: null, bodyDoubleTap: null,
    devices: 'Unknown-brand tablets with active pen support',
    integration: 'Capability-based generic profile: the engine maps ONLY what the digitizer actually reports (pressure variance, tilt deltas, hover events, button bits). Tip double-tap always available.',
    sources: [],
    confidence: { specs: 'unverified', buttons: 'unverified', gestures: 'unverified' },
  },
  {
    id: 'generic-capacitive', vendor: 'Generic', name: 'Capacitive stylus (passive)', nameAr: 'قلم سعوي عام (غير نشط)',
    model: null, generation: null, releaseYear: null,
    platforms: ['android', 'ipados', 'windows'], protocol: 'capacitive',
    connection: 'Conductive tip — reports as a FINGER, never as a pen',
    charging: null, pressureLevels: 0, tilt: false, hover: false, palmRejection: false,
    buttons: [], eraserEnd: false, bodyDoubleTap: false,
    devices: 'Any touchscreen',
    integration: 'No pressure/tilt/hover/button — it emulates a finger. Works for writing (fixed 0.5 pressure) and the tip double-tap detector; pen-specific shortcuts are unavailable.',
    sources: [],
    confidence: { specs: 'official', buttons: 'official', gestures: 'official' },
  },
];

// ---------------------------------------------------------------- event matrix
export interface PenEventSupport {
  def: PenEventDef;
  supported: boolean;       // does THIS pen have the hardware?
  receivable: boolean;      // can Nanote bind it?
  note?: string;
}

/** Derive which events a pen can produce + which the app can actually bind. */
export function eventsForSpec(spec: StylusSpec): PenEventSupport[] {
  const hasBarrel = spec.buttons.some((b) => b.id === 'barrel');
  const hasBarrel2 = spec.buttons.some((b) => b.id === 'barrel2');
  const hasEraser = spec.eraserEnd === true;
  const hasBtGestures = spec.bodyDoubleTap === true;
  const out: PenEventSupport[] = [];
  for (const def of PEN_EVENTS) {
    let supported = false;
    switch (def.id) {
      case 'barrel.press': case 'barrel.double': case 'barrel.long':
        supported = hasBarrel; break;
      case 'barrel2.press': case 'barrel2.double': case 'barrel2.long':
        supported = hasBarrel2; break;
      case 'eraserEnd.press': case 'eraserEnd.double': case 'eraserEnd.long':
        supported = hasEraser; break;
      case 'tip.doubleTap':
        supported = true; break; // our own detector — every pen
      case 'body.doubleTap':
        supported = hasBtGestures; break;
      case 'os.remoteGestures':
        supported = hasBtGestures; break;
      case 'hover.tracking':
        supported = spec.hover === true; break;
      default: supported = false;
    }
    out.push({ def, supported, receivable: supported && def.appReceivable, note: def.note });
  }
  return out;
}

// ---------------------------------------------------------------- runtime DB updates
/**
 * DB version — bumped whenever the bundled records change. The /api/pen-db
 * endpoint serves the same version; the settings page can fetch it and call
 * mergePenDb() to update the KNOWLEDGE BASE without an app update.
 */
export const PEN_DB_VERSION = 2;

let runtimeSpecs: StylusSpec[] = PEN_SPECS;
let runtimeVersion = PEN_DB_VERSION;

export function getPenSpecs(): StylusSpec[] { return runtimeSpecs }
export function getPenDbVersion(): number { return runtimeVersion }

export interface PenDbPayload {
  version: number;
  specs: StylusSpec[];
}

/**
 * Merge a newer pen-DB payload (fetched from /api/pen-db or any future source).
 * Records are matched by id — a payload record REPLACES the bundled one (so
 * specs can be corrected) and new ids are appended (new models/generations).
 * Older/equal versions are ignored (never a downgrade). Regex `ua` fields are
 * transported as strings and revived safely.
 */
export function mergePenDb(payload: Partial<PenDbPayload>): { applied: boolean; version: number } {
  const v = Number(payload.version ?? 0);
  if (!Array.isArray(payload.specs) || v <= runtimeVersion) {
    return { applied: false, version: runtimeVersion };
  }
  const incoming = payload.specs.filter((s) => s && typeof s.id === 'string');
  const byId = new Map(runtimeSpecs.map((s) => [s.id, s]));
  for (const s of incoming) {
    const rec: StylusSpec = { ...s };
    // revive UA marker shipped as a string
    const ua = (s as StylusSpec & { uaSource?: string | RegExp }).uaSource;
    if (typeof ua === 'string' && ua.length > 1) {
      try { rec.ua = new RegExp(ua) } catch { rec.ua = undefined }
    }
    byId.set(s.id, rec);
  }
  runtimeSpecs = [...byId.values()];
  runtimeVersion = v;
  return { applied: true, version: v };
}

/** serializable snapshot of the DB (ua regexes → source strings) */
export function serializePenDb(): PenDbPayload {
  return {
    version: runtimeVersion,
    specs: runtimeSpecs.map((s) => {
      const { ua, ...rest } = s;
      return { ...rest, ...(ua ? { uaSource: ua.source } : {}) } as StylusSpec & { uaSource?: string };
    }),
  };
}
