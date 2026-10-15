import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { expandStyleFiles, parseStyleText, readStyleFile, styleFileName, styleToMarkdown } from '@/lib/styleFile';

describe('parseStyleText', () => {
  it('names a .txt style after its file', () => {
    expect(parseStyleText('Booru tags.txt', '  List tags.\r\n')).toEqual({ name: 'Booru tags', prompt: 'List tags.' });
  });

  it('takes name: or title: from Markdown front matter and strips it', () => {
    expect(parseStyleText('a.md', '---\nname: Portrait\nauthor: me\n---\n\nDescribe the face.\n')).toEqual({
      name: 'Portrait',
      prompt: 'Describe the face.',
    });
    expect(parseStyleText('a.markdown', '---\r\ntitle: "Quoted \\"name\\""\r\n---\r\nBody')).toEqual({
      name: 'Quoted "name"',
      prompt: 'Body',
    });
    expect(parseStyleText('a.md', "---\nTitle: 'single'\n---\nBody").name).toBe('single');
  });

  it('falls back to the file name when front matter has no name', () => {
    expect(parseStyleText('Short.md', '---\nauthor: me\n---\nBody')).toEqual({ name: 'Short', prompt: 'Body' });
  });

  it('keeps front matter in a .txt file, since only Markdown has it', () => {
    expect(parseStyleText('a.txt', '---\nname: X\n---\nBody').prompt).toBe('---\nname: X\n---\nBody');
  });

  it('rejects an empty prompt and caps the name', () => {
    expect(() => parseStyleText('empty.md', '---\nname: X\n---\n  \n')).toThrow('“empty.md” is empty.');
    expect(parseStyleText(`${'n'.repeat(80)}.txt`, 'p').name).toHaveLength(60);
  });
});

describe('readStyleFile', () => {
  it('reads UTF-8, UTF-16 and Windows-1252 text', async () => {
    expect((await readStyleFile(new File(['Café ☕'], 'a.txt'))).prompt).toBe('Café ☕');
    const utf16 = new Uint8Array([0xff, 0xfe, ...Array.from('Hi', (c) => [c.charCodeAt(0), 0]).flat()]);
    expect((await readStyleFile(new File([utf16], 'a.txt'))).prompt).toBe('Hi');
    expect((await readStyleFile(new File([new Uint8Array([0x63, 0x61, 0x66, 0xe9])], 'a.txt'))).prompt).toBe('café');
  });

  it('rejects other file types, huge files and binary data', async () => {
    await expect(readStyleFile(new File(['x'], 'a.json'))).rejects.toThrow('isn’t a .txt or .md file');
    await expect(readStyleFile(new File(['x'.repeat(64 * 1024 + 1)], 'a.txt'))).rejects.toThrow('64 KB max');
    await expect(readStyleFile(new File(['a\0b'], 'a.txt'))).rejects.toThrow('doesn’t look like a text file');
  });
});

describe('expandStyleFiles', () => {
  it('unpacks prompt files from a zip, skipping macOS clutter', async () => {
    const zip = zipSync({
      'styles/One.md': strToU8('one'),
      'Two.txt': strToU8('two'),
      'notes.json': strToU8('{}'),
      '__MACOSX/styles/._One.md': strToU8('junk'),
    });
    const plain = new File(['three'], 'Three.txt');
    const { files, failed } = await expandStyleFiles([new File([zip], 'styles.zip'), plain]);
    expect(files.map((f) => f.name).sort()).toEqual(['One.md', 'Three.txt', 'Two.txt']);
    expect(failed).toEqual([]);
  });

  it('reports bad and empty zips', async () => {
    const empty = zipSync({ 'a.json': strToU8('{}') });
    const { files, failed } = await expandStyleFiles([new File(['nope'], 'bad.zip'), new File([empty], 'empty.zip')]);
    expect(files).toEqual([]);
    expect(failed).toEqual(['“bad.zip” isn’t a valid zip file.', '“empty.zip” has no .txt or .md files in it.']);
  });
});

describe('export', () => {
  it('writes Markdown that reads back as the same style', () => {
    const style = { name: 'Tags: "booru" style', prompt: 'List tags.\n' };
    expect(parseStyleText('whatever.md', styleToMarkdown(style))).toEqual({ name: style.name, prompt: 'List tags.' });
  });

  it('makes safe, unique file names', () => {
    const taken = new Set<string>();
    expect(styleFileName('Tags: booru/danbooru', taken)).toBe('Tags booru danbooru.md');
    expect(styleFileName('tags booru danbooru', taken)).toBe('tags booru danbooru (2).md');
    expect(styleFileName('...', taken)).toBe('caption style.md');
  });
});
