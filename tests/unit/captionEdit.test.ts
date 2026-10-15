import { describe, expect, it } from 'vitest';
import {
  addTag,
  buildMatcher,
  countMatches,
  highlight,
  removeTag,
  renameTag,
  replaceIn,
  splitTags,
  tagCounts,
  tidy,
  type FindOptions,
} from '@/lib/captionEdit';

const opts = (find: string, o: Partial<FindOptions> = {}): FindOptions => ({ find, matchCase: false, wholeWord: false, regex: false, ...o });

function replace(caption: string, find: string, replacement: string, o: Partial<FindOptions> = {}) {
  const matcher = buildMatcher(opts(find, o));
  if (!(matcher instanceof RegExp)) throw new Error('no matcher');
  return replaceIn(caption, matcher, replacement, !!o.regex);
}

describe('find & replace', () => {
  it('ignores case unless asked', () => {
    expect(replace('A Cat and a cat', 'cat', 'dog')).toBe('A dog and a dog');
    expect(replace('A Cat and a cat', 'cat', 'dog', { matchCase: true })).toBe('A Cat and a dog');
  });

  it('treats the search and $ literally without regex', () => {
    expect(replace('price (approx.) 5', '(approx.)', '$1')).toBe('price $1 5');
    expect(replace('a.b axb', 'a.b', 'X')).toBe('X axb');
  });

  it('matches whole words, including non-ASCII letters', () => {
    expect(replace('cat, cats, bobcat', 'cat', 'dog', { wholeWord: true })).toBe('dog, cats, bobcat');
    expect(replace('café, cafés', 'café', 'bar', { wholeWord: true })).toBe('bar, cafés');
    expect(replace('über_cat cat', 'cat', 'dog', { wholeWord: true })).toBe('über_cat dog');
  });

  it('supports regex groups', () => {
    expect(replace('red hair, blue eyes', '(\\w+) (hair|eyes)', '$2: $1', { regex: true })).toBe('hair: red, eyes: blue');
  });

  it('reports an invalid regex instead of throwing', () => {
    const matcher = buildMatcher(opts('(unclosed', { regex: true }));
    expect(matcher).toEqual({ error: expect.any(String) });
    expect((matcher as { error: string }).error).not.toMatch(/^Invalid regular expression/);
    expect(buildMatcher(opts(''))).toBeNull();
  });

  it('tidies what a removal leaves behind', () => {
    expect(replace('1girl, solo, smile', 'solo', '')).toBe('1girl, smile');
    expect(replace('solo, smile', 'solo', '')).toBe('smile');
    expect(tidy('  a  ,, b ,  ,c,  ')).toBe('a, b,c');
  });

  it('returns the same string when nothing matches', () => {
    const caption = 'a  messy ,caption';
    expect(replace(caption, 'zebra', 'x')).toBe(caption);
  });

  it('never fills a blank caption', () => {
    expect(replace('', '^', 'ohwx', { regex: true })).toBe('');
    expect(replace('   ', '.*', 'ohwx', { regex: true })).toBe('   ');
    expect(countMatches('', buildMatcher(opts('^', { regex: true })) as RegExp)).toBe(0);
  });

  it('counts and highlights matches', () => {
    const matcher = buildMatcher(opts('cat')) as RegExp;
    expect(countMatches('cat Cat dog cat', matcher)).toBe(3);
    expect(highlight('a cat!', matcher)).toEqual([
      { text: 'a ', match: false },
      { text: 'cat', match: true },
      { text: '!', match: false },
    ]);
    // An empty-matching pattern can't loop forever.
    expect(countMatches('x'.repeat(20_000), buildMatcher(opts('y*', { regex: true })) as RegExp)).toBeGreaterThan(0);
  });
});

describe('tags', () => {
  it('splits on commas, but not inside numbers', () => {
    expect(splitTags(' 1girl ,solo,, 1,000 coins ,')).toEqual(['1girl', 'solo', '1,000 coins']);
  });

  it('counts each tag once per caption, case-insensitively, most common first', () => {
    expect(tagCounts(['solo, Smile, smile', 'smile, hat', 'Hat', '', 'solo, smile'])).toEqual([
      { tag: 'smile', count: 3 },
      { tag: 'hat', count: 2 },
      { tag: 'solo', count: 2 },
    ]);
  });

  it('removes a tag in any case', () => {
    expect(removeTag('1girl, Solo, smile', 'solo')).toBe('1girl, smile');
    const untouched = '1girl,solo';
    expect(removeTag(untouched, 'hat')).toBe(untouched);
  });

  it('renames a tag, merging with an existing one', () => {
    expect(renameTag('1girl, blond hair, smile', 'blond hair', 'blonde hair')).toBe('1girl, blonde hair, smile');
    expect(renameTag('blond hair, blonde hair', 'blond hair', 'blonde hair')).toBe('blonde hair');
    expect(renameTag('a, b', 'b', '  ')).toBe('a');
    expect(renameTag('a, b', 'c', 'd')).toBe('a, b');
  });

  it('adds a tag at the end, or at the start after the trigger word', () => {
    expect(addTag('ohwx, smile', 'hat', 'end', 'ohwx')).toBe('ohwx, smile, hat');
    expect(addTag('ohwx, smile', 'hat', 'start', 'ohwx')).toBe('ohwx, hat, smile');
    expect(addTag('smile, ohwx', 'hat', 'start', 'ohwx')).toBe('hat, smile, ohwx');
    expect(addTag('smile', 'hat', 'start')).toBe('hat, smile');
  });

  it('does not add a tag that is already there or to a blank caption', () => {
    expect(addTag('Hat, smile', 'hat', 'end')).toBe('Hat, smile');
    expect(addTag('', 'hat', 'end')).toBe('');
    expect(addTag('  ', 'hat', 'start', 'ohwx')).toBe('  ');
    expect(addTag('smile', '  ', 'end')).toBe('smile');
  });
});
