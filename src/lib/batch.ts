// Batch auto-captioning. The run lives outside the side panel so it keeps
// going after the panel closes: in Chrome inside an offscreen document (the
// service worker would be stopped during slow model calls), in Firefox inside
// the background event page. Progress is kept in IndexedDB, which every page
// watches, so a panel opened mid-run picks it up.
import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, hasCaption, type BatchJob, type ImageRecord } from './db';
import { fillCaptionIfBlank } from './datasets';
import { applyTrigger, CaptionError, generateCaption } from './captioner';
import { readBackend, resolveStyle, type BackendSettings, type CaptionStyle } from './settings';

export type BatchMessage =
  | { type: 'batch:start'; datasetId: string; ids?: string[] }
  | { type: 'batch:cancel' }
  /** Background → offscreen document: a job is waiting. */
  | { type: 'batch:wake' }
  /** Offscreen document → background (it can't read extension storage). */
  | { type: 'batch:settings' }
  | { type: 'batch:badge'; text: string }
  /** Offscreen document → background: a run ended, for the notification. */
  | { type: 'batch:done'; job: BatchJob; cancelled: boolean }
  | { type: 'batch:finished' };

const HEARTBEAT_MS = 10_000;
/** No heartbeat for this long means the runner was killed (browser closed, extension reloaded). */
const STALE_MS = 45_000;

export const isLive = (job: BatchJob | undefined): boolean => !!job?.running && Date.now() - job.heartbeatAt < STALE_MS;

/** Average time per image and the time left, once an image has finished. */
export function batchTiming(job: BatchJob, now = Date.now()): { perImage: number; left: number } | null {
  const finished = job.done + job.failed;
  if (!finished || !job.progressAt) return null;
  const perImage = (job.progressAt - job.startedAt) / finished;
  // Counts down while the current image runs.
  const left = Math.max(0, perImage * (job.total - finished) - (now - job.progressAt));
  return { perImage, left };
}

/** "38 s", "4 min", "1 h 5 min". */
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`;
}

// ------------------------------------------------------------- pages

/** The current or last run, as every page sees it. */
export function useBatch(): BatchJob | null {
  const job = useLiveQuery(() => db.jobs.get('batch'), []);
  const [, tick] = useState(0);
  // Re-check for a dead runner while one is supposedly working.
  useEffect(() => {
    if (!job?.running) return;
    const t = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, [job?.running]);
  if (!job) return null;
  if (job.running && !isLive(job)) {
    return { ...job, running: false, currentId: undefined, error: job.error ?? 'Captioning stopped unexpectedly.' };
  }
  return job;
}

/** Captions the dataset's blank images, or just the blank ones among `ids`. */
export async function startBatch(datasetId: string, ids?: string[]) {
  const reply = (await browser.runtime.sendMessage({ type: 'batch:start', datasetId, ids } satisfies BatchMessage)) as
    | { error?: string }
    | undefined;
  if (reply?.error) throw new Error(reply.error);
}

export function cancelBatch() {
  browser.runtime.sendMessage({ type: 'batch:cancel' } satisfies BatchMessage).catch(() => {});
}

/** Dismiss the summary of a finished run. */
export async function clearBatch() {
  const job = await db.jobs.get('batch');
  if (!isLive(job)) await db.jobs.delete('batch');
}

/** Records a new run; the runner picks it up. Returns an error message if one is already going. */
export async function queueBatch(datasetId: string, ids?: string[]): Promise<string | null> {
  return db.transaction('rw', db.jobs, async () => {
    if (isLive(await db.jobs.get('batch'))) return 'Another dataset is being captioned.';
    const now = Date.now();
    await db.jobs.put({ id: 'batch', datasetId, ids, total: 0, done: 0, failed: 0, running: true, startedAt: now, heartbeatAt: now });
    return null;
  });
}

/**
 * An update, reload or browser restart stops every extension page, the runner
 * included. Called by the background when it starts after one, so the run
 * shows as stopped right away rather than "running" until its heartbeat goes
 * stale, which also blocked starting it again.
 */
export async function endInterruptedBatch() {
  await db.transaction('rw', db.jobs, async () => {
    const job = await db.jobs.get('batch');
    if (!job?.running) return;
    await db.jobs.put({
      ...job,
      running: false,
      currentId: undefined,
      error: 'Captioning stopped because LatentNest restarted. Start it again to caption the rest.',
    });
  });
}

// ------------------------------------------------------------ runner

let controller: AbortController | null = null;

export function abortBatch() {
  controller?.abort();
}

export interface RunnerHooks {
  /** Toolbar badge: progress while running, null to clear. */
  badge: (text: string | null) => void;
  /** Called with each heartbeat; Firefox uses it to keep the event page alive. */
  keepAlive?: () => void;
  /** The run ended: finished, failed, or stopped by the user (`cancelled`). */
  ended?: (job: BatchJob, cancelled: boolean) => void;
}

/** Runs the queued job, if any. Only one runs at a time per context. */
export async function runQueuedBatch(
  settings: { backend: BackendSettings; styles: CaptionStyle[] },
  hooks: RunnerHooks,
): Promise<void> {
  if (controller) return;
  const job = await db.jobs.get('batch');
  if (!job || !isLive(job)) return;
  // The settings come from another context, which may run an older version
  // until the extension is reloaded: fill in anything it didn't know about.
  const backend = readBackend(settings.backend);
  controller = new AbortController();
  const { signal } = controller;

  let state = job;
  const save = async (patch: Partial<BatchJob>) => {
    state = { ...state, ...patch, heartbeatAt: Date.now() };
    await db.jobs.put(state);
  };
  const heartbeat = setInterval(() => {
    hooks.keepAlive?.();
    void db.jobs.update('batch', { heartbeatAt: Date.now() });
  }, HEARTBEAT_MS);
  const showProgress = () => {
    if (state.total) hooks.badge(`${Math.floor(((state.done + state.failed) / state.total) * 100)}%`);
  };

  try {
    const dataset = await db.datasets.get(job.datasetId);
    if (!dataset) throw new Error('That dataset no longer exists.');
    const style = resolveStyle(settings.styles, dataset.captionStyleId);
    if (!style) throw new CaptionError('Add a caption style in Settings first.', true);

    // A selection keeps the grid's order; a whole-dataset run goes newest
    // first, the grid's default, so the visible tiles fill in first.
    const blanks = job.ids
      ? (await db.images.bulkGet(job.ids)).filter(
          (img): img is ImageRecord => !!img && img.datasetId === dataset.id && !hasCaption(img),
        )
      : await db.images
          .where('[datasetId+addedAt]')
          .between([dataset.id, -Infinity], [dataset.id, Infinity])
          .reverse()
          .filter((img) => !hasCaption(img))
          .toArray();
    await save({ total: blanks.length });
    showProgress();

    let consecutiveFailures = 0;
    for (const { id } of blanks) {
      if (signal.aborted) break;
      await save({ currentId: id });
      // Fresh copy: the crop or hint may have changed, or someone captioned it by hand.
      const [image, original] = await Promise.all([db.images.get(id), db.originals.get(id)]);
      if (!image || !original || hasCaption(image)) {
        await save({ total: state.total - 1 });
        continue;
      }
      try {
        const caption = await generateCaption(original.blob, style, backend, { signal, crop: image.crop, hint: image.hint });
        // Read the trigger word fresh in case it was edited mid-run.
        const current = await db.datasets.get(dataset.id);
        await fillCaptionIfBlank(id, applyTrigger(caption, current?.triggerWord));
        consecutiveFailures = 0;
        await save({ done: state.done + 1, progressAt: Date.now() });
      } catch (err) {
        if (signal.aborted) break;
        await save({ failed: state.failed + 1, progressAt: Date.now(), error: err instanceof Error ? err.message : String(err) });
        if ((err instanceof CaptionError && err.fatal) || ++consecutiveFailures >= 3) break;
      }
      showProgress();
    }
  } catch (err) {
    await save({ error: err instanceof Error ? err.message : String(err) });
  } finally {
    clearInterval(heartbeat);
    await save({ running: false, currentId: undefined });
    hooks.badge(null);
    hooks.ended?.(state, signal.aborted);
    controller = null;
  }
}
