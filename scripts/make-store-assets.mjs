// Renders store/promo-tile-440x280.png (Chrome Web Store small promo tile)
// from assets-src/logo.png. Text uses a system font (Roboto, else any sans).
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

const out = new URL('../store/', import.meta.url);
await mkdir(out, { recursive: true });
const logo = new URL('../assets-src/logo.png', import.meta.url).pathname;

const W = 440;
const H = 280;
const LOGO = 168;

// Colors from src/styles/app.css (--bg, --bg-raised, --accent, --text-2).
const background = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <radialGradient id="glow" cx="0.3" cy="0.5" r="0.6">
      <stop offset="0" stop-color="#2a2016"/>
      <stop offset="1" stop-color="#14161b"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <text x="208" y="134" font-family="Roboto, sans-serif" font-weight="700" font-size="40" fill="#eef0f3">LatentNest</text>
  <rect x="210" y="150" width="44" height="3" rx="1.5" fill="#f29f2e"/>
  <text x="210" y="182" font-family="Roboto, sans-serif" font-size="17" fill="#c3c8d0">Web images to captioned</text>
  <text x="210" y="205" font-family="Roboto, sans-serif" font-size="17" fill="#c3c8d0">LoRA training datasets</text>
</svg>`);

const mark = await sharp(logo).resize(LOGO, LOGO, { kernel: 'lanczos3' }).png().toBuffer();
await sharp(background)
  .composite([{ input: mark, left: 28, top: Math.round((H - LOGO) / 2) }])
  .png()
  .toFile(new URL('promo-tile-440x280.png', out).pathname);
console.log('store assets written');
