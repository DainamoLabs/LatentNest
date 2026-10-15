import { describe, expect, it } from 'vitest';
import { dragCrop, drawCrop, fitAspect, fullCrop, isFullCrop, MIN_CROP } from '@/lib/crop';

const W = 1000;
const H = 600;

describe('crop', () => {
  it('fits the largest box of an aspect ratio, centered', () => {
    expect(fitAspect(W, H, 1)).toEqual({ x: 200, y: 0, width: 600, height: 600 });
    expect(fitAspect(W, H, 16 / 9)).toEqual({ x: 0, y: 19, width: 1000, height: 563 });
    // Centered on a point near the edge, it stops at the edge.
    expect(fitAspect(W, H, 1, 950, 300)).toEqual({ x: 400, y: 0, width: 600, height: 600 });
  });

  it('moves the box without leaving the image', () => {
    const box = { x: 100, y: 100, width: 200, height: 200 };
    expect(dragCrop(box, 'move', 50, -30, W, H)).toEqual({ x: 150, y: 70, width: 200, height: 200 });
    expect(dragCrop(box, 'move', 5000, 5000, W, H)).toEqual({ x: 800, y: 400, width: 200, height: 200 });
  });

  it('resizes from an edge, never below the minimum', () => {
    const box = { x: 100, y: 100, width: 200, height: 200 };
    expect(dragCrop(box, 'e', 100, 0, W, H)).toEqual({ x: 100, y: 100, width: 300, height: 200 });
    expect(dragCrop(box, 'w', 1000, 0, W, H)).toEqual({ x: 300 - MIN_CROP, y: 100, width: MIN_CROP, height: 200 });
    expect(dragCrop(box, 'n', 0, -500, W, H)).toEqual({ x: 100, y: 0, width: 200, height: 300 });
  });

  it('keeps the aspect ratio on corner drags, anchored at the opposite corner', () => {
    const box = { x: 100, y: 100, width: 200, height: 200 };
    expect(dragCrop(box, 'se', 100, 20, W, H, 1)).toEqual({ x: 100, y: 100, width: 300, height: 300 });
    expect(dragCrop(box, 'nw', -50, -10, W, H, 1)).toEqual({ x: 50, y: 50, width: 250, height: 250 });
    // Limited by the image edge.
    expect(dragCrop(box, 'se', 2000, 2000, W, H, 1)).toEqual({ x: 100, y: 100, width: 500, height: 500 });
  });

  it('draws a new box in any direction', () => {
    expect(drawCrop(500, 300, 400, 200, W, H)).toEqual({ x: 400, y: 200, width: 100, height: 100 });
    expect(drawCrop(500, 300, 900, 350, W, H, 2)).toEqual({ x: 500, y: 300, width: 400, height: 200 });
    expect(drawCrop(10, 10, -50, 700, W, H)).toEqual({ x: 0, y: 10, width: 10, height: 590 });
  });

  it('knows the full-image crop', () => {
    expect(isFullCrop(fullCrop(W, H), W, H)).toBe(true);
    expect(isFullCrop({ x: 0, y: 0, width: W, height: H - 1 }, W, H)).toBe(false);
  });
});
