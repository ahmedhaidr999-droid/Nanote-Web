// Notebook cover styles — 12 built-ins, rendered with pure CSS (crisp at any size).

export interface CoverCss {
  background: string;
  color?: string;
  backgroundSize?: string;
}

export interface CoverDef {
  id: string;
  type: 'flat' | 'gradient' | 'pattern';
  css: CoverCss;
  accent?: string;
}

export const COVERS: CoverDef[] = [
  { id: 'nanote-blue', type: 'gradient', css: { background: 'linear-gradient(160deg, #2B7BFF 0%, #1E6FF2 45%, #0D47C4 100%)', color: '#FFFFFF' }, accent: '#0D47C4' },
  { id: 'midnight', type: 'gradient', css: { background: 'linear-gradient(160deg, #2B3A55 0%, #16233A 100%)', color: '#FFFFFF' }, accent: '#16233A' },
  { id: 'sunset', type: 'gradient', css: { background: 'linear-gradient(160deg, #FF9F1C 0%, #E5484D 100%)', color: '#FFFFFF' }, accent: '#E5484D' },
  { id: 'meadow', type: 'gradient', css: { background: 'linear-gradient(160deg, #34C98B 0%, #0E7A5F 100%)', color: '#FFFFFF' }, accent: '#0E7A5F' },
  { id: 'orchid', type: 'gradient', css: { background: 'linear-gradient(160deg, #C9A6FF 0%, #9333EA 100%)', color: '#FFFFFF' }, accent: '#9333EA' },
  { id: 'rosewater', type: 'gradient', css: { background: 'linear-gradient(160deg, #FF7EB6 0%, #DB2777 100%)', color: '#FFFFFF' }, accent: '#DB2777' },
  { id: 'paper-white', type: 'flat', css: { background: '#F7F9FC', color: '#16233A' }, accent: '#E2E8F1' },
  { id: 'kraft', type: 'flat', css: { background: '#E8D5B5', color: '#5A4632' }, accent: '#C9A96E' },
  { id: 'ink-black', type: 'flat', css: { background: '#16202E', color: '#E8EEF7' }, accent: '#2B3A55' },
  { id: 'forest', type: 'flat', css: { background: '#1F4E3D', color: '#E8F5EE' }, accent: '#2E6B52' },
  { id: 'dots', type: 'pattern', css: { background: 'radial-gradient(circle, rgba(255,255,255,0.55) 1.6px, transparent 1.7px), linear-gradient(160deg, #1E6FF2, #0D47C4)', backgroundSize: '18px 18px, 100% 100%', color: '#FFFFFF' }, accent: '#0D47C4' },
  { id: 'lines', type: 'pattern', css: { background: 'repeating-linear-gradient(0deg, rgba(255,255,255,0.12) 0, rgba(255,255,255,0.12) 1.5px, transparent 1.5px, transparent 12px), linear-gradient(160deg, #16233A, #0E1622)', color: '#FFFFFF' }, accent: '#16233A' },
];

export const DEFAULT_COVER_ID = 'nanote-blue';

export function getCover(id: string): CoverDef {
  return COVERS.find((c) => c.id === id) ?? COVERS[0];
}
