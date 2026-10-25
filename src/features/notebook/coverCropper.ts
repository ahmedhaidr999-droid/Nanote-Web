// Image helpers for the "New Notebook" flow — decode picked files, center-crop
// to the cover aspect (3:4) and encode JPEG blobs for the IndexedDB images store.
// Client-side only (invoked from event handlers inside 'use client' components).

export interface CroppedImage { blob: Blob; w: number; h: number }
export interface ImageSize { w: number; h: number }

/** Decode a File into an HTMLImageElement (object URL revoked after load). */
export function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image-decode-failed')) };
    img.src = url;
  });
}

/** Natural pixel size of a picked image file. */
export function readImageSize(file: File): Promise<ImageSize> {
  return loadImage(file).then((img) => ({ w: img.naturalWidth, h: img.naturalHeight }));
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('image-encode-failed'))), 'image/jpeg', 0.9);
  });
}

/**
 * Center-crop an image to the target aspect (aspect = width/height, e.g. 3/4 for
 * covers), cap the output width at `maxWidth` (never upscale), flatten alpha onto
 * white and encode as JPEG for compact IndexedDB storage.
 */
export async function cropToAspect(file: File, aspect: number, maxWidth: number): Promise<CroppedImage> {
  const img = await loadImage(file);
  const sw = img.naturalWidth;
  const sh = img.naturalHeight;
  if (!sw || !sh) throw new Error('empty-image');

  // largest center rect of the source matching the target aspect
  let cw = sw;
  let ch = sw / aspect;
  if (ch > sh) { ch = sh; cw = sh * aspect }
  const cx = (sw - cw) / 2;
  const cy = (sh - ch) / 2;

  const outW = Math.max(1, Math.round(Math.min(maxWidth, cw)));
  const outH = Math.max(1, Math.round(outW / aspect));

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas-unavailable');
  ctx.fillStyle = '#FFFFFF'; // JPEG has no alpha — flatten transparency
  ctx.fillRect(0, 0, outW, outH);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, cx, cy, cw, ch, 0, 0, outW, outH);

  const blob = await canvasToBlob(canvas);
  return { blob, w: outW, h: outH };
}
