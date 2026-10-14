// Chrome offscreen document that runs batch auto-captioning. It outlives the
// side panel, and unlike the service worker it isn't stopped while waiting on
// a slow model. It only has the runtime API, so settings and the toolbar
// badge go through the background.
import { browser } from 'wxt/browser';
import { db } from '@/lib/db';
import { abortBatch, isLive, runQueuedBatch, type BatchMessage } from '@/lib/batch';
import type { BackendSettings, CaptionStyle } from '@/lib/settings';

const send = (msg: BatchMessage) => browser.runtime.sendMessage(msg);

let busy = false;
async function run() {
  if (busy) return;
  busy = true;
  const job = await db.jobs.get('batch');
  try {
    const settings = (await send({ type: 'batch:settings' })) as { backend: BackendSettings; styles: CaptionStyle[] };
    await runQueuedBatch(settings, {
      badge: (text) => void send({ type: 'batch:badge', text: text ?? '' }).catch(() => {}),
      ended: (job, cancelled) => void send({ type: 'batch:done', job, cancelled }).catch(() => {}),
    });
  } catch (err) {
    await db.jobs.update('batch', { running: false, error: err instanceof Error ? err.message : String(err) });
  } finally {
    busy = false;
    // A run queued while this one was finishing got no wake-up of its own.
    const next = await db.jobs.get('batch');
    if (next && isLive(next) && next.startedAt !== job?.startedAt) void run();
    // Otherwise the background closes this document.
    else void send({ type: 'batch:finished' }).catch(() => {});
  }
}

browser.runtime.onMessage.addListener((msg: BatchMessage) => {
  if (msg?.type === 'batch:wake') void run();
  else if (msg?.type === 'batch:cancel') abortBatch();
});

void run();
