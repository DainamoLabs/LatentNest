// Whole-library backup: every dataset, image, caption and caption style in
// one .tar file. Inside, each dataset is also a plain folder of image/.txt
// pairs, so a backup stays useful even without LatentNest. The JSON manifest
// holds everything else (crops, hints, review state, sources, settings). The
// API key is left out.
import { browser } from 'wxt/browser';
import { db, hasCaption, type CaptionSource, type Crop, type Dataset, type ImageRecord } from './db';
import { notifyDatasetsChanged } from './datasets';
import { cleanExportOptions, slugify } from './export';
import { EXT_BY_MIME, makeThumb, processImage, THUMB_VERSION } from './image';
import { DEFAULT_BACKEND, readBackend, type BackendSettings, type CaptionStyle } from './settings';
import { readTar, TarWriter } from './tar';

const MANIFEST = 'latentnest-backup.json';
const FORMAT = 'latentnest-backup';
const VERSION = 1;
const LAST_BACKUP_KEY = 'lastBackupAt';

type BackupImage = ImageRecord & { file: string };

interface BackupManifest {
  format: typeof FORMAT;
  version: number;
  createdAt: number;
  appVersion: string;
  settings: { backend?: Omit<BackendSettings, 'apiKey'>; captionStyles?: CaptionStyle[] };
  datasets: Dataset[];
  images: BackupImage[];
}

// ------------------------------------------------------------- backup

function localDate(t: number) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function createBackup(
  onProgress?: (done: number, total: number) => void,
): Promise<{ blob: Blob; filename: string; datasets: number; images: number }> {
  const now = Date.now();
  // Oldest first, so folder names stay the same from one backup to the next.
  const datasets = (await db.datasets.toArray()).sort((a, b) => a.createdAt - b.createdAt);
  const stored = await browser.storage.local.get(['backend', 'captionStyles']);
  const { apiKey: _omit, ...backend } = readBackend(stored.backend);
  const manifest: BackupManifest = {
    format: FORMAT,
    version: VERSION,
    createdAt: now,
    appVersion: browser.runtime.getManifest().version,
    settings: {
      backend: stored.backend ? backend : undefined,
      captionStyles: stored.captionStyles as CaptionStyle[] | undefined,
    },
    datasets,
    images: [],
  };

  const files: [path: string, data: Blob | string][] = [];
  const folders = new Set<string>();
  const total = await db.images.count();
  let done = 0;
  for (const dataset of datasets) {
    const base = slugify(dataset.name).slice(0, 60);
    let folder = base;
    for (let n = 2; folders.has(folder); n++) folder = `${base}_${n}`;
    folders.add(folder);

    const images = await db.images
      .where('[datasetId+addedAt]')
      .between([dataset.id, -Infinity], [dataset.id, Infinity])
      .toArray();
    const pad = Math.max(4, String(images.length).length);
    for (const [i, img] of images.entries()) {
      const original = await db.originals.get(img.id);
      onProgress?.(++done, total);
      if (!original) continue;
      const stem = `datasets/${folder}/${String(i + 1).padStart(pad, '0')}`;
      const file = `${stem}.${EXT_BY_MIME[img.mime] ?? 'bin'}`;
      manifest.images.push({ ...img, file });
      files.push([file, original.blob], [`${stem}.txt`, img.caption.trim()]);
    }
  }

  const tar = new TarWriter();
  tar.add(MANIFEST, JSON.stringify(manifest), now); // first, so it's easy to find by hand
  for (const [path, data] of files) tar.add(path, data, now);
  return {
    blob: tar.finish(),
    filename: `latentnest-backup-${localDate(now)}.tar`,
    datasets: datasets.length,
    images: manifest.images.length,
  };
}

export async function markBackedUp() {
  await browser.storage.local.set({ [LAST_BACKUP_KEY]: Date.now() });
}

export async function lastBackupAt(): Promise<number | undefined> {
  return (await browser.storage.local.get(LAST_BACKUP_KEY))[LAST_BACKUP_KEY] as number | undefined;
}

// ------------------------------------------------------------ restore

export interface OpenedBackup {
  createdAt: number;
  datasets: number;
  images: number;
  /** False when the file ends early, e.g. an interrupted download. */
  complete: boolean;
  /** Internal: what restoreBackup works from. */
  manifest: BackupManifest;
  entries: Map<string, Blob>;
}

const NOT_A_BACKUP = 'That file isn’t a LatentNest backup.';

/** Reads a backup's manifest so the user can confirm before anything is written. */
export async function openBackup(file: Blob): Promise<OpenedBackup> {
  let tar: Awaited<ReturnType<typeof readTar>>;
  try {
    tar = await readTar(file);
  } catch {
    throw new Error(NOT_A_BACKUP);
  }
  const map = new Map(tar.entries.map((e) => [e.path, e.data]));
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(await map.get(MANIFEST)!.text());
  } catch {
    throw new Error(NOT_A_BACKUP);
  }
  if (manifest?.format !== FORMAT || !Array.isArray(manifest.datasets) || !Array.isArray(manifest.images)) {
    throw new Error(NOT_A_BACKUP);
  }
  if (manifest.version > VERSION) {
    throw new Error('This backup was made by a newer version of LatentNest. Update the extension, then try again.');
  }
  return {
    createdAt: manifest.createdAt,
    datasets: manifest.datasets.length,
    images: manifest.images.length,
    complete: tar.complete,
    manifest,
    entries: map,
  };
}

export interface RestoreSummary {
  datasetsAdded: number;
  imagesAdded: number;
  alreadyHere: number;
  captionsFilled: number;
  stylesAdded: number;
  serverRestored: boolean;
  failed: string[];
}

// The manifest is user-supplied: keep only well-formed fields.
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const SOURCES: CaptionSource[] = ['manual', 'auto', 'import'];
const webUrl = (v: unknown) => (typeof v === 'string' && /^https?:\/\//i.test(v) ? v : undefined);

function cleanDataset(raw: Dataset): Dataset | null {
  const id = str(raw?.id);
  if (!id) return null;
  const now = Date.now();
  return {
    id,
    name: str(raw.name)?.trim() || 'Restored dataset',
    createdAt: num(raw.createdAt) ?? now,
    updatedAt: num(raw.updatedAt) ?? now,
    lastUsedAt: num(raw.lastUsedAt) ?? now,
    captionStyleId: str(raw.captionStyleId),
    triggerWord: str(raw.triggerWord),
    exportOptions: cleanExportOptions(raw.exportOptions),
  };
}

function cleanCrop(raw: unknown, width: number, height: number): Crop | undefined {
  const c = raw as Crop | undefined;
  if (!c || [c.x, c.y, c.width, c.height].some((v) => num(v) === undefined)) return undefined;
  if (c.x < 0 || c.y < 0 || c.width < 1 || c.height < 1 || c.x + c.width > width || c.y + c.height > height) return undefined;
  return { x: c.x, y: c.y, width: c.width, height: c.height };
}

function cleanStyles(raw: unknown): CaptionStyle[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((s) => {
    const id = str(s?.id);
    const name = str(s?.name);
    const prompt = str(s?.prompt);
    return id && name && prompt ? [{ id, name, prompt, ...(s.builtin === true && { builtin: true }) }] : [];
  });
}

async function restoreSettings(manifest: BackupManifest, summary: RestoreSummary) {
  const stored = await browser.storage.local.get(['backend', 'captionStyles']);
  const styles = cleanStyles(manifest.settings?.captionStyles);
  if (styles.length) {
    if (!stored.captionStyles) {
      // Never customized here: take the backup's list as-is, order and all.
      await browser.storage.local.set({ captionStyles: styles });
      summary.stylesAdded = styles.filter((s) => !s.builtin).length;
    } else {
      const current = stored.captionStyles as CaptionStyle[];
      const added = styles.filter((s) => !current.some((c) => c.id === s.id || c.prompt === s.prompt));
      if (added.length) await browser.storage.local.set({ captionStyles: [...current, ...added] });
      summary.stylesAdded = added.length;
    }
  }
  // Server settings only fill an unconfigured install; they never replace yours.
  const backend = manifest.settings?.backend;
  if (backend && !stored.backend && typeof backend === 'object') {
    await browser.storage.local.set({ backend: { ...DEFAULT_BACKEND, ...backend, apiKey: '' } });
    summary.serverRestored = true;
  }
}

/**
 * Adds whatever in the backup is missing here. Nothing existing is changed or
 * deleted, except that blank captions are filled from the backup. Safe to run
 * again after an interruption.
 */
export async function restoreBackup(
  backup: OpenedBackup,
  onProgress?: (done: number, total: number) => void,
): Promise<RestoreSummary> {
  const { manifest, entries } = backup;
  const summary: RestoreSummary = {
    datasetsAdded: 0,
    imagesAdded: 0,
    alreadyHere: 0,
    captionsFilled: 0,
    stylesAdded: 0,
    serverRestored: false,
    failed: [],
  };
  await restoreSettings(manifest, summary);

  const datasetIds = new Set<string>();
  for (const raw of manifest.datasets) {
    const dataset = cleanDataset(raw);
    if (!dataset) continue;
    datasetIds.add(dataset.id);
    if (!(await db.datasets.get(dataset.id))) {
      await db.datasets.add(dataset);
      summary.datasetsAdded++;
    }
  }

  for (const [i, raw] of manifest.images.entries()) {
    onProgress?.(i, manifest.images.length);
    const file = str(raw?.file) ?? '(unnamed)';
    try {
      const datasetId = str(raw?.datasetId);
      if (!datasetId || !datasetIds.has(datasetId)) throw new Error('its dataset is missing from the backup');
      const data = entries.get(file);
      if (!data) throw new Error('missing from the archive');
      const blob = new Blob([data], { type: str(raw.mime) ?? '' });
      // Outside the transaction: awaiting non-database work inside one would commit it early.
      const processed = await processImage(blob);
      const crop = cleanCrop(raw.crop, processed.width, processed.height);
      const thumb = crop ? await makeThumb(blob, crop) : processed.thumb;
      const caption = str(raw.caption)?.trim() ?? '';

      await db.transaction('rw', [db.images, db.originals, db.thumbs], async () => {
        const existing = await db.images.where('[datasetId+hash]').equals([datasetId, processed.hash]).first();
        if (existing) {
          if (caption && !hasCaption(existing)) {
            await db.images.update(existing.id, { caption, captionSource: 'import', updatedAt: Date.now() });
            summary.captionsFilled++;
          } else {
            summary.alreadyHere++;
          }
          return;
        }
        const wanted = str(raw.id);
        const id = wanted && !(await db.images.get(wanted)) ? wanted : crypto.randomUUID();
        const now = Date.now();
        await db.images.add({
          id,
          datasetId,
          hash: processed.hash,
          mime: processed.mime,
          width: processed.width,
          height: processed.height,
          size: blob.size,
          name: str(raw.name) || 'image',
          caption,
          captionSource: caption ? (SOURCES.find((s) => s === raw.captionSource) ?? 'import') : undefined,
          reviewed: caption && raw.reviewed === true ? true : undefined,
          hint: str(raw.hint)?.trim().slice(0, 500) || undefined,
          sourceUrl: webUrl(raw.sourceUrl),
          pageUrl: webUrl(raw.pageUrl),
          frameTime: num(raw.frameTime),
          crop,
          addedAt: num(raw.addedAt) ?? now,
          updatedAt: num(raw.updatedAt) ?? now,
        });
        await db.originals.add({ id, blob });
        await db.thumbs.add({ id, blob: thumb, v: THUMB_VERSION });
        summary.imagesAdded++;
      });
    } catch (err) {
      summary.failed.push(`${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  onProgress?.(manifest.images.length, manifest.images.length);
  notifyDatasetsChanged();
  return summary;
}
