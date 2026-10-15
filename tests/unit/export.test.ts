import { beforeEach, describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { db, type ExportOptions } from '@/lib/db';
import { cleanExportOptions, DEFAULT_EXPORT, exportDatasetZip, exportFolder, kohyaFolderName, slugify } from '@/lib/export';
import { clearDb, dataset, JPEG_3X2, png, putImage } from './helpers';

const options = (o: Partial<ExportOptions> = {}): ExportOptions => ({ ...DEFAULT_EXPORT, ...o });

describe('names', () => {
  it('slugifies dataset names', () => {
    expect(slugify('Character LoRA (v2)')).toBe('character_lora_v2');
    expect(slugify('Café Crème')).toBe('cafe_creme');
    expect(slugify('日本語')).toBe('dataset');
  });

  it('names the kohya folder repeats_trigger class', () => {
    const ds = { name: 'Character LoRA', triggerWord: 'ohwx' };
    expect(kohyaFolderName(ds, { repeats: 10, className: 'woman' })).toBe('10_ohwx woman');
    expect(kohyaFolderName(ds, { repeats: 3, className: '' })).toBe('3_ohwx');
    expect(kohyaFolderName({ name: 'Character LoRA' }, { repeats: 5, className: '' })).toBe('5_character_lora');
    // Characters Windows can't put in a folder name, and trailing dots.
    expect(kohyaFolderName({ name: 'x', triggerWord: 'a/b:c' }, { repeats: 1, className: 'd.. ' })).toBe('1_a b c d');
  });

  it('nests the kohya folder inside the dataset folder', () => {
    const ds = { name: 'Character LoRA', triggerWord: 'ohwx' };
    expect(exportFolder(ds, options())).toBe('character_lora');
    expect(exportFolder(ds, options({ layout: 'kohya', className: 'woman' }))).toBe('character_lora/10_ohwx woman');
  });

  it('cleans stored options', () => {
    expect(cleanExportOptions(undefined)).toBeUndefined();
    expect(cleanExportOptions({ layout: 'weird', repeats: 99999, maxSide: -5, className: 7, metadata: 'yes' })).toEqual({
      ...DEFAULT_EXPORT,
      repeats: 1000,
    });
    expect(cleanExportOptions({ layout: 'kohya', repeats: 2.6, maxSide: 1024, metadata: true, skipBlank: true })).toEqual({
      layout: 'kohya',
      repeats: 3,
      className: '',
      maxSide: 1024,
      metadata: true,
      skipBlank: true,
    });
  });
});

describe('exportDatasetZip', () => {
  const red = png(4, 3, [255, 0, 0]);
  const blue = png(2, 2, [0, 0, 255]);
  const ds = dataset({ id: 'd1', name: 'Character LoRA', triggerWord: 'ohwx' });

  beforeEach(async () => {
    await clearDb();
    await db.datasets.add(ds);
    // Added out of order: the export goes oldest first.
    await putImage({ id: 'b', datasetId: 'd1', caption: 'ohwx, jpeg  ', addedAt: 2 }, JPEG_3X2);
    await putImage({ id: 'a', datasetId: 'd1', caption: 'ohwx, red', addedAt: 1 }, red);
    await putImage({ id: 'c', datasetId: 'd1', caption: '  ', addedAt: 3 }, blue);
    await putImage({ id: 'other', datasetId: 'd2', caption: 'not mine' }, blue);
  });

  async function entries(o: ExportOptions) {
    const result = await exportDatasetZip(ds, o);
    return { ...result, files: unzipSync(new Uint8Array(await result.blob.arrayBuffer())) };
  }

  it('writes numbered image/.txt pairs, copying PNG and JPEG unchanged', async () => {
    const { files, filename, count } = await entries(options());
    expect(filename).toBe('character_lora.zip');
    expect(count).toBe(3);
    expect(Object.keys(files).sort()).toEqual([
      'character_lora/0001.png',
      'character_lora/0001.txt',
      'character_lora/0002.jpg',
      'character_lora/0002.txt',
      'character_lora/0003.png',
      'character_lora/0003.txt',
    ]);
    expect(files['character_lora/0001.png']).toEqual(red);
    expect(files['character_lora/0002.jpg']).toEqual(JPEG_3X2);
    expect(strFromU8(files['character_lora/0002.txt']!)).toBe('ohwx, jpeg');
    // A blank caption still gets its (empty) .txt file.
    expect(strFromU8(files['character_lora/0003.txt']!)).toBe('');
  });

  it('leaves out uncaptioned images when asked', async () => {
    const { files, count } = await entries(options({ skipBlank: true }));
    expect(count).toBe(2);
    expect(Object.keys(files).sort()).toEqual([
      'character_lora/0001.png',
      'character_lora/0001.txt',
      'character_lora/0002.jpg',
      'character_lora/0002.txt',
    ]);
  });

  it('uses the kohya folder and writes metadata.jsonl', async () => {
    const { files } = await entries(options({ layout: 'kohya', repeats: 20, className: 'woman', metadata: true, skipBlank: true }));
    const folder = 'character_lora/20_ohwx woman';
    expect(Object.keys(files)).toContain(`${folder}/0001.png`);
    expect(strFromU8(files[`${folder}/metadata.jsonl`]!)).toBe(
      '{"file_name":"0001.png","text":"ohwx, red"}\n{"file_name":"0002.jpg","text":"ohwx, jpeg"}\n',
    );
  });

  it('copies images smaller than the size limit unchanged', async () => {
    const { files } = await entries(options({ maxSide: 768 }));
    expect(files['character_lora/0001.png']).toEqual(red);
  });
});
