// Shared fixtures for the unit tests: real image bytes, stand-ins for the
// canvas APIs Node lacks, and database helpers.
import { vi } from 'vitest';
import { crc32, deflateSync } from 'node:zlib';
import { db, type Dataset, type ImageRecord } from '@/lib/db';
import { sha256Hex } from '@/lib/image';

/** A valid RGB PNG filled with one color. */
export function png(width: number, height: number, rgb: [number, number, number] = [0, 0, 0]): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB, no interlace
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw, { level: 0 })),
      chunk('IEND', new Uint8Array()),
    ]),
  );
}

/** A real 3×2 baseline JPEG (made with sharp). */
export const JPEG_3X2 = new Uint8Array(
  Buffer.from(
    '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAMDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABv/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJAB58//2Q==',
    'base64',
  ),
);

/** Width and height from a PNG or JPEG header. */
function imageSize(b: Uint8Array): { width: number; height: number } {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b[0] === 0x89 && b[1] === 0x50) return { width: view.getUint32(16), height: view.getUint32(20) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length; i += 2 + view.getUint16(i + 2)) {
      const marker = b[i + 1]!;
      if (marker >= 0xc0 && marker <= 0xc3) return { width: view.getUint16(i + 7), height: view.getUint16(i + 5) };
    }
  }
  throw new Error('not a PNG or JPEG');
}

/**
 * Node has neither createImageBitmap nor OffscreenCanvas. These stand-ins
 * read the size from the file header and "encode" a placeholder, which is
 * enough for code that decodes images and draws thumbnails.
 */
export function stubCanvas() {
  vi.stubGlobal('createImageBitmap', async (blob: Blob) => ({
    ...imageSize(new Uint8Array(await blob.arrayBuffer())),
    close() {},
  }));
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      constructor(
        public width: number,
        public height: number,
      ) {}
      getContext() {
        return { drawImage() {}, fillRect() {} };
      }
      async convertToBlob(o?: { type?: string }) {
        return new Blob([`${this.width}x${this.height}`], { type: o?.type ?? 'image/png' });
      }
    },
  );
}

export async function clearDb() {
  await Promise.all(db.tables.map((t) => t.clear()));
}

export function dataset(fields: Partial<Dataset> & { id: string }): Dataset {
  return { name: fields.id, createdAt: 1, updatedAt: 1, lastUsedAt: 1, ...fields };
}

/** Stores an image record with its original bytes. */
export async function putImage(fields: Partial<ImageRecord> & { id: string; datasetId: string }, bytes: Uint8Array) {
  const isPng = bytes[0] === 0x89;
  const blob = new Blob([bytes as BlobPart], { type: isPng ? 'image/png' : 'image/jpeg' });
  const { width, height } = imageSize(bytes);
  await db.images.add({
    hash: await sha256Hex(blob),
    mime: isPng ? 'image/png' : 'image/jpeg',
    width,
    height,
    size: bytes.length,
    name: fields.id,
    caption: '',
    addedAt: 1,
    updatedAt: 1,
    ...fields,
  });
  await db.originals.add({ id: fields.id, blob });
}
