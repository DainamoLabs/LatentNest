import { describe, expect, it } from 'vitest';
import type { ImageRecord } from '@/lib/db';
import { filterImages, megapixels, sortImages, stepGridSize } from '@/lib/grid';

const img = (id: string, o: Partial<ImageRecord> = {}): ImageRecord => ({
  id,
  datasetId: 'd',
  hash: id,
  mime: 'image/png',
  width: 1000,
  height: 1000,
  size: 1,
  name: id,
  caption: '',
  addedAt: 0,
  updatedAt: 0,
  ...o,
});

describe('grid', () => {
  const images = [
    img('blank', { caption: '  ', addedAt: 1 }),
    img('manual', { caption: 'a long manual caption', captionSource: 'manual', addedAt: 2 }),
    img('auto', { caption: 'auto', captionSource: 'auto', addedAt: 3 }),
    img('approved', { caption: 'ok', captionSource: 'auto', reviewed: true, addedAt: 4 }),
  ];
  const ids = (list: ImageRecord[]) => list.map((i) => i.id);

  it('filters by caption state', () => {
    expect(ids(filterImages(images, 'blank'))).toEqual(['blank']);
    expect(ids(filterImages(images, 'done'))).toEqual(['manual', 'auto', 'approved']);
    expect(ids(filterImages(images, 'review'))).toEqual(['auto']);
    expect(filterImages(images, 'all')).toBe(images);
  });

  it('sorts, breaking ties newest first', () => {
    expect(ids(sortImages(images, 'newest'))).toEqual(['approved', 'auto', 'manual', 'blank']);
    expect(ids(sortImages(images, 'caption'))).toEqual(['blank', 'approved', 'auto', 'manual']);
    const named = [img('a', { name: 'img10' }), img('b', { name: 'img9' }), img('c', { name: 'IMG2' })];
    expect(ids(sortImages(named, 'name'))).toEqual(['c', 'b', 'a']);
  });

  it('sorts by the cropped short side', () => {
    const list = [
      img('big', { width: 2000, height: 1500 }),
      img('cropped', { width: 4000, height: 4000, crop: { x: 0, y: 0, width: 300, height: 800 } }),
      img('small', { width: 512, height: 640 }),
    ];
    expect(ids(sortImages(list, 'size'))).toEqual(['cropped', 'small', 'big']);
  });

  it('steps tile sizes and formats megapixels', () => {
    expect(stepGridSize('small', -1)).toBe('small');
    expect(stepGridSize('small', 1)).toBe('medium');
    expect(stepGridSize('large', 1)).toBe('large');
    expect(megapixels(1024, 1024)).toBe('1.05 MP');
    expect(megapixels(6000, 4000)).toBe('24.0 MP');
    expect(megapixels(50, 50)).toBe('<0.01 MP');
  });
});
