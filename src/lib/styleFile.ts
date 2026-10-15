import { unzipSync } from 'fflate';
import { formatBytes } from './image';

/** Prompt files that can become caption styles, alone or in a .zip. */
export const STYLE_FILE_ACCEPT = '.txt,.md,.markdown,.zip,text/plain,text/markdown,application/zip';
const MAX_BYTES = 64 * 1024;
const MAX_ZIP_BYTES = 10 * 1024 * 1024;

export const isStyleFile = (name: string) => /\.(txt|md|markdown)$/i.test(name);
const isMarkdown = (name: string) => /\.(md|markdown)$/i.test(name);

/** A YAML scalar's text: "double quoted" (with escapes), 'single quoted' or plain. */
function unquote(value: string): string {
  if (/^".*"$/.test(value)) {
    try {
      return String(JSON.parse(value));
    } catch {
      /* not valid JSON escapes; strip the quotes below */
    }
  }
  return value.replace(/^(['"])(.*)\1$/, '$2');
}

function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // Not UTF-8: most likely saved by an older Windows editor.
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/**
 * Turns a prompt file's text into a style. The name comes from the file name,
 * or from `name:` / `title:` in a Markdown file's front matter, which is not
 * sent to the model.
 */
export function parseStyleText(fileName: string, text: string): { name: string; prompt: string } {
  let body = text.replace(/\r\n?/g, '\n');
  let name = '';
  const frontMatter = isMarkdown(fileName) ? /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(body) : null;
  if (frontMatter) {
    body = body.slice(frontMatter[0].length);
    const field = /^(?:name|title):[ \t]*(.+)$/im.exec(frontMatter[1] ?? '');
    name = unquote(field?.[1]?.trim() ?? '').trim();
  }
  const prompt = body.trim();
  if (!prompt) throw new Error(`“${fileName}” is empty.`);
  name ||= fileName.replace(/\.[^.]+$/, '').trim() || 'Imported style';
  return { name: name.slice(0, 60), prompt };
}

export async function readStyleFile(file: File): Promise<{ name: string; prompt: string }> {
  if (!isStyleFile(file.name)) throw new Error(`“${file.name}” isn’t a .txt or .md file.`);
  if (file.size > MAX_BYTES) {
    throw new Error(`“${file.name}” is ${formatBytes(file.size)}, too long for a caption prompt (64 KB max).`);
  }
  const text = decodeText(new Uint8Array(await file.arrayBuffer()));
  if (text.includes('\0')) throw new Error(`“${file.name}” doesn’t look like a text file.`);
  return parseStyleText(file.name, text);
}

/** The .txt / .md files inside dropped or chosen files, with any .zip unpacked. */
export async function expandStyleFiles(files: File[]): Promise<{ files: File[]; failed: string[] }> {
  const out: File[] = [];
  const failed: string[] = [];
  for (const file of files) {
    if (!/\.zip$/i.test(file.name)) {
      out.push(file);
      continue;
    }
    if (file.size > MAX_ZIP_BYTES) {
      failed.push(`“${file.name}” is ${formatBytes(file.size)}, too big for a zip of caption styles (10 MB max).`);
      continue;
    }
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(new Uint8Array(await file.arrayBuffer()), {
        filter: (f) => isStyleFile(f.name) && !/(^|\/)(__MACOSX\/|\._)/.test(f.name) && f.originalSize <= MAX_BYTES * 2,
      });
    } catch {
      failed.push(`“${file.name}” isn’t a valid zip file.`);
      continue;
    }
    const inside = Object.entries(entries).map(([path, data]) => new File([data as BlobPart], path.split('/').pop() ?? path));
    if (inside.length) out.push(...inside);
    else failed.push(`“${file.name}” has no .txt or .md files in it.`);
  }
  return { files: out, failed };
}

/**
 * A style as a Markdown file that "Import .txt / .md" reads back: the name in
 * front matter (a JSON string is valid YAML), then the instructions.
 */
export function styleToMarkdown(style: { name: string; prompt: string }): string {
  return `---\nname: ${JSON.stringify(style.name)}\n---\n\n${style.prompt.trim()}\n`;
}

/** A file name for a style, unique among `taken` (which it updates). */
export function styleFileName(name: string, taken: Set<string>): string {
  // oxlint-disable-next-line no-control-regex -- control characters aren't allowed in file names
  const base = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+|[. ]+$/g, '') || 'caption style';
  let file = `${base}.md`;
  for (let n = 2; taken.has(file.toLowerCase()); n++) file = `${base} (${n}).md`;
  taken.add(file.toLowerCase());
  return file;
}
