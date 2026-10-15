import { Zip, ZipPassThrough, strToU8 } from 'fflate';
import { db, hasCaption, type Dataset, type ExportOptions } from './db';
import { toTrainingFormat } from './image';

export function slugify(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase() || 'dataset'
  );
}

export const DEFAULT_EXPORT: ExportOptions = {
  layout: 'standard',
  repeats: 10,
  className: '',
  maxSide: 0,
  metadata: false,
  skipBlank: false,
};

/** Image size choices (longest side); 0 keeps the original. */
export const MAX_SIDES = [0, 2048, 1536, 1024, 768];

/** Well-formed options from stored or restored data, or undefined if there are none. */
export function cleanExportOptions(raw: unknown): ExportOptions | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Partial<Record<keyof ExportOptions, unknown>>;
  const int = (v: unknown, min: number, max: number, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;
  return {
    layout: o.layout === 'kohya' ? 'kohya' : 'standard',
    repeats: int(o.repeats, 1, 1000, DEFAULT_EXPORT.repeats),
    className: typeof o.className === 'string' ? o.className.slice(0, 60) : '',
    maxSide: int(o.maxSide, 0, 16384, 0),
    metadata: o.metadata === true,
    skipBlank: o.skipBlank === true,
  };
}

export const exportOptionsFor = (dataset: Dataset): ExportOptions => cleanExportOptions(dataset.exportOptions) ?? DEFAULT_EXPORT;

/**
 * kohya_ss reads the repeat count from the folder name: `10_ohwx woman`. The
 * rest is the trigger word and class, used as the caption only for images
 * without a .txt file.
 */
export function kohyaFolderName(dataset: Pick<Dataset, 'name' | 'triggerWord'>, options: Pick<ExportOptions, 'repeats' | 'className'>) {
  const words = [dataset.triggerWord, options.className]
    // oxlint-disable-next-line no-control-regex -- control characters aren't allowed in file names
    .map((w) => (w ?? '').replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/[. ]+$/, '');
  return `${options.repeats}_${words || slugify(dataset.name)}`;
}

/** Folder the images and captions go in, inside the zip. */
export function exportFolder(dataset: Pick<Dataset, 'name' | 'triggerWord'>, options: ExportOptions) {
  const root = slugify(dataset.name);
  return options.layout === 'kohya' ? `${root}/${kohyaFolderName(dataset, options)}` : root;
}

/**
 * Builds `0001.png` + `0001.txt` pairs, the layout kohya_ss, ai-toolkit,
 * OneTrainer and SimpleTuner all read, optionally with a metadata.jsonl for
 * Hugging Face style trainers. Images are already compressed, so entries are
 * stored rather than deflated.
 */
export async function exportDatasetZip(
  dataset: Dataset,
  options: ExportOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<{ blob: Blob; filename: string; count: number }> {
  const all = await db.images.where('[datasetId+addedAt]').between([dataset.id, -Infinity], [dataset.id, Infinity]).toArray();
  const images = options.skipBlank ? all.filter(hasCaption) : all;
  const folder = exportFolder(dataset, options);
  const pad = Math.max(4, String(images.length).length);

  const chunks: Uint8Array[] = [];
  let finished!: () => void;
  let failed!: (e: unknown) => void;
  const done = new Promise<void>((res, rej) => ((finished = res), (failed = rej)));
  const zip = new Zip((err, chunk, final) => {
    if (err) return failed(err);
    chunks.push(chunk);
    if (final) finished();
  });
  const addFile = (path: string, data: Uint8Array) => {
    const entry = new ZipPassThrough(path);
    zip.add(entry);
    entry.push(data, true);
  };

  const metadata: string[] = [];
  let count = 0;
  for (const [i, img] of images.entries()) {
    const original = await db.originals.get(img.id);
    if (original) {
      const { blob, ext } = await toTrainingFormat(original.blob, img, options.maxSide);
      const stem = String(i + 1).padStart(pad, '0');
      const caption = img.caption.trim();
      addFile(`${folder}/${stem}.${ext}`, new Uint8Array(await blob.arrayBuffer()));
      addFile(`${folder}/${stem}.txt`, strToU8(caption));
      metadata.push(JSON.stringify({ file_name: `${stem}.${ext}`, text: caption }));
      count++;
    }
    onProgress?.(i + 1, images.length);
  }
  if (options.metadata) addFile(`${folder}/metadata.jsonl`, strToU8(metadata.map((line) => `${line}\n`).join('')));
  zip.end();
  await done;
  return { blob: new Blob(chunks as BlobPart[], { type: 'application/zip' }), filename: `${slugify(dataset.name)}.zip`, count };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
