import { describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { db } from '@/lib/db';

// Every schema version that has shipped, exactly as declared in db.ts.
// Installed copies already have these on disk; Dexie can only move them
// forward through new versions.
const SHIPPED: Record<number, Record<string, string | null>> = {
  1: {
    datasets: 'id, lastUsedAt',
    images: 'id, datasetId, [datasetId+hash], [datasetId+addedAt]',
    originals: 'id',
    thumbs: 'id',
  },
  2: { jobs: 'id' },
};

type DexieVersion = { _cfg: { version: number; storesSource: Record<string, string | null> } };

describe('database schema', () => {
  // Runs first: `db` must not be open yet.
  it('upgrades a version 1 database without losing data', async () => {
    await Dexie.delete('latentnest');
    const v1 = new Dexie('latentnest');
    v1.version(1).stores(SHIPPED[1]!);
    await v1.table('datasets').add({ id: 'd1', name: 'Old', createdAt: 1, updatedAt: 1, lastUsedAt: 1 });
    await v1.table('images').add({ id: 'i1', datasetId: 'd1', hash: 'h1', caption: 'kept', addedAt: 1, updatedAt: 1 });
    await v1.table('originals').add({ id: 'i1', blob: new Blob(['bytes']) });
    await v1.table('thumbs').add({ id: 'i1', blob: new Blob(['thumb']) });
    v1.close();

    await db.open();
    expect(db.verno).toBe(Math.max(...Object.keys(SHIPPED).map(Number)));
    expect((await db.datasets.get('d1'))!.name).toBe('Old');
    expect(await db.images.where('[datasetId+hash]').equals(['d1', 'h1']).first()).toMatchObject({ caption: 'kept' });
    expect(await (await db.originals.get('i1'))!.blob.text()).toBe('bytes');
    expect(await db.thumbs.count()).toBe(1);
    expect(await db.jobs.count()).toBe(0);
    db.close();
  });

  it('keeps shipped versions unchanged', () => {
    const versions = (db as unknown as { _versions: DexieVersion[] })._versions;
    expect(versions, 'Dexie internals changed: update this test to read the declared versions').toBeDefined();
    const declared = Object.fromEntries(versions.map((v) => [v._cfg.version, v._cfg.storesSource]));
    const latest = Math.max(...versions.map((v) => v._cfg.version));
    for (const [version, stores] of Object.entries(SHIPPED)) {
      expect(
        declared[version],
        `Schema version ${version} was edited. Shipped versions must never change: put the new stores in ` +
          `db.version(${latest + 1}), with .upgrade() if existing rows need rewriting, and add it to SHIPPED here.`,
      ).toEqual(stores);
    }
    const added = Object.keys(declared).filter((v) => !(v in SHIPPED));
    expect(added, 'New schema version: add it to SHIPPED in this test. Once released, never edit it.').toEqual([]);
  });
});
