// Filtering, sorting, tile sizes and size labels for the image grid. The
// editor steps through images in the same order.
import { hasCaption, needsReview, outputSize, type ImageRecord } from './db';

export type GridFilter = 'all' | 'blank' | 'done' | 'review';

export function filterImages(images: ImageRecord[], filter: GridFilter): ImageRecord[] {
  if (filter === 'blank') return images.filter((img) => !hasCaption(img));
  if (filter === 'done') return images.filter(hasCaption);
  if (filter === 'review') return images.filter(needsReview);
  return images;
}

export type SortKey = 'newest' | 'oldest' | 'name' | 'size' | 'caption' | 'edited';

export const SORTS: { key: SortKey; label: string }[] = [
  { key: 'newest', label: 'Newest first' },
  { key: 'oldest', label: 'Oldest first' },
  { key: 'name', label: 'Name' },
  { key: 'size', label: 'Smallest first' },
  { key: 'caption', label: 'Shortest caption first' },
  { key: 'edited', label: 'Recently edited' },
];

export const isSortKey = (v: unknown): v is SortKey => SORTS.some((s) => s.key === v);

export type GridSize = 'small' | 'medium' | 'large';

export const GRID_SIZES: { key: GridSize; label: string }[] = [
  { key: 'small', label: 'Small' },
  { key: 'medium', label: 'Medium' },
  { key: 'large', label: 'Large' },
];

export const isGridSize = (v: unknown): v is GridSize => GRID_SIZES.some((s) => s.key === v);

/** One size up (+1) or down (-1), stopping at the ends. */
export function stepGridSize(size: GridSize, step: 1 | -1): GridSize {
  const i = GRID_SIZES.findIndex((s) => s.key === size);
  return GRID_SIZES[Math.max(0, Math.min(GRID_SIZES.length - 1, i + step))]!.key;
}

/** What each tile says about the image's size; low-res images are flagged either way. */
export type SizeLabel = 'off' | 'dimensions' | 'megapixels';

export const SIZE_LABELS: { key: SizeLabel; label: string }[] = [
  { key: 'off', label: 'Off' },
  { key: 'dimensions', label: 'Dimensions' },
  { key: 'megapixels', label: 'Megapixels' },
];

export const isSizeLabel = (v: unknown): v is SizeLabel => SIZE_LABELS.some((s) => s.key === v);

/** "1.05 MP". Two decimals below 10 MP, where the ~1 MP training targets sit. */
export function megapixels(width: number, height: number): string {
  const mp = (width * height) / 1e6;
  if (mp < 0.01) return '<0.01 MP';
  return `${mp < 10 ? mp.toFixed(2) : mp.toFixed(1)} MP`;
}

const shortSide = (img: ImageRecord) => {
  const { width, height } = outputSize(img);
  return Math.min(width, height);
};
const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

const COMPARE: Record<SortKey, (a: ImageRecord, b: ImageRecord) => number> = {
  newest: (a, b) => b.addedAt - a.addedAt,
  oldest: (a, b) => a.addedAt - b.addedAt,
  name: (a, b) => byName.compare(a.name, b.name),
  size: (a, b) => shortSide(a) - shortSide(b),
  caption: (a, b) => a.caption.trim().length - b.caption.trim().length,
  edited: (a, b) => b.updatedAt - a.updatedAt,
};

/** A sorted copy; ties fall back to newest first. */
export function sortImages(images: ImageRecord[], key: SortKey): ImageRecord[] {
  const compare = COMPARE[key];
  return [...images].sort((a, b) => compare(a, b) || b.addedAt - a.addedAt || a.id.localeCompare(b.id));
}
