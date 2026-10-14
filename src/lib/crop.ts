// Crop rectangle geometry, in original image pixels.
import type { Crop } from './db';

export type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

/** Smallest crop side, so a slip of the mouse can't collapse the box. */
export const MIN_CROP = 32;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const fullCrop = (width: number, height: number): Crop => ({ x: 0, y: 0, width, height });

export const isFullCrop = (c: Crop, width: number, height: number) =>
  c.x === 0 && c.y === 0 && c.width === width && c.height === height;

/** Whole pixels, kept inside the image. */
function snap(c: Crop, W: number, H: number): Crop {
  const x = clamp(Math.round(c.x), 0, W - 1);
  const y = clamp(Math.round(c.y), 0, H - 1);
  return { x, y, width: clamp(Math.round(c.width), 1, W - x), height: clamp(Math.round(c.height), 1, H - y) };
}

/** Largest crop with aspect `ratio` (width / height), centered on (cx, cy) as far as the edges allow. */
export function fitAspect(W: number, H: number, ratio: number, cx = W / 2, cy = H / 2): Crop {
  let w = W;
  let h = W / ratio;
  if (h > H) {
    h = H;
    w = H * ratio;
  }
  return snap({ x: clamp(cx - w / 2, 0, W - w), y: clamp(cy - h / 2, 0, H - h), width: w, height: h }, W, H);
}

/** Resizes the box from its long side, keeping `ratio`, anchored at (ax, ay) and growing toward (dirX, dirY). */
function withRatio(w: number, h: number, ratio: number, ax: number, ay: number, dirX: number, dirY: number, W: number, H: number) {
  if (w / h > ratio) h = w / ratio;
  else w = h * ratio;
  const maxW = dirX < 0 ? ax : W - ax;
  const maxH = dirY < 0 ? ay : H - ay;
  if (w > maxW) {
    w = maxW;
    h = w / ratio;
  }
  if (h > maxH) {
    h = maxH;
    w = h * ratio;
  }
  return { x: dirX < 0 ? ax - w : ax, y: dirY < 0 ? ay - h : ay, width: w, height: h };
}

/** The box after dragging `handle` by (dx, dy) image pixels from `start`. */
export function dragCrop(start: Crop, handle: Handle, dx: number, dy: number, W: number, H: number, ratio?: number): Crop {
  if (handle === 'move') {
    return snap({ ...start, x: clamp(start.x + dx, 0, W - start.width), y: clamp(start.y + dy, 0, H - start.height) }, W, H);
  }
  const min = Math.min(MIN_CROP, W, H);
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (handle.includes('w')) left = clamp(left + dx, 0, right - min);
  if (handle.includes('e')) right = clamp(right + dx, left + min, W);
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - min);
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + min, H);
  if (ratio && handle.length === 2) {
    const west = handle.includes('w');
    const north = handle.includes('n');
    const ax = west ? start.x + start.width : start.x;
    const ay = north ? start.y + start.height : start.y;
    return snap(withRatio(right - left, bottom - top, ratio, ax, ay, west ? -1 : 1, north ? -1 : 1, W, H), W, H);
  }
  return snap({ x: left, y: top, width: right - left, height: bottom - top }, W, H);
}

/** A new box dragged out from (ax, ay) to (bx, by). */
export function drawCrop(ax: number, ay: number, bx: number, by: number, W: number, H: number, ratio?: number): Crop {
  bx = clamp(bx, 0, W);
  by = clamp(by, 0, H);
  const dirX = bx < ax ? -1 : 1;
  const dirY = by < ay ? -1 : 1;
  const w = Math.abs(bx - ax);
  const h = Math.abs(by - ay);
  if (ratio && w && h) return snap(withRatio(w, h, ratio, ax, ay, dirX, dirY, W, H), W, H);
  return snap({ x: Math.min(ax, bx), y: Math.min(ay, by), width: w, height: h }, W, H);
}
