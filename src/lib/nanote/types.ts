// Nanote core domain types — mirrors the spec's data model exactly.

export type Lang = 'en' | 'ar';
export type ThemeMode = 'light' | 'dark' | 'system';

// ---------------------------------------------------------------- tools
export type ToolId = 'fountain' | 'ballpoint' | 'brush' | 'fineliner' | 'highlighter' | 'laser';
export type EditorTool = ToolId | 'eraser' | 'lasso' | 'text' | 'shape' | 'image' | 'pan' | 'textselect';
export type ShapeType = 'line' | 'arrow' | 'rect' | 'rrect' | 'ellipse' | 'triangle' | 'star';
export type EraserMode = 'stroke' | 'area';

// ---------------------------------------------------------------- paper
export type TemplateId =
  | 'blank' | 'ruled' | 'wideruled' | 'grid' | 'dotgrid' | 'handwriting'
  | 'music' | 'isometric' | 'daily' | 'weekly' | 'monthly' | 'custom';
export type PageSizeId = 'a4p' | 'a4l' | 'letter' | 'infinite';

export interface PageSize { id: PageSizeId; w: number; h: number } // h ignored for infinite (min A4 height, grows)

export const PAGE_SIZES: Record<PageSizeId, PageSize> = {
  a4p: { id: 'a4p', w: 794, h: 1123 },
  a4l: { id: 'a4l', w: 1123, h: 794 },
  letter: { id: 'letter', w: 816, h: 1054 },
  infinite: { id: 'infinite', w: 794, h: 1123 },
};

// ---------------------------------------------------------------- db rows
export interface PageLabel { id: string; title: string }

export interface FolderRow {
  id: string;
  name: string;
  parentId: string | null; // nested folders — null = directly inside its tab
  tabId: string | null;     // which tab this folder tree lives in
  colorHex: string;
  emoji: string;
  createdAt: number;
  updatedAt: number;
  isFavorite: boolean;
  deletedAt: number | null;
}

/** A Tab is the top-level grouping shown on the library's screen edge;
 *  folders (nestable) and notebooks live inside it. */
export interface TabRow {
  id: string;
  name: string;
  colorHex: string;
  emoji: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface NotebookRow {
  id: string;
  folderId: string | null;   // null = directly inside its tab (or untabbed)
  tabId: string | null;      // which tab this notebook lives in
  pdfOriginalId: string | null; // stored original PDF file (enables the text layer)
  title: string;
  coverId: string;             // built-in cover style id ('custom' when coverCustomId set)
  coverCustomId: string | null; // images-store id
  defaultTemplate: TemplateId;
  pageSize: PageSizeId;
  backgroundHex: string;       // default paper color
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
  isFavorite: boolean;
  deletedAt: number | null;
  sortOrder: number;
  tagIds: string[];
  // infinity paper: the exact pan/zoom the user left the notebook at, so
  // reopening restores the same view (content coordinates never move).
  lastVp?: { scale: number; tx: number; ty: number } | null;
}

export interface PageRow {
  id: string;
  notebookId: string;
  pageIndex: number;
  template: TemplateId;
  backgroundHex: string;
  customTemplateImageId: string | null; // images store (custom template)
  backgroundImageId: string | null;     // images store (pdf page background)
  isBookmarked: boolean;
  labels: PageLabel[];
  createdAt: number;
  updatedAt: number;
  textIndex: string;  // searchable text-box content, maintained on save
  height: number;     // page height in page-units (fixed sizes; grows for infinite)
  width?: number | null; // per-page width (null → the notebook's base size); infinite pages grow rightward
  // infinity paper growth into the top/left quadrants: elements may sit at
  // negative local coordinates; padX/padY record how far the sheet extends
  // above/left of the original origin (bookkeeping for thumbnails, export,
  // fit-content and the minimap — live rendering is viewport-windowed).
  padX?: number | null;
  padY?: number | null;
}

export interface RecordingRow {
  id: string;
  pageId: string;
  notebookId: string;
  title: string;
  mimeType: string;
  durationMs: number;
  sizeBytes: number;
  createdAt: number;
  imported: boolean;
}

export interface TagRow { id: string; name: string; colorHex: string }

// ---------------------------------------------------------------- settings
export type TranslateEngine = 'nanote' | 'google';
export type LaserMode = 'normal' | 'timed';

// -------------------------------------------------------------- pen & input shortcuts
/** actions a stylus hardware button / gesture can perform */
export type PenAction =
  | 'none' | 'eraserHold' | 'eraserToggle' | 'pen' | 'highlighter' | 'laser'
  | 'lasso' | 'text' | 'shape' | 'pan' | 'undo' | 'redo' | 'pagePrev' | 'pageNext';
/** actions a finger tap gesture can perform */
export type FingerAction = 'none' | 'zoom' | 'undo' | 'redo' | 'eraserToggle' | 'pen';

export interface PenShortcutPrefs {
  barrel: PenAction;    // primary side button held during contact (Wacom/S Pen/Surface/USI)
  barrel2: PenAction;   // secondary side button (3-button styluses)
  doubleTap: PenAction; // quick double-tap of the pen tip (works on every stylus)
}
export interface FingerGesturePrefs {
  doubleTap: FingerAction;    // one-finger double tap
  twoFingerTap: FingerAction; // quick two-finger tap (no pinch movement)
}
export const PEN_SHORTCUTS_DEFAULT: PenShortcutPrefs = {
  barrel: 'eraserHold',
  barrel2: 'undo',
  doubleTap: 'eraserToggle',
};
export const FINGER_GESTURES_DEFAULT: FingerGesturePrefs = {
  doubleTap: 'zoom',
  twoFingerTap: 'undo',
};

export interface Settings {
  theme: ThemeMode;
  lang: Lang;
  defaultView: 'grid' | 'list';
  pressureCurve: number;      // gamma exponent (0.4 firm .. 1 linear .. 2.5 soft)
  fingerDrawing: boolean;
  stylusOnly: boolean;
  leftHanded: boolean;
  toolRailPosition: 'top' | 'bottom' | 'left' | 'right';
  customColors: string[];    // colors saved from the wheel (shared by pens/highlighter/laser)
  autosaveMs: number;         // 0 immediate, 1000, 5000
  onboarded: boolean;
  favoriteColors: string[];   // up to 5 saved slots
  includeAudioInBackup: boolean;
  highlighterOpacity: number; // 0..100 (%) — same-color highlighter passes never stack
  shapeDetection: boolean;    // draw & hold → recognize shapes (pens, Notewise-style)
  // ----- translation platform (independent app platform: online engines +
  // downloaded offline language packs from the in-app language library)
  translateEngine: TranslateEngine; // which engine the Translate button uses
  translateTarget: string;    // 'auto' (UI language) | ISO code ('ar','en','fr',…)
  aiService: 'chatgpt' | 'gemini' | 'claude'; // the text-selection "Ask <AI>" target
  // ----- laser pointer (Notewise-style): normal fades ~1s; timed strokes
  // linger and all fade together N seconds after writing stops
  laserMode: LaserMode;
  laserFadeSec: number;        // 1..10 seconds (timed mode)
  penShortcuts: PenShortcutPrefs;   // stylus hardware buttons + double-tap
  fingerGestures: FingerGesturePrefs; // finger tap gestures
  minimap: boolean;                 // infinity paper: show the mini overview map
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  lang: 'en',
  defaultView: 'grid',
  pressureCurve: 1,
  // Pen-first by default: the stylus writes, the finger navigates (pan/zoom).
  // Users can enable finger drawing anytime from the editor toolbar or Settings.
  fingerDrawing: false,
  stylusOnly: false,
  leftHanded: false,
  toolRailPosition: 'left',
  customColors: [],
  autosaveMs: 1000, // UI options: 0 (immediate) / 1000 / 5000
  onboarded: false,
  favoriteColors: ['#1E6FF2', '#16233A', '#E5484D', '#22A06B', '#FF9F1C'],
  includeAudioInBackup: true,
  highlighterOpacity: 40,
  shapeDetection: true,
  translateEngine: 'nanote',
  translateTarget: 'auto',
  aiService: 'chatgpt',
  laserMode: 'normal',
  laserFadeSec: 3,
  penShortcuts: PEN_SHORTCUTS_DEFAULT,
  fingerGestures: FINGER_GESTURES_DEFAULT,
  minimap: true,
};

// ---------------------------------------------------------------- offline language packs
/** A downloaded language pack (from Settings → Languages). English-keyed so
 *  any pair can translate through the English pivot; the built-in AR↔EN
 *  dictionary ships in the binary and needs no download. */
export interface LangPackMeta {
  code: string;        // ISO 639-1 ('fr', 'de', …)
  name: string;        // English name
  nativeName: string;  // endonym shown in the library
  rtl: boolean;
}
export interface LangPack extends LangPackMeta {
  entries: Record<string, string>;   // english word (lowercase) → pack-language word
  phrases: Record<string, string>;   // english phrase → pack-language phrase
  wordCount: number;                 // entries + phrases count
  builtAt: number;
}

/** Languages offered in the Settings language library. 'ar' is special: the
 *  AR↔EN dictionary is BUILT-IN (marked ready out of the box). */
export const LANG_LIBRARY: LangPackMeta[] = [
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', rtl: true },
  { code: 'fr', name: 'French', nativeName: 'Français', rtl: false },
  { code: 'de', name: 'German', nativeName: 'Deutsch', rtl: false },
  { code: 'es', name: 'Spanish', nativeName: 'Español', rtl: false },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', rtl: false },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', rtl: false },
  { code: 'fa', name: 'Persian', nativeName: 'فارسی', rtl: true },
  { code: 'ur', name: 'Urdu', nativeName: 'اردو', rtl: true },
];

// ---------------------------------------------------------------- page document (ink codec payload)
export interface InkPoint { x: number; y: number; p: number; t: number } // t = ms since stroke start

export interface StrokeEl {
  kind: 'stroke';
  id: string;
  tool: ToolId;
  color: string;
  width: number;
  points: InkPoint[];
  z: number;
}

export interface TextEl {
  kind: 'text';
  id: string;
  x: number; y: number; w: number;
  text: string;
  fontId: string;
  size: number;
  color: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  align: 'start' | 'center' | 'end';
  z: number;
}

export interface ShapeEl {
  kind: 'shape';
  id: string;
  shape: ShapeType;
  x: number; y: number; w: number; h: number;
  stroke: string;
  strokeWidth: number;
  fill: string | null;
  z: number;
}

export interface ImageEl {
  kind: 'image';
  id: string;
  x: number; y: number; w: number; h: number;
  imageId: string;
  rotation: number; // radians
  flipH?: boolean;            // mirror horizontally (survives the NINK JSON section)
  flipV?: boolean;            // mirror vertically
  cornerRadius?: number; // px in page-space; 0/undefined = sharp corners
  z: number;
}

export type PageElement = StrokeEl | TextEl | ShapeEl | ImageEl;

/** strokeId -> audio sync timing (ms relative to recording start) */
export interface AudioSyncEntry { recId: string; tStart: number; tEnd: number }
export type AudioSyncMap = Record<string, AudioSyncEntry>;

export interface PageDoc {
  version: 1;
  elements: PageElement[];
  sync: AudioSyncMap;
}

export function emptyDoc(): PageDoc { return { version: 1, elements: [], sync: {} } }

// ---------------------------------------------------------------- pdf text layer (cached, regenerable from the stored original)
/** One pdf.js text item positioned in ink-space (page units, y-down from page top). */
export interface PdfTextItem { str: string; x: number; y: number; w: number; h: number }
export interface PdfTextRec { pageId: string; items: PdfTextItem[]; updatedAt: number }

// ---------------------------------------------------------------- palettes
export const HIGHLIGHTER_PALETTE = ['#FFD84D', '#6FE38B', '#FF7EB6', '#7CC4FF', '#C9A6FF'];

export const INK_PALETTE = [
  '#16233A', '#1E6FF2', '#0A3A8F', '#5A6B85', '#22A06B', '#0E7A5F',
  '#E5484D', '#C2410C', '#FF9F1C', '#CA8A04', '#9333EA', '#DB2777',
  '#FFFFFF', '#94A3B8', '#6FE38B', '#7CC4FF',
];

export const PAPER_COLORS = [
  '#FFFFFF', '#FFFDF5', '#F7F4EC', '#F4F7FC', '#FBF7F2',
  '#1A1F2E', '#232936', '#2B2440',
];

// ---------------------------------------------------------------- fonts (bundled stacks, Arabic-capable)
export interface FontDef { id: string; css: string; label: string; arabicOk: boolean }
export const TEXT_FONTS: FontDef[] = [
  { id: 'sans', css: "var(--font-sans), system-ui, sans-serif", label: 'Sans', arabicOk: true },
  { id: 'arabic', css: "'Noto Sans Arabic', var(--font-sans), Tahoma, sans-serif", label: 'Arabic', arabicOk: true },
  { id: 'serif', css: "Georgia, 'Times New Roman', serif", label: 'Serif', arabicOk: true },
  { id: 'mono', css: "var(--font-mono), 'Courier New', monospace", label: 'Mono', arabicOk: true },
  { id: 'rounded', css: "'Trebuchet MS', 'Segoe UI', system-ui, sans-serif", label: 'Rounded', arabicOk: true },
  { id: 'typewriter', css: "'Courier New', Courier, monospace", label: 'Typewriter', arabicOk: true },
];

// ---------------------------------------------------------------- tool defaults
export interface ToolState {
  color: string;
  width: number;
}

export const DEFAULT_TOOL_STATES: Record<ToolId, ToolState> = {
  fountain: { color: '#1E6FF2', width: 5 },
  ballpoint: { color: '#16233A', width: 2.4 },
  brush: { color: '#16233A', width: 9 },
  fineliner: { color: '#16233A', width: 1.8 },
  highlighter: { color: '#FFD84D', width: 18 },
  laser: { color: '#E5484D', width: 6 },
};

export const ERASER_DEFAULT = { mode: 'stroke' as EraserMode, size: 24 };

// ---------------------------------------------------------------- misc
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const MIN_ZOOM = 0.5; // 50% max zoom-out — pages stay centered and readable
export const MAX_ZOOM = 8;
// Infinity paper (Concepts-style) — near-unbounded zoom range
export const INFINITE_MIN_ZOOM = 0.08;
export const INFINITE_MAX_ZOOM = 24;
// infinity paper: growth step & margin when the sheet chases the pen
export const INFINITE_GROW_STEP = 512;
export const INFINITE_GROW_MARGIN = 140;
export const UNDO_LIMIT = 200;
