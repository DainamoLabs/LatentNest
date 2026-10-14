import { browser } from 'wxt/browser';
import { db, needsReview, type CaptionSource, type Crop, type Dataset, type ImageRecord, type BlobRecord } from './db';
import { makeThumb, processImage, THUMB_VERSION } from './image';

// The background rebuilds the context menu when datasets change. Pages ask it
// to via a message; the background swaps in a direct call.
let onDatasetsChanged = () => {
  browser.runtime.sendMessage({ type: 'menus:refresh' }).catch(() => {});
};
export function setDatasetsChangedHandler(fn: () => void) {
  onDatasetsChanged = fn;
}
/** Call after adding images so the menu's most-recently-used order stays current. */
export const notifyDatasetsChanged = () => onDatasetsChanged();

export async function createDataset(name: string): Promise<Dataset> {
  const now = Date.now();
  const dataset: Dataset = {
    id: crypto.randomUUID(),
    name: name.trim() || 'Untitled dataset',
    createdAt: now,
    updatedAt: now,
    lastUsedAt: now,
  };
  await db.datasets.add(dataset);
  onDatasetsChanged();
  return dataset;
}

export async function updateDataset(id: string, changes: Partial<Omit<Dataset, 'id'>>) {
  await db.datasets.update(id, { ...changes, updatedAt: Date.now() });
  if ('name' in changes) onDatasetsChanged();
}

export async function deleteDataset(id: string) {
  await db.transaction('rw', [db.datasets, db.images, db.originals, db.thumbs], async () => {
    const ids = (await db.images.where('datasetId').equals(id).primaryKeys()) as string[];
    await Promise.all([db.originals.bulkDelete(ids), db.thumbs.bulkDelete(ids), db.images.bulkDelete(ids)]);
    await db.datasets.delete(id);
  });
  onDatasetsChanged();
}

export async function setCaption(imageId: string, caption: string, source: CaptionSource) {
  // A new caption starts out unreviewed.
  await db.images.update(imageId, { caption, captionSource: source, reviewed: undefined, updatedAt: Date.now() });
}

/** Only writes if the caption is still blank, so batch runs never clobber user edits. */
export async function fillCaptionIfBlank(imageId: string, caption: string): Promise<boolean> {
  return db.transaction('rw', db.images, async () => {
    const img = await db.images.get(imageId);
    if (!img || img.caption.trim()) return false;
    await db.images.update(imageId, { caption, captionSource: 'auto', reviewed: undefined, updatedAt: Date.now() });
    return true;
  });
}

export interface CaptionSnapshot {
  id: string;
  caption: string;
  captionSource?: CaptionSource;
  reviewed?: boolean;
}

/**
 * Rewrites the captions in a dataset (or just `ids`) with `edit`, which must
 * be synchronous. It runs inside the transaction on fresh data, so captions
 * written in the meantime (e.g. by a batch run) aren't overwritten with stale
 * text. An edited auto caption stays in review: a bulk change isn't a
 * read-through. Returns the previous captions for undo.
 */
export async function editCaptions(
  datasetId: string,
  edit: (caption: string) => string,
  ids?: Iterable<string>,
): Promise<CaptionSnapshot[]> {
  const only = ids && new Set(ids);
  return db.transaction('rw', db.images, async () => {
    const before: CaptionSnapshot[] = [];
    const updates: { key: string; changes: Partial<ImageRecord> }[] = [];
    const now = Date.now();
    await db.images.where('datasetId').equals(datasetId).each((img) => {
      if (only && !only.has(img.id)) return;
      const next = edit(img.caption);
      if (next === img.caption) return;
      before.push({ id: img.id, caption: img.caption, captionSource: img.captionSource, reviewed: img.reviewed });
      updates.push({
        key: img.id,
        changes: next.trim()
          ? { caption: next, updatedAt: now }
          : { caption: next, captionSource: undefined, reviewed: undefined, updatedAt: now },
      });
    });
    await db.images.bulkUpdate(updates);
    return before;
  });
}

export async function restoreCaptions(snapshots: CaptionSnapshot[]) {
  const now = Date.now();
  await db.images.bulkUpdate(
    snapshots.map((s) => ({
      key: s.id,
      changes: { caption: s.caption, captionSource: s.captionSource, reviewed: s.reviewed, updatedAt: now },
    })),
  );
}

/**
 * Approves auto captions (or puts them back in review). Returns the ids that
 * changed, for undo.
 */
export async function setReviewed(ids: string[], reviewed: boolean): Promise<string[]> {
  return db.transaction('rw', db.images, async () => {
    const changed = (await db.images.bulkGet(ids)).flatMap((img) =>
      img && (reviewed ? needsReview(img) : img.reviewed) ? [img.id] : [],
    );
    await db.images.bulkUpdate(changed.map((key) => ({ key, changes: { reviewed: reviewed || undefined } })));
    return changed;
  });
}

export interface HintSnapshot {
  id: string;
  hint?: string;
}

/** Sets (or clears, with '') the captioning hint. Returns the previous hints for undo. */
export async function setHints(ids: string[], hint: string): Promise<HintSnapshot[]> {
  const value = hint.trim() || undefined;
  return db.transaction('rw', db.images, async () => {
    const before = (await db.images.bulkGet(ids)).flatMap((img) => (img && img.hint !== value ? [{ id: img.id, hint: img.hint }] : []));
    await db.images.bulkUpdate(before.map(({ id }) => ({ key: id, changes: { hint: value } })));
    return before;
  });
}

export async function restoreHints(snapshots: HintSnapshot[]) {
  await db.images.bulkUpdate(snapshots.map(({ id, hint }) => ({ key: id, changes: { hint } })));
}

/** Sets or clears (undefined) an image's crop and redraws its thumbnail to match. */
export async function setCrop(imageId: string, crop: Crop | undefined) {
  const original = await db.originals.get(imageId);
  if (!original) throw new Error('The image data is missing.');
  const thumb = await makeThumb(original.blob, crop);
  await db.transaction('rw', [db.images, db.thumbs], async () => {
    await db.images.update(imageId, { crop, updatedAt: Date.now() });
    await db.thumbs.put({ id: imageId, blob: thumb, v: THUMB_VERSION });
  });
}

let thumbQueue: Promise<unknown> = Promise.resolve();

/**
 * Redraws an image's thumbnail at the current size, one image at a time.
 * Resolves true once an up-to-date thumbnail is stored.
 */
export function refreshThumb(imageId: string): Promise<boolean> {
  const run = thumbQueue.then(async () => {
    const [image, original, thumb] = await Promise.all([db.images.get(imageId), db.originals.get(imageId), db.thumbs.get(imageId)]);
    if (thumb?.v === THUMB_VERSION) return true;
    if (!image || !original) return false;
    const blob = await makeThumb(original.blob, image.crop);
    return db.transaction('rw', [db.images, db.thumbs], async () => {
      const now = await db.images.get(imageId);
      // A crop made in the meantime drew its own thumbnail.
      if (!now || JSON.stringify(now.crop) !== JSON.stringify(image.crop)) return false;
      await db.thumbs.put({ id: imageId, blob, v: THUMB_VERSION });
      return true;
    });
  });
  thumbQueue = run.catch(() => false);
  return run.catch(() => false);
}

export interface DeletedImage {
  image: ImageRecord;
  original?: BlobRecord;
  thumb?: BlobRecord;
}

/** Deletes and returns what was removed so the caller can offer undo. */
export async function deleteImages(ids: string[]): Promise<DeletedImage[]> {
  return db.transaction('rw', [db.images, db.originals, db.thumbs], async () => {
    const [images, originals, thumbs] = await Promise.all([db.images.bulkGet(ids), db.originals.bulkGet(ids), db.thumbs.bulkGet(ids)]);
    const deleted = images.flatMap((image, i) => (image ? [{ image, original: originals[i], thumb: thumbs[i] }] : []));
    const gone = deleted.map((d) => d.image.id);
    await Promise.all([db.images.bulkDelete(gone), db.originals.bulkDelete(gone), db.thumbs.bulkDelete(gone)]);
    return deleted;
  });
}

export async function deleteImage(id: string): Promise<DeletedImage | null> {
  return (await deleteImages([id]))[0] ?? null;
}

export async function restoreImages(deleted: DeletedImage[]) {
  await db.transaction('rw', [db.images, db.originals, db.thumbs], async () => {
    await db.images.bulkPut(deleted.map((d) => d.image));
    await db.originals.bulkPut(deleted.flatMap((d) => (d.original ? [d.original] : [])));
    await db.thumbs.bulkPut(deleted.flatMap((d) => (d.thumb ? [d.thumb] : [])));
  });
}

export const restoreImage = (deleted: DeletedImage) => restoreImages([deleted]);

export interface TransferResult {
  /** Ids of the moved images, or of the new copies. */
  ids: string[];
  /** Images the target dataset already had. */
  skipped: number;
}

async function transfer(ids: string[], targetId: string, copy: boolean): Promise<TransferResult> {
  const result = await db.transaction('rw', [db.datasets, db.images, db.originals, db.thumbs], async () => {
    if (!(await db.datasets.get(targetId))) throw new Error('That dataset no longer exists.');
    const done: string[] = [];
    let skipped = 0;
    for (const img of await db.images.bulkGet(ids)) {
      if (!img || img.datasetId === targetId) continue;
      if (await db.images.where('[datasetId+hash]').equals([targetId, img.hash]).first()) {
        skipped++;
        continue;
      }
      if (!copy) {
        await db.images.update(img.id, { datasetId: targetId });
        done.push(img.id);
        continue;
      }
      const [original, thumb] = await Promise.all([db.originals.get(img.id), db.thumbs.get(img.id)]);
      if (!original) continue;
      const id = crypto.randomUUID();
      await db.images.add({ ...img, id, datasetId: targetId });
      await db.originals.add({ id, blob: original.blob });
      if (thumb) await db.thumbs.add({ ...thumb, id });
      done.push(id);
    }
    if (done.length) {
      const now = Date.now();
      await db.datasets.update(targetId, { updatedAt: now, lastUsedAt: now });
    }
    return { ids: done, skipped };
  });
  if (result.ids.length) onDatasetsChanged();
  return result;
}

/** Moves images to another dataset, leaving behind any it already has. */
export const moveImages = (ids: string[], targetId: string) => transfer(ids, targetId, false);

/** Copies images (with captions, crops and hints) to another dataset, skipping any it already has. */
export const copyImages = (ids: string[], targetId: string) => transfer(ids, targetId, true);

export interface AddImageMeta {
  name?: string;
  sourceUrl?: string;
  pageUrl?: string;
  frameTime?: number;
  caption?: string;
  captionSource?: CaptionSource;
}

export type AddResult =
  | { status: 'added'; image: ImageRecord }
  | { status: 'duplicate'; image: ImageRecord; captionFilled: boolean };

export async function addImage(datasetId: string, blob: Blob, meta: AddImageMeta = {}): Promise<AddResult> {
  // Decode and hash before opening the transaction; awaiting non-IndexedDB
  // work inside one would let it auto-commit.
  const processed = await processImage(blob);
  const now = Date.now();
  const caption = meta.caption?.trim() ?? '';

  return db.transaction('rw', [db.datasets, db.images, db.originals, db.thumbs], async () => {
    const existing = await db.images.where('[datasetId+hash]').equals([datasetId, processed.hash]).first();
    if (existing) {
      // Re-importing a folder with captions fills in ones that are still blank.
      const captionFilled = !!caption && !existing.caption.trim();
      if (captionFilled) {
        await db.images.update(existing.id, { caption, captionSource: meta.captionSource ?? 'import', updatedAt: now });
      }
      return { status: 'duplicate', image: existing, captionFilled } as const;
    }
    if (!(await db.datasets.get(datasetId))) throw new Error('That dataset no longer exists.');

    const image: ImageRecord = {
      id: crypto.randomUUID(),
      datasetId,
      hash: processed.hash,
      mime: processed.mime,
      width: processed.width,
      height: processed.height,
      size: blob.size,
      name: meta.name || 'image',
      caption,
      captionSource: caption ? (meta.captionSource ?? 'import') : undefined,
      sourceUrl: meta.sourceUrl,
      pageUrl: meta.pageUrl,
      frameTime: meta.frameTime,
      addedAt: now,
      updatedAt: now,
    };
    await db.images.add(image);
    await db.originals.add({ id: image.id, blob: blob.type ? blob : new Blob([blob], { type: processed.mime }) });
    await db.thumbs.add({ id: image.id, blob: processed.thumb, v: THUMB_VERSION });
    await db.datasets.update(datasetId, { updatedAt: now, lastUsedAt: now });
    return { status: 'added', image } as const;
  });
}

export async function datasetStats(datasetId: string) {
  let total = 0;
  let captioned = 0;
  await db.images.where('datasetId').equals(datasetId).each((img) => {
    total++;
    if (img.caption.trim()) captioned++;
  });
  return { total, captioned };
}
