import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import {
  addFromContextMenu,
  CAPTION,
  expect,
  readStore,
  tarEntries,
  test,
  useCaptionServer,
} from './fixtures';

interface Row {
  id: string;
  name: string;
  caption: string;
  captionSource?: string;
  pageUrl?: string;
  sourceUrl?: string;
}

test('add images, auto-caption, export and back up', async ({ context, site, captionServer, extUrl }) => {
  // ---- Add to Dataset → New dataset…, then into that dataset
  const page = await context.newPage();
  await page.goto(site.pageUrl);
  await addFromContextMenu(context, page, site.imageUrl('red.png'), { datasetName: 'E2E set' });
  const [dataset] = await readStore<Row>(context, 'datasets');
  expect(dataset?.name).toBe('E2E set');
  const datasetId = dataset!.id;
  await addFromContextMenu(context, page, site.imageUrl('green.jpg'), { datasetId });
  // The same bytes again are skipped.
  await addFromContextMenu(context, page, site.imageUrl('green.jpg'), { datasetId });

  const added = await readStore<Row>(context, 'images');
  expect(added).toHaveLength(2);
  expect(added.map((img) => img.sourceUrl).sort()).toEqual([site.imageUrl('green.jpg'), site.imageUrl('red.png')]);
  expect(added.every((img) => img.pageUrl === site.pageUrl)).toBe(true);

  // ---- The panel (in a tab) lists the dataset and its images
  const panel = await context.newPage();
  await panel.goto(extUrl('sidepanel.html#tab'));
  await panel.getByRole('button', { name: /E2E set/ }).first().click();
  await expect(panel.getByRole('heading', { name: 'E2E set' })).toBeVisible();
  await expect(panel.getByText('2 images · 0 captioned')).toBeVisible();
  await expect(panel.getByRole('button', { name: /640×480, no caption/ })).toHaveCount(2);

  // ---- Batch auto-captioning against the fake server
  await useCaptionServer(context, captionServer);
  await panel.getByRole('button', { name: 'Auto-caption 2 blank images' }).click();
  await expect(panel.getByText('2 images · 2 captioned')).toBeVisible();
  await expect(panel.getByRole('button', { name: /auto caption to review/ })).toHaveCount(2);
  const captioned = await readStore<Row>(context, 'images');
  expect(captioned.map((img) => [img.caption, img.captionSource])).toEqual([
    [CAPTION, 'auto'],
    [CAPTION, 'auto'],
  ]);
  expect(captionServer.requests).toBe(2);

  // ---- Export ZIP: image/.txt pairs
  await panel.getByRole('button', { name: 'More actions' }).click();
  await panel.getByRole('menuitem', { name: 'Export ZIP…' }).click();
  const zipDownload = panel.waitForEvent('download');
  await panel.getByRole('button', { name: 'Export 2 images' }).click();
  const zip = await zipDownload;
  expect(zip.suggestedFilename()).toBe('e2e_set.zip');
  const files = unzipSync(await readFile(await zip.path()));
  const names = Object.keys(files).filter((name) => !name.endsWith('/')).sort();
  expect(names).toHaveLength(4);
  const images = names.filter((name) => /\.(png|jpe?g)$/.test(name));
  expect(images).toHaveLength(2);
  for (const image of images) {
    const txt = image.replace(/\.\w+$/, '.txt');
    expect(names).toContain(txt);
    expect(strFromU8(files[txt]!)).toBe(CAPTION);
  }
  // PNG and JPEG are copied byte-for-byte.
  expect(images.map((name) => name.split('.').pop()).sort()).toEqual(['jpg', 'png']);

  // ---- Settings → Back up everything
  const options = await context.newPage();
  await options.goto(extUrl('options.html'));
  const backupDownload = options.waitForEvent('download');
  await options.getByRole('button', { name: 'Back up everything' }).click();
  const backup = await backupDownload;
  expect(backup.suggestedFilename()).toMatch(/^latentnest-backup-\d{4}-\d{2}-\d{2}\.tar$/);
  const entries = tarEntries(await readFile(await backup.path()));
  expect(entries).toContain('latentnest-backup.json');
  const inDataset = entries.filter((name) => name.startsWith('datasets/'));
  expect(inDataset.filter((name) => name.endsWith('.txt'))).toHaveLength(2);
  expect(inDataset.filter((name) => /\.(png|jpe?g)$/.test(name))).toHaveLength(2);
  await expect(options.getByText('Never backed up')).toBeHidden();
});
