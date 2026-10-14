import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { db, hasCaption, type ImageRecord } from '@/lib/db';
import { editCaptions, restoreCaptions } from '@/lib/datasets';
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
} from '@/lib/captionEdit';
import { toast, toastError } from '@/components/Toasts';

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const PREVIEW_LIMIT = 20;
const TAG_LIMIT = 300;

/** Runs a bulk edit and offers undo. */
async function apply(datasetId: string, edit: (caption: string) => string, describe: (n: number) => string) {
  try {
    const before = await editCaptions(datasetId, edit);
    if (!before.length) return toast('Nothing to change.');
    toast(describe(before.length), { action: { label: 'Undo', run: () => void restoreCaptions(before) } });
  } catch (err) {
    toastError(err);
  }
}

export function CaptionTools({ datasetId, onBack }: { datasetId: string; onBack: () => void }) {
  const dataset = useLiveQuery(async () => (await db.datasets.get(datasetId)) ?? null, [datasetId]);
  const images = useLiveQuery(
    () => db.images.where('[datasetId+addedAt]').between([datasetId, -Infinity], [datasetId, Infinity]).reverse().toArray(),
    [datasetId],
  );
  const [tab, setTab] = useState<'replace' | 'tags'>('replace');

  useEffect(() => {
    if (dataset === null) onBack();
  }, [dataset, onBack]);

  if (!dataset || !images) return null;

  return (
    <>
      <header className="topbar">
        <button className="icon-btn" aria-label="Back to dataset" title="Back" onClick={onBack}>
          <ArrowLeft size={18} />
        </button>
        <h1 className="topbar-title" title={dataset.name}>
          Edit captions
          <span className="topbar-sub">{dataset.name}</span>
        </h1>
      </header>

      <div className="segmented tools-tabs" role="group" aria-label="Caption tool">
        <button aria-pressed={tab === 'replace'} onClick={() => setTab('replace')}>
          Find &amp; replace
        </button>
        <button aria-pressed={tab === 'tags'} onClick={() => setTab('tags')}>
          Tags
        </button>
      </div>

      {tab === 'replace' ? (
        <FindReplace datasetId={datasetId} images={images} />
      ) : (
        <TagTools datasetId={datasetId} images={images} trigger={dataset.triggerWord} />
      )}
    </>
  );
}

// ------------------------------------------------------- find & replace

function FindReplace({ datasetId, images }: { datasetId: string; images: ImageRecord[] }) {
  const [find, setFind] = useState('');
  const [replacement, setReplacement] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const deferredFind = useDeferredValue(find);
  const deferredReplacement = useDeferredValue(replacement);

  const matcher = useMemo(
    () => buildMatcher({ find: deferredFind, matchCase, wholeWord, regex }),
    [deferredFind, matchCase, wholeWord, regex],
  );
  const result = useMemo(() => {
    if (!(matcher instanceof RegExp)) return null;
    let matches = 0;
    const changed: { image: ImageRecord; next: string }[] = [];
    for (const image of images) {
      const n = countMatches(image.caption, matcher);
      if (!n) continue;
      matches += n;
      const next = replaceIn(image.caption, matcher, deferredReplacement, regex);
      if (next !== image.caption) changed.push({ image, next });
    }
    return { matches, changed };
  }, [images, matcher, deferredReplacement, regex]);

  const error = matcher && !(matcher instanceof RegExp) ? matcher.error : null;
  const changed = result?.changed ?? [];

  return (
    <form
      className="tools"
      onSubmit={(e) => {
        e.preventDefault();
        if (!(matcher instanceof RegExp) || !changed.length) return;
        void apply(
          datasetId,
          (caption) => replaceIn(caption, matcher, replacement, regex),
          (n) => `Replaced in ${plural(n, 'caption')}`,
        );
      }}
    >
      <label className="field">
        <span className="field-label">Find</span>
        <input className="input" autoFocus value={find} onChange={(e) => setFind(e.target.value)} spellCheck={false} />
      </label>
      <label className="field">
        <span className="field-label">Replace with</span>
        <input
          className="input"
          value={replacement}
          placeholder="leave empty to delete"
          onChange={(e) => setReplacement(e.target.value)}
          spellCheck={false}
        />
      </label>
      <div className="check-row">
        <label>
          <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> Match case
        </label>
        <label>
          <input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} /> Whole words
        </label>
        <label>
          <input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} /> Regular expression
        </label>
      </div>

      <div className="tools-summary" aria-live="polite">
        {error ? (
          <span className="bad">{error}</span>
        ) : result ? (
          result.matches ? (
            `${plural(result.matches, 'match', 'matches')} in ${plural(changed.length, 'caption')}`
          ) : (
            'No matches'
          )
        ) : (
          'Type something to find. Leftover commas and double spaces are cleaned up.'
        )}
      </div>

      <button
        className="btn btn-primary btn-block"
        disabled={!changed.length || find !== deferredFind || replacement !== deferredReplacement}
      >
        {changed.length ? `Replace in ${plural(changed.length, 'caption')}` : 'Replace'}
      </button>

      {matcher instanceof RegExp && changed.length > 0 && (
        <ul className="preview-list" aria-label="Preview">
          {changed.slice(0, PREVIEW_LIMIT).map(({ image, next }) => (
            <li key={image.id}>
              <div className="preview-before">
                {highlight(image.caption, matcher).map((part, i) => (part.match ? <mark key={i}>{part.text}</mark> : part.text))}
              </div>
              <div className="preview-after">{next || <em>(empty)</em>}</div>
            </li>
          ))}
          {changed.length > PREVIEW_LIMIT && <li className="preview-more">and {changed.length - PREVIEW_LIMIT} more</li>}
        </ul>
      )}
    </form>
  );
}

// ----------------------------------------------------------------- tags

function TagTools({ datasetId, images, trigger }: { datasetId: string; images: ImageRecord[]; trigger?: string }) {
  const [filter, setFilter] = useState('');
  const [newTag, setNewTag] = useState('');
  const [position, setPosition] = useState<'start' | 'end'>('end');
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null);

  const captions = useMemo(() => images.filter(hasCaption).map((img) => img.caption), [images]);
  const counts = useMemo(() => tagCounts(captions), [captions]);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? counts.filter((c) => c.tag.toLowerCase().includes(q)) : counts;
  }, [counts, filter]);
  const addCount = useMemo(() => {
    const t = newTag.trim();
    return t ? captions.filter((c) => addTag(c, t, position, trigger) !== c).length : 0;
  }, [captions, newTag, position, trigger]);
  const looksLikeProse = counts.length > 0 && captions.length > 0 && splitTags(captions[0]!).some((t) => t.split(' ').length > 6);

  async function rename() {
    if (!renaming) return;
    const { from, to } = renaming;
    setRenaming(null);
    if (!to.trim() || to.trim() === from) return;
    await apply(datasetId, (c) => renameTag(c, from, to), (n) => `Renamed “${from}” to “${to.trim()}” in ${plural(n, 'caption')}`);
  }

  if (!captions.length) {
    return <p className="field-hint tools">No captions yet. Tags appear here once images are captioned.</p>;
  }

  return (
    <div className="tools">
      <p className="field-hint" style={{ margin: 0 }}>
        For comma-separated captions, like the Booru tags style.
        {looksLikeProse && ' These captions look like sentences, so each comma-separated phrase counts as a tag.'}
      </p>

      <form
        className="field"
        onSubmit={(e) => {
          e.preventDefault();
          const t = newTag.trim();
          if (!t || !addCount) return;
          void apply(datasetId, (c) => addTag(c, t, position, trigger), (n) => `Added “${t}” to ${plural(n, 'caption')}`).then(() =>
            setNewTag(''),
          );
        }}
      >
        <label className="field-label" htmlFor="new-tag">
          Add a tag to every captioned image
        </label>
        <div className="input-row">
          <input id="new-tag" className="input" value={newTag} onChange={(e) => setNewTag(e.target.value)} spellCheck={false} />
          <select
            className="select"
            value={position}
            aria-label="Position"
            onChange={(e) => setPosition(e.target.value as 'start' | 'end')}
          >
            <option value="start">at start</option>
            <option value="end">at end</option>
          </select>
          <button className="btn" disabled={!addCount} title={newTag.trim() ? `Adds to ${plural(addCount, 'caption')}` : undefined}>
            <Plus size={15} /> Add
          </button>
        </div>
        <span className="field-hint">
          {newTag.trim()
            ? addCount
              ? `Adds it to ${plural(addCount, 'caption')}${position === 'start' && trigger ? ', after the trigger word' : ''}.`
              : 'Every captioned image already has it.'
            : 'Blank captions are skipped so auto-captioning still fills them.'}
        </span>
      </form>

      <div className="tag-head">
        <strong>
          {plural(counts.length, 'tag')} in {plural(captions.length, 'caption')}
        </strong>
        <input
          className="input"
          placeholder="Filter tags"
          aria-label="Filter tags"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          spellCheck={false}
        />
      </div>

      <ul className="tag-list">
        {shown.slice(0, TAG_LIMIT).map(({ tag, count }) => (
          <li key={tag.toLowerCase()}>
            {renaming?.from === tag ? (
              <form
                className="tag-rename"
                onSubmit={(e) => {
                  e.preventDefault();
                  void rename();
                }}
              >
                <input
                  className="input"
                  autoFocus
                  aria-label={`New name for ${tag}`}
                  value={renaming.to}
                  onChange={(e) => setRenaming({ from: tag, to: e.target.value })}
                  onKeyDown={(e) => e.key === 'Escape' && (e.preventDefault(), setRenaming(null))}
                  spellCheck={false}
                />
                <button className="icon-btn" aria-label="Save" title="Rename (Enter)">
                  <Check size={15} />
                </button>
                <button type="button" className="icon-btn" aria-label="Cancel" title="Cancel (Esc)" onClick={() => setRenaming(null)}>
                  <X size={15} />
                </button>
              </form>
            ) : (
              <>
                <span className="tag-name" title={tag}>
                  {tag}
                </span>
                <span className="tag-count">{count}</span>
                <button
                  className="icon-btn"
                  aria-label={`Rename ${tag}`}
                  title="Rename everywhere"
                  onClick={() => setRenaming({ from: tag, to: tag })}
                >
                  <Pencil size={14} />
                </button>
                <button
                  className="icon-btn"
                  aria-label={`Remove ${tag}`}
                  title="Remove from every caption"
                  onClick={() =>
                    void apply(datasetId, (c) => removeTag(c, tag), (n) => `Removed “${tag}” from ${plural(n, 'caption')}`)
                  }
                >
                  <Trash2 size={14} />
                </button>
              </>
            )}
          </li>
        ))}
        {shown.length > TAG_LIMIT && <li className="preview-more">and {shown.length - TAG_LIMIT} more; filter to find them</li>}
        {!shown.length && <li className="preview-more">No tags match “{filter}”</li>}
      </ul>
    </div>
  );
}
