// Generates every legacy launcher icon + the splash logo from the brand SVG
// (src/app/icon.svg) using sharp. Run once: `bun run icons`
//   - mipmap-{mdpi..xxxhdpi}/ic_launcher.png      (48/72/96/144/192)
//   - mipmap-{mdpi..xxxhdpi}/ic_launcher_round.png (same sizes, circle crop)
//   - drawable-nodpi/splash_logo.png              (768px, used by drawable/splash.xml)
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const SVG = join(ROOT, 'src/app/icon.svg');
const RES = join(ROOT, 'android/app/src/main/res');

const svg = Buffer.from(await Bun.file(SVG).text());
// render the SVG big and crisp first (density bump for smooth librsvg sampling)
const big = 1024;
const basePng = await sharp(svg, { density: 300 }).resize(big, big).png().toBuffer();

const densities = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
for (const [dpi, size] of Object.entries(densities)) {
  const dir = join(RES, `mipmap-${dpi}`);
  mkdirSync(dir, { recursive: true });
  await sharp(basePng).resize(size, size).png().toFile(join(dir, 'ic_launcher.png'));
  // circular crop for legacy round launchers
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}"/></svg>`
  );
  await sharp(basePng)
    .resize(size, size)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toFile(join(dir, 'ic_launcher_round.png'));
}

// splash logo — raw 768px bitmap (nodpi = no density scaling), centered by
// drawable/splash.xml over the #0E1622 brand background
mkdirSync(join(RES, 'drawable-nodpi'), { recursive: true });
await sharp(basePng).resize(768, 768).png().toFile(join(RES, 'drawable-nodpi/splash_logo.png'));

console.log('✓ android launcher icons + splash logo generated');
