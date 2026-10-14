// Minimal ustar archives for backups. Entries reference Blobs rather than
// copying bytes, so a multi-gigabyte backup is assembled (and read back)
// without loading the images into memory, and there's no 4 GB ZIP limit.

const BLOCK = 512;
const MAX_SIZE = 0o77777777777; // 11 octal digits, about 8 GB per file
const enc = new TextEncoder();
const dec = new TextDecoder();

function writeString(h: Uint8Array, offset: number, bytes: Uint8Array, length: number) {
  h.set(bytes.subarray(0, length), offset);
}

function writeOctal(h: Uint8Array, offset: number, value: number, length: number) {
  writeString(h, offset, enc.encode(value.toString(8).padStart(length - 1, '0') + '\0'), length);
}

const readString = (h: Uint8Array, offset: number, length: number) => {
  const field = h.subarray(offset, offset + length);
  const end = field.indexOf(0);
  return dec.decode(end < 0 ? field : field.subarray(0, end));
};

const readOctal = (h: Uint8Array, offset: number, length: number) =>
  parseInt(readString(h, offset, length).trim() || '0', 8);

const checksum = (h: Uint8Array) => h.reduce((sum, b, i) => sum + (i >= 148 && i < 156 ? 0x20 : b), 0);

/** Splits a path into ustar's 155-byte prefix and 100-byte name at a slash. */
function splitPath(path: string): [prefix: string, name: string] {
  if (enc.encode(path).length <= 100) return ['', path];
  for (let i = path.lastIndexOf('/'); i > 0; i = path.lastIndexOf('/', i - 1)) {
    const prefix = path.slice(0, i);
    const name = path.slice(i + 1);
    if (enc.encode(prefix).length <= 155 && enc.encode(name).length <= 100) return [prefix, name];
  }
  throw new Error(`Path too long for the archive: ${path}`);
}

function header(path: string, size: number, mtime: number): Uint8Array {
  if (size > MAX_SIZE) throw new Error(`${path} is too large for the archive.`);
  const [prefix, name] = splitPath(path);
  const h = new Uint8Array(BLOCK);
  writeString(h, 0, enc.encode(name), 100);
  writeOctal(h, 100, 0o644, 8);
  writeOctal(h, 108, 0, 8);
  writeOctal(h, 116, 0, 8);
  writeOctal(h, 124, size, 12);
  writeOctal(h, 136, Math.floor(mtime / 1000), 12);
  h[156] = 0x30; // regular file
  writeString(h, 257, enc.encode('ustar\u000000'), 8);
  writeString(h, 345, enc.encode(prefix), 155);
  writeOctal(h, 148, checksum(h), 7);
  h[155] = 0x20;
  return h;
}

export class TarWriter {
  private parts: BlobPart[] = [];

  add(path: string, data: Blob | string, mtime = Date.now()) {
    const blob = typeof data === 'string' ? new Blob([data]) : data;
    this.parts.push(header(path, blob.size, mtime) as BlobPart, blob);
    const pad = (BLOCK - (blob.size % BLOCK)) % BLOCK;
    if (pad) this.parts.push(new Uint8Array(pad) as BlobPart);
  }

  finish(): Blob {
    return new Blob([...this.parts, new Uint8Array(BLOCK * 2) as BlobPart], { type: 'application/x-tar' });
  }
}

export class TarError extends Error {}

/**
 * Lists a tar's regular files. Each entry's data is a slice of `file`, not a
 * copy. An archive that ends early (an interrupted download) still returns
 * the entries that are whole, with `complete: false`.
 */
export async function readTar(file: Blob): Promise<{ entries: { path: string; data: Blob }[]; complete: boolean }> {
  const entries: { path: string; data: Blob }[] = [];
  let offset = 0;
  while (offset + BLOCK <= file.size) {
    const h = new Uint8Array(await file.slice(offset, offset + BLOCK).arrayBuffer());
    if (h.every((b) => b === 0)) return { entries, complete: true }; // end-of-archive marker
    if (readOctal(h, 148, 8) !== checksum(h)) {
      if (!entries.length) throw new TarError('Not a tar archive.');
      return { entries, complete: false }; // garbage after a cut
    }
    const size = readOctal(h, 124, 12);
    const name = readString(h, 0, 100);
    const prefix = readString(h, 257, 5) === 'ustar' ? readString(h, 345, 155) : '';
    const start = offset + BLOCK;
    if (start + size > file.size) break;
    if (h[156] === 0x30 || h[156] === 0) entries.push({ path: prefix ? `${prefix}/${name}` : name, data: file.slice(start, start + size) });
    offset = start + Math.ceil(size / BLOCK) * BLOCK;
  }
  if (!entries.length) throw new TarError('Not a tar archive.');
  return { entries, complete: false };
}
