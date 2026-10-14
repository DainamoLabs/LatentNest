import { unzipSync } from 'fflate';
import { addImage, notifyDatasetsChanged } from './datasets';
import { nameFromUrl, stripExt } from './image';

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;
const CAPTION_EXT = /\.(txt|caption)$/i;
const JUNK = /(^|\/)(__MACOSX\/|\._|\.DS_Store$|Thumbs\.db$)/;

export interface InputFile {
  /** Relative path inside a folder or zip; just the name for loose files. */
  path: string;
  blob: Blob;
}

export interface ImportSummary {
  added: number;
  duplicates: number;
  captions: number;
  failed: { name: string; reason: string }[];
}

async function unpack(files: InputFile[]): Promise<InputFile[]> {
  const out: InputFile[] = [];
  for (const f of files) {
    if (!/\.zip$/i.test(f.path)) {
      out.push(f);
      continue;
    }
    const entries = unzipSync(new Uint8Array(await f.blob.arrayBuffer()));
    for (const [path, data] of Object.entries(entries)) {
      if (path.endsWith('/')) continue;
      out.push({ path, blob: new Blob([data as BlobPart]) });
    }
  }
  return out.filter((f) => !JUNK.test(f.path));
}

/**
 * Imports loose images, folders and zips. `foo.png` picks up its caption from
 * a sibling `foo.txt`, the convention every LoRA trainer uses.
 */
export async function importFiles(
  datasetId: string,
  input: InputFile[],
  onProgress?: (done: number, total: number) => void,
): Promise<ImportSummary> {
  const files = await unpack(input);
  const captions = new Map<string, string>();
  for (const f of files) {
    if (CAPTION_EXT.test(f.path)) captions.set(stripExt(f.path), (await f.blob.text()).trim());
  }
  const images = files.filter((f) => IMAGE_EXT.test(f.path));
  const summary: ImportSummary = { added: 0, duplicates: 0, captions: 0, failed: [] };

  for (const [i, f] of images.entries()) {
    const key = stripExt(f.path);
    const caption = captions.get(key);
    try {
      const result = await addImage(datasetId, f.blob, {
        name: stripExt(f.path.split('/').pop() ?? f.path),
        caption,
        captionSource: 'import',
      });
      if (result.status === 'added') {
        summary.added++;
        if (caption) summary.captions++;
      } else {
        summary.duplicates++;
        if (result.captionFilled) summary.captions++;
      }
    } catch (err) {
      summary.failed.push({ name: f.path, reason: err instanceof Error ? err.message : String(err) });
    }
    onProgress?.(i + 1, images.length);
  }
  if (images.length === 0 && files.length > 0) {
    summary.failed.push({ name: 'Import', reason: 'No supported images found.' });
  }
  notifyDatasetsChanged();
  return summary;
}

/** Fetch an image dropped or pasted as a URL. Extension pages bypass CORS for granted hosts. */
export async function importUrl(datasetId: string, url: string) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`Download failed (${res.status}).`);
  const result = await addImage(datasetId, await res.blob(), { name: nameFromUrl(url), sourceUrl: url });
  notifyDatasetsChanged();
  return result;
}

// ---- DataTransfer helpers -------------------------------------------------

type FsEntry = FileSystemEntry;

async function readEntry(entry: FsEntry, prefix: string, out: InputFile[]) {
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
    out.push({ path: prefix + file.name, blob: file });
    return;
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  // readEntries returns results in batches until it yields an empty array.
  for (;;) {
    const batch = await new Promise<FsEntry[]>((res, rej) => reader.readEntries(res, rej));
    if (!batch.length) break;
    for (const child of batch) await readEntry(child, `${prefix}${entry.name}/`, out);
  }
}

/**
 * Collect files (recursing into dropped folders) and image URLs from a drop.
 * Must be called synchronously inside the drop handler: the DataTransfer is
 * emptied once the event returns.
 */
export function collectDrop(dt: DataTransfer): { files: Promise<InputFile[]>; urls: string[] } {
  const entries = Array.from(dt.items)
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry?.())
    .filter((e): e is FsEntry => !!e);

  const files = (async () => {
    if (!entries.length) return Array.from(dt.files, (f) => ({ path: f.name, blob: f as Blob }));
    const out: InputFile[] = [];
    for (const entry of entries) await readEntry(entry, '', out);
    return out;
  })();

  let urls: string[] = [];
  if (!entries.length && !dt.files.length) {
    // An <img> dragged from a web page arrives as HTML and/or a URI list.
    const html = dt.getData('text/html');
    const src = html && new DOMParser().parseFromString(html, 'text/html').querySelector('img')?.src;
    const list = dt
      .getData('text/uri-list')
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith('#'));
    urls = src ? [src] : list.slice(0, 1);
  }
  return { files, urls };
}

export function filesFromInput(list: FileList | null): InputFile[] {
  return Array.from(list ?? [], (f) => ({ path: f.webkitRelativePath || f.name, blob: f }));
}
