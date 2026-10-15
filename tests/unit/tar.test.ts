import { describe, expect, it } from 'vitest';
import { readTar, TarError, TarWriter } from '@/lib/tar';

const bytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

describe('tar', () => {
  it('reads back what it writes, padded to 512-byte blocks', async () => {
    const tar = new TarWriter();
    const data = new Uint8Array(700).map((_, i) => i % 251);
    tar.add('a.txt', 'hello');
    tar.add('dir/b.bin', new Blob([data]));
    tar.add('empty.txt', '');
    const blob = tar.finish();
    // Three headers, 1 + 2 data blocks, two end blocks.
    expect(blob.size).toBe(512 * (3 + 3 + 2));
    const { entries, complete } = await readTar(blob);
    expect(complete).toBe(true);
    expect(entries.map((e) => e.path)).toEqual(['a.txt', 'dir/b.bin', 'empty.txt']);
    expect(await entries[0]!.data.text()).toBe('hello');
    expect(await bytes(entries[1]!.data)).toEqual(data);
    expect(entries[2]!.data.size).toBe(0);
  });

  it('splits long paths into the ustar prefix', async () => {
    const path = `datasets/${'a'.repeat(90)}/${'b'.repeat(90)}.png`;
    const tar = new TarWriter();
    tar.add(path, 'x');
    const { entries } = await readTar(tar.finish());
    expect(entries[0]!.path).toBe(path);
    expect(() => new TarWriter().add('x'.repeat(300), '')).toThrow('Path too long');
  });

  it('writes headers other tar readers accept', async () => {
    const tar = new TarWriter();
    tar.add('a.txt', 'hello', 1_700_000_000_000);
    const h = (await bytes(tar.finish())).subarray(0, 512);
    const text = (start: number, end: number) => new TextDecoder().decode(h.subarray(start, end));
    expect(text(257, 263)).toBe('ustar\0');
    expect(text(263, 265)).toBe('00');
    expect(text(124, 135)).toBe('00000000005'); // size, octal
    expect(parseInt(text(136, 147), 8)).toBe(1_700_000_000);
    const sum = h.reduce((s, b, i) => s + (i >= 148 && i < 156 ? 0x20 : b), 0);
    expect(parseInt(text(148, 154), 8)).toBe(sum);
  });

  it('returns the whole entries of a cut-off archive', async () => {
    const tar = new TarWriter();
    tar.add('one.txt', 'one');
    tar.add('two.bin', new Blob([new Uint8Array(2000)]));
    const blob = tar.finish();
    const cut = await readTar(blob.slice(0, 512 * 2 + 512 + 1000));
    expect(cut.complete).toBe(false);
    expect(cut.entries.map((e) => e.path)).toEqual(['one.txt']);
    // Garbage where the next header should be.
    const garbage = new Blob([blob.slice(0, 1024), new Uint8Array(512).fill(7)]);
    expect(await readTar(garbage)).toMatchObject({ complete: false, entries: [{ path: 'one.txt' }] });
  });

  it('rejects files that are not tar archives', async () => {
    await expect(readTar(new Blob(['not a tar'.repeat(100)]))).rejects.toBeInstanceOf(TarError);
    await expect(readTar(new Blob([]))).rejects.toBeInstanceOf(TarError);
  });
});
