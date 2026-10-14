// Image decoding helpers. Everything here works in extension pages, the
// Chrome service worker and the Firefox event page (no DOM required).
import type { Crop } from './db';

export class ImageError extends Error {}

/**
 * Grid thumbnails keep their aspect ratio and are shown cropped to a square,
 * so it's the short side that has to fill a large tile on a high-DPI screen.
 */
const THUMB_SHORT = 512;
const THUMB_LONG = 1024;
/** Bumped when thumbnails get bigger; older ones are redrawn as they come into view. */
export const THUMB_VERSION = 2;
/** Version 1 thumbnails were at most this long on the long side. */
const V1_THUMB_SIDE = 360;

/** Identify the format from magic bytes; servers often send the wrong Content-Type. */
export async function sniffMime(blob: Blob): Promise<string | null> {
  const b = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
  const ascii = (start: number, end: number) => String.fromCharCode(...b.subarray(start, end));
  if (b[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(0, 4) === 'GIF8') return 'image/gif';
  if (ascii(0, 2) === 'BM') return 'image/bmp';
  if (ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    if (brand.startsWith('hei') || brand.startsWith('mif1')) return 'image/heic';
  }
  const head = ascii(0, 32).trimStart().toLowerCase();
  if (head.startsWith('<svg') || head.startsWith('<?xml')) return 'image/svg+xml';
  return null;
}

export const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
};

export interface ProcessedImage {
  mime: string;
  width: number;
  height: number;
  hash: string;
  thumb: Blob;
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, '0')).join('');
}

async function decode(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob);
  } catch {
    throw new ImageError("This file couldn't be decoded as an image.");
  }
}

/** Draw `bitmap` (or the `crop` region of it) scaled so its longest side is at most `maxSide`. */
export function drawScaled(bitmap: ImageBitmap, maxSide: number, background?: string, crop?: Crop): OffscreenCanvas {
  const src = crop ?? { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
  const scale = Math.min(1, maxSide / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, src.x, src.y, src.width, src.height, 0, 0, w, h);
  return canvas;
}

/** The long side of the thumbnail for a width × height image (or crop). */
export function thumbLongSide(width: number, height: number): number {
  const long = Math.max(width, height);
  const scale = Math.min(1, THUMB_SHORT / Math.min(width, height), THUMB_LONG / long);
  return Math.max(1, Math.round(long * scale));
}

/** Whether a stored thumbnail is from before the current size and would look soft. */
export function thumbIsOutdated(thumb: { v?: number }, width: number, height: number): boolean {
  return (thumb.v ?? 1) < THUMB_VERSION && thumbLongSide(width, height) > V1_THUMB_SIDE;
}

function drawThumb(bitmap: ImageBitmap, crop?: Crop): Promise<Blob> {
  const region = crop ?? { width: bitmap.width, height: bitmap.height };
  return downscale(bitmap, thumbLongSide(region.width, region.height), crop).convertToBlob({ type: 'image/webp', quality: 0.82 });
}

/** Grid thumbnail, showing the crop when there is one. */
export async function makeThumb(blob: Blob, crop?: Crop): Promise<Blob> {
  const bitmap = await decode(blob);
  try {
    return await drawThumb(bitmap, crop);
  } finally {
    bitmap.close();
  }
}

/** Validate an image and derive everything we store alongside it. */
export async function processImage(blob: Blob): Promise<ProcessedImage> {
  const mime = (await sniffMime(blob)) ?? blob.type;
  if (mime === 'image/svg+xml') throw new ImageError('SVG images aren’t supported.');
  if (mime === 'image/heic') throw new ImageError('HEIC images aren’t supported by the browser.');
  if (!EXT_BY_MIME[mime]) throw new ImageError('That doesn’t look like a supported image.');

  const [hash, bitmap] = await Promise.all([sha256Hex(blob), decode(blob)]);
  try {
    const thumb = await drawThumb(bitmap);
    return { mime, width: bitmap.width, height: bitmap.height, hash, thumb };
  } finally {
    bitmap.close();
  }
}

/**
 * Draws the image (or its crop) with its longest side at `maxSide`, halving in
 * steps first: one big reduction in a single draw aliases, and Firefox has no
 * high-quality smoothing option.
 */
function downscale(bitmap: ImageBitmap, maxSide: number, crop?: Crop): OffscreenCanvas {
  let source: ImageBitmap | OffscreenCanvas = bitmap;
  let region = crop ?? { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
  const scale = maxSide / Math.max(region.width, region.height);
  const w = Math.max(1, Math.round(region.width * scale));
  const h = Math.max(1, Math.round(region.height * scale));
  while (region.width >= w * 2 && region.height >= h * 2) {
    const half = new OffscreenCanvas(Math.ceil(region.width / 2), Math.ceil(region.height / 2));
    const ctx = half.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, region.x, region.y, region.width, region.height, 0, 0, half.width, half.height);
    source = half;
    region = { x: 0, y: 0, width: half.width, height: half.height };
  }
  const out = new OffscreenCanvas(w, h);
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, region.x, region.y, region.width, region.height, 0, 0, w, h);
  return out;
}

/**
 * The file that goes into a training set. PNG and JPEG pass through untouched;
 * everything else becomes PNG (first frame for GIFs). Cropped or resized
 * images are always PNG, so a JPEG isn't compressed a second time.
 * `maxSide` (0 = no limit) only ever shrinks.
 */
export async function toTrainingFormat(
  blob: Blob,
  img: { mime: string; width: number; height: number; crop?: Crop },
  maxSide = 0,
): Promise<{ blob: Blob; ext: string }> {
  const { width, height } = img.crop ?? img;
  const resize = maxSide > 0 && Math.max(width, height) > maxSide;
  if (!img.crop && !resize && img.mime === 'image/png') return { blob, ext: 'png' };
  if (!img.crop && !resize && img.mime === 'image/jpeg') return { blob, ext: 'jpg' };
  const bitmap = await decode(blob);
  try {
    const canvas = resize ? downscale(bitmap, maxSide, img.crop) : drawScaled(bitmap, Infinity, undefined, img.crop);
    return { blob: await canvas.convertToBlob({ type: 'image/png' }), ext: 'png' };
  } finally {
    bitmap.close();
  }
}

/** Downscaled JPEG data URL for sending to a vision model. */
export async function toModelDataUrl(blob: Blob, maxSide: number, crop?: Crop): Promise<string> {
  const bitmap = await decode(blob);
  let out: Blob;
  try {
    // Transparent areas would otherwise become black in JPEG.
    out = await drawScaled(bitmap, maxSide, '#ffffff', crop).convertToBlob({ type: 'image/jpeg', quality: 0.92 });
  } finally {
    bitmap.close();
  }
  return blobToDataUrl(out);
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
}

/** Best-effort file name (without extension) from a URL. */
export function nameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol === 'data:' || u.protocol === 'blob:') return 'image';
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '');
    return stripExt(last) || u.hostname || 'image';
  } catch {
    return 'image';
  }
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

export function stripExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}
