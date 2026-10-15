import type { Worker } from '@playwright/test';
import type { browser } from 'wxt/browser';
import { addFromContextMenu, CAPTION, expect, readStore, serviceWorker, test, useCaptionServer } from './fixtures';

declare const chrome: typeof browser;

interface Job {
  running: boolean;
  done: number;
  error?: string;
}

// An extension update (here: chrome.runtime.reload(), which is what an update
// does to running pages) stops the batch runner mid-image. The run used to
// look alive, and refuse a restart, until its heartbeat went stale (45 s).
test('a batch interrupted by an update shows as stopped and can be restarted', async ({ context, site, captionServer, extUrl }) => {
  const page = await context.newPage();
  await page.goto(site.pageUrl);
  await addFromContextMenu(context, page, site.imageUrl('red.png'), { datasetName: 'Reload set' });
  const [dataset] = await readStore<{ id: string }>(context, 'datasets');
  const datasetId = dataset!.id;
  await addFromContextMenu(context, page, site.imageUrl('green.jpg'), { datasetId });
  await addFromContextMenu(context, page, site.imageUrl('blue.png'), { datasetId });

  captionServer.delayMs = 2000;
  await useCaptionServer(context, captionServer);
  const panel = await context.newPage();
  await panel.goto(extUrl(`sidepanel.html#tab/dataset/${datasetId}`));
  await panel.getByRole('button', { name: 'Auto-caption 3 blank images' }).click();
  // One image done, the second in flight.
  await expect.poll(async () => (await readStore<Job>(context, 'jobs'))[0]?.done).toBe(1);

  const old = await serviceWorker(context);
  const restarted = context.waitForEvent('serviceworker', { predicate: (w: Worker) => w !== old });
  await old.evaluate(() => void setTimeout(() => chrome.runtime.reload(), 50)).catch(() => {});
  const sw = await restarted;

  await expect
    .poll(async () => (await readStore<Job>(context, 'jobs'))[0], { timeout: 10_000 })
    .toMatchObject({ running: false, done: 1, error: expect.stringContaining('LatentNest restarted') });
  expect(await sw.evaluate(() => chrome.action.getBadgeText({}))).toBe('');

  // The reload closed the panel; a new one offers to finish the rest.
  const reopened = await context.newPage();
  await reopened.goto(extUrl(`sidepanel.html#tab/dataset/${datasetId}`));
  await expect(reopened.getByText(/LatentNest restarted/)).toBeVisible();
  captionServer.delayMs = 0;
  await reopened.getByRole('button', { name: 'Auto-caption 2 blank images' }).click();
  await expect(reopened.getByText('3 images · 3 captioned')).toBeVisible();

  // Nothing lost or captioned twice.
  const captions = (await readStore<{ caption: string }>(context, 'images')).map((img) => img.caption);
  expect(captions).toEqual([CAPTION, CAPTION, CAPTION]);
});
