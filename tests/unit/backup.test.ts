import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { createBackup, openBackup, restoreBackup } from '@/lib/backup';
import { db, type ImageRecord } from '@/lib/db';
import { setDatasetsChangedHandler } from '@/lib/datasets';
import { BUILTIN_STYLES, DEFAULT_BACKEND } from '@/lib/settings';
import { readTar, TarWriter } from '@/lib/tar';
import { clearDb, dataset, JPEG_3X2, png, putImage, stubCanvas } from './helpers';

stubCanvas();
setDatasetsChangedHandler(() => {});

const RED = png(64, 48, [255, 0, 0]);
// Big enough that a cut can land inside its data.
const BLUE = png(64, 64, [0, 0, 255]);
const MY_STYLE = { id: 'mine', name: 'Mine', prompt: 'My prompt' };

async function seed() {
  await db.datasets.bulkAdd([
    dataset({
      id: 'd1',
      name: 'Character LoRA',
      triggerWord: 'ohwx',
      captionStyleId: 'mine',
      exportOptions: { layout: 'kohya', repeats: 5, className: 'woman', maxSide: 1024, metadata: true, skipBlank: false },
      createdAt: 1,
    }),
    // Same name: its folder gets a suffix.
    dataset({ id: 'd2', name: 'Character LoRA', createdAt: 2 }),
  ]);
  await putImage(
    {
      id: 'a',
      datasetId: 'd1',
      name: 'red',
      caption: 'ohwx, red',
      captionSource: 'auto',
      reviewed: true,
      crop: { x: 8, y: 8, width: 32, height: 32 },
      hint: 'back view',
      sourceUrl: 'https://example.com/red.png',
      pageUrl: 'https://example.com/post/1',
      addedAt: 1,
      updatedAt: 5,
    },
    RED,
  );
  await putImage({ id: 'b', datasetId: 'd1', name: 'frame', frameTime: 12.5, addedAt: 2 }, JPEG_3X2);
  await putImage({ id: 'c', datasetId: 'd2', caption: 'blue', captionSource: 'manual', addedAt: 3 }, BLUE);
  await fakeBrowser.storage.local.set({
    backend: { ...DEFAULT_BACKEND, preset: 'custom', baseUrl: 'https://llm.example', apiKey: 'sk-secret', model: 'qwen', v: 2 },
    captionStyles: [...BUILTIN_STYLES, MY_STYLE],
  });
}

const byId = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
const bytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

beforeEach(async () => {
  fakeBrowser.reset();
  vi.spyOn(fakeBrowser.runtime, 'getManifest').mockReturnValue({ manifest_version: 3, name: 'LatentNest', version: '0.1.0' });
  await clearDb();
});

describe('backup', () => {
  it('writes image/.txt folders a person can use without LatentNest, and no API key', async () => {
    await seed();
    const backup = await createBackup();
    expect(backup).toMatchObject({ datasets: 2, images: 3 });
    expect(backup.filename).toMatch(/^latentnest-backup-\d{4}-\d{2}-\d{2}\.tar$/);
    const { entries } = await readTar(backup.blob);
    expect(entries.map((e) => e.path)).toEqual([
      'latentnest-backup.json',
      'datasets/character_lora/0001.png',
      'datasets/character_lora/0001.txt',
      'datasets/character_lora/0002.jpg',
      'datasets/character_lora/0002.txt',
      'datasets/character_lora_2/0001.png',
      'datasets/character_lora_2/0001.txt',
    ]);
    expect(await bytes(entries[1]!.data)).toEqual(RED);
    expect(await bytes(entries[3]!.data)).toEqual(JPEG_3X2);
    expect(await entries[2]!.data.text()).toBe('ohwx, red');
    expect(await backup.blob.text()).not.toContain('sk-secret');
  });

  it('restores everything into an empty browser', async () => {
    await seed();
    const datasets = await db.datasets.toArray();
    const images = await db.images.toArray();
    const backup = await createBackup();

    await clearDb();
    fakeBrowser.reset();
    const opened = await openBackup(backup.blob);
    expect(opened).toMatchObject({ datasets: 2, images: 3, complete: true });
    expect(await restoreBackup(opened)).toEqual({
      datasetsAdded: 2,
      imagesAdded: 3,
      alreadyHere: 0,
      captionsFilled: 0,
      stylesAdded: 1,
      serverRestored: true,
      failed: [],
    });

    expect(byId(await db.datasets.toArray())).toEqual(byId(datasets));
    expect(byId(await db.images.toArray())).toEqual(byId(images));
    expect(await bytes((await db.originals.get('a'))!.blob)).toEqual(RED);
    expect(await db.thumbs.count()).toBe(3);
    const stored = await fakeBrowser.storage.local.get(['backend', 'captionStyles']);
    expect(stored.backend).toMatchObject({ preset: 'custom', baseUrl: 'https://llm.example', model: 'qwen', apiKey: '' });
    expect(stored.captionStyles).toEqual([...BUILTIN_STYLES, MY_STYLE]);
  });

  it('only adds what is missing, and fills blank captions', async () => {
    await seed();
    const backup = await createBackup();

    // Changes made here since the backup.
    await db.datasets.update('d1', { name: 'Renamed' });
    await db.images.update('a', { caption: '' });
    await db.images.update('c', { caption: 'edited here' });
    await db.transaction('rw', [db.images, db.originals], async () => {
      await db.images.delete('b');
      await db.originals.delete('b');
    });
    const backend = { ...DEFAULT_BACKEND, baseUrl: 'http://localhost:1234', apiKey: 'keep' };
    const local = { id: 'local', name: 'Local', prompt: 'Local prompt' };
    await fakeBrowser.storage.local.set({ backend, captionStyles: [...BUILTIN_STYLES, local] });

    const opened = await openBackup(backup.blob);
    expect(await restoreBackup(opened)).toEqual({
      datasetsAdded: 0,
      imagesAdded: 1,
      alreadyHere: 1,
      captionsFilled: 1,
      stylesAdded: 1,
      serverRestored: false,
      failed: [],
    });
    expect((await db.datasets.get('d1'))!.name).toBe('Renamed');
    expect(await db.images.get('a')).toMatchObject({ caption: 'ohwx, red', captionSource: 'import' });
    expect(await db.images.get('b')).toMatchObject({ datasetId: 'd1', frameTime: 12.5 });
    expect((await db.images.get('c'))!.caption).toBe('edited here');
    const stored = await fakeBrowser.storage.local.get(['backend', 'captionStyles']);
    expect(stored.backend).toEqual(backend);
    expect(stored.captionStyles).toEqual([...BUILTIN_STYLES, local, MY_STYLE]);

    // Running it again changes nothing.
    expect(await restoreBackup(opened)).toMatchObject({ imagesAdded: 0, alreadyHere: 3, captionsFilled: 0, stylesAdded: 0 });
  });

  it('restores the images a cut-off download contains', async () => {
    await seed();
    const { blob } = await createBackup();
    // The tail is BLUE's data blocks, its caption's header and one data block, then the end marker.
    const blueStart = blob.size - (Math.ceil(BLUE.length / 512) * 512 + 512 + 512 + 1024);
    const cut = blob.slice(0, blueStart + Math.floor(BLUE.length / 2));

    const opened = await openBackup(cut);
    expect(opened).toMatchObject({ images: 3, complete: false });
    await clearDb();
    const summary = await restoreBackup(opened);
    expect(summary).toMatchObject({ datasetsAdded: 2, imagesAdded: 2 });
    expect(summary.failed).toEqual(['datasets/character_lora_2/0001.png: missing from the archive']);
    expect((await db.images.toArray()).map((i: ImageRecord) => i.id).sort()).toEqual(['a', 'b']);
  });

  it('rejects other files and backups from a newer version', async () => {
    const tar = (manifest: unknown) => {
      const t = new TarWriter();
      t.add('latentnest-backup.json', JSON.stringify(manifest));
      return t.finish();
    };
    const notABackup = 'That file isn’t a LatentNest backup.';
    await expect(openBackup(new Blob(['hello'.repeat(200)]))).rejects.toThrow(notABackup);
    await expect(openBackup(tar({ format: 'something-else', datasets: [], images: [] }))).rejects.toThrow(notABackup);
    const other = new TarWriter();
    other.add('readme.txt', 'hi');
    await expect(openBackup(other.finish())).rejects.toThrow(notABackup);
    await expect(openBackup(tar({ format: 'latentnest-backup', version: 2, datasets: [], images: [] }))).rejects.toThrow(
      'newer version of LatentNest',
    );
  });

  it('drops malformed fields from a hand-edited manifest', async () => {
    const t = new TarWriter();
    t.add(
      'latentnest-backup.json',
      JSON.stringify({
        format: 'latentnest-backup',
        version: 1,
        datasets: [{ id: 'd1', name: '  ', createdAt: 'yesterday' }, { name: 'no id' }],
        images: [
          {
            id: 'x',
            datasetId: 'd1',
            file: 'x.png',
            mime: 'image/png',
            caption: 42,
            crop: { x: 60, y: 0, width: 32, height: 32 },
            sourceUrl: 'javascript:alert(1)',
            hint: 'h'.repeat(600),
          },
          { id: 'y', datasetId: 'missing', file: 'y.png' },
        ],
      }),
    );
    t.add('x.png', new Blob([RED as BlobPart]));
    const summary = await restoreBackup(await openBackup(t.finish()));
    expect(summary).toMatchObject({ datasetsAdded: 1, imagesAdded: 1 });
    expect(summary.failed).toEqual(['y.png: its dataset is missing from the backup']);
    expect((await db.datasets.get('d1'))!.name).toBe('Restored dataset');
    const x = (await db.images.get('x'))!;
    expect(x).toMatchObject({ caption: '', width: 64, height: 48 });
    expect(x.crop).toBeUndefined(); // outside the 64×48 image
    expect(x.sourceUrl).toBeUndefined();
    expect(x.hint).toHaveLength(500);
  });
});
