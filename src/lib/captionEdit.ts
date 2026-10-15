// Bulk caption edits: find & replace, and tag operations for comma-separated
// captions. Everything here is pure so it can run inside a database
// transaction and drive live previews.

export interface FindOptions {
  find: string;
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The search as a global regex, or an error message for an invalid pattern. */
export function buildMatcher(o: FindOptions): RegExp | { error: string } | null {
  if (!o.find) return null;
  let source = o.regex ? o.find : escapeRegex(o.find);
  // \b only knows ASCII; this treats any letter or digit as part of a word.
  if (o.wholeWord) source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
  try {
    return new RegExp(source, o.matchCase ? 'gu' : 'giu');
  } catch (err) {
    return { error: err instanceof Error ? err.message.replace(/^Invalid regular expression: /, '') : 'Invalid pattern' };
  }
}

/** Tidies what a replacement can leave behind: doubled spaces, empty tags, stray edge commas. */
export function tidy(caption: string): string {
  return caption
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/,(\s*,)+/g, ',')
    .replace(/^[\s,]+|[\s,]+$/g, '');
}

/**
 * Replaces every match. Without `regex`, `$` in the replacement is literal;
 * with it, `$1` etc. refer to groups. Unchanged captions come back as-is, and
 * so do blank ones (a pattern like `^` matches them), so auto-captioning
 * still fills them.
 */
export function replaceIn(caption: string, matcher: RegExp, replacement: string, regex: boolean): string {
  matcher.lastIndex = 0;
  if (!caption.trim() || !matcher.test(caption)) return caption;
  matcher.lastIndex = 0;
  const next = caption.replace(matcher, regex ? replacement : replacement.replaceAll('$', '$$$$'));
  return next === caption ? caption : tidy(next);
}

export function countMatches(caption: string, matcher: RegExp): number {
  if (!caption.trim()) return 0; // replaceIn leaves blank captions alone
  matcher.lastIndex = 0;
  let n = 0;
  for (const m of caption.matchAll(matcher)) {
    n++;
    if (m[0] === '' && n > 10_000) break; // e.g. /x*/ matches between every character
  }
  return n;
}

/** Splits a caption around its matches, for highlighting in previews. */
export function highlight(caption: string, matcher: RegExp): { text: string; match: boolean }[] {
  const parts: { text: string; match: boolean }[] = [];
  let last = 0;
  matcher.lastIndex = 0;
  for (const m of caption.matchAll(matcher)) {
    if (!m[0]) continue;
    if (m.index > last) parts.push({ text: caption.slice(last, m.index), match: false });
    parts.push({ text: m[0], match: true });
    last = m.index + m[0].length;
  }
  if (last < caption.length) parts.push({ text: caption.slice(last), match: false });
  return parts;
}

// ---------------------------------------------------------------- tags

/** Comma-separated tags. A comma between digits ("1,000") is part of the tag. */
export const splitTags = (caption: string) =>
  caption
    .split(/(?<!\d),|,(?!\d)/)
    .map((t) => t.trim())
    .filter(Boolean);

const key = (tag: string) => tag.toLowerCase();

/** Tag frequencies across captions, most common first. Case-insensitive; shows the most common spelling. */
export function tagCounts(captions: string[]): { tag: string; count: number }[] {
  const counts = new Map<string, { count: number; spellings: Map<string, number> }>();
  for (const caption of captions) {
    const seen = new Set<string>(); // a tag repeated within one caption counts once
    for (const tag of splitTags(caption)) {
      const k = key(tag);
      let entry = counts.get(k);
      if (!entry) counts.set(k, (entry = { count: 0, spellings: new Map() }));
      entry.spellings.set(tag, (entry.spellings.get(tag) ?? 0) + 1);
      if (!seen.has(k)) {
        seen.add(k);
        entry.count++;
      }
    }
  }
  return [...counts.values()]
    .map(({ count, spellings }) => ({ tag: [...spellings.entries()].sort((a, b) => b[1] - a[1])[0]![0], count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export function removeTag(caption: string, tag: string): string {
  const tags = splitTags(caption);
  const kept = tags.filter((t) => key(t) !== key(tag));
  return kept.length === tags.length ? caption : kept.join(', ');
}

/** Renames a tag; if the new name is already in the caption, the old one is just dropped. */
export function renameTag(caption: string, from: string, to: string): string {
  const tags = splitTags(caption);
  if (!tags.some((t) => key(t) === key(from))) return caption;
  const out: string[] = [];
  for (const t of tags) {
    const next = key(t) === key(from) ? to.trim() : t;
    if (next && !out.some((o) => key(o) === key(next))) out.push(next);
  }
  return out.join(', ');
}

/**
 * Adds a tag to a captioned image. Blank captions stay blank so batch
 * auto-captioning still fills them. "start" goes after the trigger word.
 */
export function addTag(caption: string, tag: string, position: 'start' | 'end', trigger?: string): string {
  const t = tag.trim();
  const tags = splitTags(caption);
  if (!t || !tags.length || tags.some((x) => key(x) === key(t))) return caption;
  if (position === 'end') return [...tags, t].join(', ');
  const afterTrigger = trigger?.trim() && key(tags[0]!) === key(trigger.trim()) ? 1 : 0;
  return [...tags.slice(0, afterTrigger), t, ...tags.slice(afterTrigger)].join(', ');
}
