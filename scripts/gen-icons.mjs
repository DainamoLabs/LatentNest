// Regenerates public/icon/*.png from assets-src/.
// Small sizes use the simplified mark; larger sizes use the full logo.
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

const out = new URL('../public/icon/', import.meta.url);
await mkdir(out, { recursive: true });

// assets-src/mark.png comes from scripts/make-mark.py (a silhouette of the logo).
const mark = new URL('../assets-src/mark.png', import.meta.url).pathname;
const logo = new URL('../assets-src/logo.png', import.meta.url).pathname;

for (const size of [16, 32]) {
  await sharp(mark).resize(size, size, { kernel: 'lanczos3' }).png().toFile(new URL(`${size}.png`, out).pathname);
}
await sharp(logo).resize(48, 48, { kernel: 'lanczos3' }).png().toFile(new URL('48.png', out).pathname);
// Chrome Web Store guideline: 96×96 artwork inside 16px of transparent padding.
await sharp(logo)
  .resize(96, 96, { kernel: 'lanczos3' })
  .extend({ top: 16, bottom: 16, left: 16, right: 16, background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile(new URL('128.png', out).pathname);
// Used inside the UI (empty states, options header).
await sharp(logo).resize(256, 256).png().toFile(new URL('../public/logo.png', import.meta.url).pathname);
// Simplified mark for the panel header (shown at ~26px) and, inlined, for page toasts.
await sharp(mark).resize(96, 96, { kernel: 'lanczos3' }).png().toFile(new URL('../public/mark.png', import.meta.url).pathname);
await mkdir(new URL('../src/assets/', import.meta.url), { recursive: true });
await sharp(mark).resize(48, 48, { kernel: 'lanczos3' }).png().toFile(new URL('../src/assets/toast-mark.png', import.meta.url).pathname);
// Dainamo Labs mark for the footer; 64px covers 16px at 4x density.
const studio = new URL('../assets-src/dainamo-labs.png', import.meta.url).pathname;
await sharp(studio).resize(64, 64, { kernel: 'lanczos3' }).png().toFile(new URL('../public/dainamo-labs.png', import.meta.url).pathname);
console.log('icons written');
