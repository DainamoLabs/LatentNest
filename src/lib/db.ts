import Dexie, { type EntityTable } from 'dexie';

export interface Dataset {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Drives the ordering of the "Add to Dataset" context menu. */
  lastUsedAt: number;
  captionStyleId?: string;
  /** Prepended to auto-generated captions, e.g. "ohwx woman". */
  triggerWord?: string;
  /** The choices from the last export, offered again next time. */
  exportOptions?: ExportOptions;
}

export interface ExportOptions {
  /** 'standard': `<name>/0001.png` + `0001.txt`. 'kohya': the images go in a `<repeats>_<trigger> <class>` folder. */
  layout: 'standard' | 'kohya';
  repeats: number;
  /** kohya class word, e.g. "woman". */
  className: string;
  /** Longest side in pixels; 0 keeps the original size. */
  maxSide: number;
  /** Also write metadata.jsonl, for Hugging Face / diffusers trainers. */
  metadata: boolean;
  /** Leave out images whose caption is blank. */
  skipBlank: boolean;
}

export type CaptionSource = 'manual' | 'auto' | 'import';

/** A region of the original image, in its pixels. */
export interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Image metadata. Pixel data lives in `originals` / `thumbs` so listing stays cheap. */
export interface ImageRecord {
  id: string;
  datasetId: string;
  /** SHA-256 of the original bytes; used to reject duplicates within a dataset. */
  hash: string;
  mime: string;
  width: number;
  height: number;
  size: number;
  /** Original file name without extension, for reference only. */
  name: string;
  caption: string;
  captionSource?: CaptionSource;
  sourceUrl?: string;
  pageUrl?: string;
  /** Seconds into the video, for frames grabbed with "Add Frame to Dataset". */
  frameTime?: number;
  /** Applied when captioning and exporting; the original stays untouched. */
  crop?: Crop;
  /** Extra context sent to the model with the caption style, e.g. "back view". */
  hint?: string;
  /** Someone approved this auto caption. Editing it by hand also takes it out of review. */
  reviewed?: boolean;
  addedAt: number;
  updatedAt: number;
}

export interface BlobRecord {
  id: string;
  blob: Blob;
  /** Thumbnails only: THUMB_VERSION when drawn (missing on the first, smaller ones). */
  v?: number;
}

/** Progress of the batch auto-captioning run, shared by every page. */
export interface BatchJob {
  id: 'batch';
  datasetId: string;
  /** Only these images (a selection); otherwise every blank one in the dataset. */
  ids?: string[];
  total: number;
  done: number;
  failed: number;
  running: boolean;
  currentId?: string;
  error?: string;
  startedAt: number;
  /** When the last image finished (captioned or failed), for the time estimate. */
  progressAt?: number;
  /** Bumped regularly by the runner; a stale one means the run was killed. */
  heartbeatAt: number;
}

class LatentNestDB extends Dexie {
  datasets!: EntityTable<Dataset, 'id'>;
  images!: EntityTable<ImageRecord, 'id'>;
  originals!: EntityTable<BlobRecord, 'id'>;
  thumbs!: EntityTable<BlobRecord, 'id'>;
  jobs!: EntityTable<BatchJob, 'id'>;

  constructor() {
    super('latentnest');
    this.version(1).stores({
      datasets: 'id, lastUsedAt',
      images: 'id, datasetId, [datasetId+hash], [datasetId+addedAt]',
      originals: 'id',
      thumbs: 'id',
    });
    this.version(2).stores({ jobs: 'id' });
  }
}

export const db = new LatentNestDB();

export const hasCaption = (img: Pick<ImageRecord, 'caption'>) => img.caption.trim().length > 0;

/** An auto caption nobody has approved or edited yet. */
export const needsReview = (img: Pick<ImageRecord, 'caption' | 'captionSource' | 'reviewed'>) =>
  img.captionSource === 'auto' && !img.reviewed && hasCaption(img);

/** Size of the image as trained on, after any crop. */
export const outputSize = (img: Pick<ImageRecord, 'width' | 'height' | 'crop'>) =>
  img.crop ? { width: img.crop.width, height: img.crop.height } : { width: img.width, height: img.height };
