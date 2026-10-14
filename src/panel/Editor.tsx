import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowLeft,
  BadgeCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crop as CropIcon,
  ExternalLink,
  Keyboard,
  LoaderCircle,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { db, needsReview, outputSize, type Crop, type ImageRecord } from '@/lib/db';
import { deleteImage, restoreImage, setCaption, setCrop, setHints, setReviewed } from '@/lib/datasets';
import { applyTrigger, CaptionError, generateCaption } from '@/lib/captioner';
import { getBackend, getStyles, resolveStyle } from '@/lib/settings';
import { EXT_BY_MIME, formatBytes } from '@/lib/image';
import { megapixels } from '@/lib/grid';
import { useBlobUrl } from '@/hooks/useBlobUrl';
import { useSettings } from '@/hooks/useSettings';
import { MenuButton } from '@/components/Menu';
import { toast, toastError } from '@/components/Toasts';
import { LOW_RES } from './ImageGrid';
import { Cropper, FramedImage } from './Cropper';
import { openSettings } from './actions';

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

export function Editor({
  datasetId,
  imageId,
  ids,
  review,
  onNavigate,
  onBack,
}: {
  datasetId: string;
  imageId: string;
  ids: string[];
  /** Stepping through the auto captions to review. */
  review?: boolean;
  onNavigate: (imageId: string, ids: string[], review?: boolean) => void;
  onBack: (focusId?: string) => void;
}) {
  // Tag the result with its id: while a new query is pending the hook still
  // returns the previous image's result, which must not be mistaken for this one.
  const result = useLiveQuery(async () => ({ id: imageId, image: (await db.images.get(imageId)) ?? null }), [imageId]);
  const image = result?.id === imageId ? result.image : undefined;
  const lastImage = useRef<ImageRecord>(undefined);
  if (image) lastImage.current = image;
  const dataset = useLiveQuery(async () => (await db.datasets.get(datasetId)) ?? null, [datasetId]);
  const settings = useSettings();
  const url = useBlobUrl('originals', imageId);
  // How many of the queue still need a look.
  const left = useLiveQuery(
    async () => (review ? (await db.images.bulkGet(ids)).filter((img) => img && needsReview(img)).length : 0),
    [review, ids],
  );

  const [draft, setDraft] = useState('');
  const [hint, setHint] = useState('');
  const [loadedId, setLoadedId] = useState<string>();
  const [generatingId, setGeneratingId] = useState<string>();
  const [showKeys, setShowKeys] = useState(false);
  const [cropping, setCropping] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const currentId = useRef(imageId);
  currentId.current = imageId;
  // Once the user types, their text wins over updates arriving from the database.
  const touched = useRef(false);
  const pending = useRef<{ id: string; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pendingHint = useRef<{ id: string; text: string } | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const index = ids.indexOf(imageId);
  const generating = generatingId === imageId;
  const current = image ?? lastImage.current;
  // Typing a change counts as reviewing it.
  const reviewable = !!current && needsReview(current) && !touched.current;

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const p = pending.current;
    pending.current = null;
    if (p) void setCaption(p.id, p.text, 'manual');
    clearTimeout(hintTimer.current);
    const h = pendingHint.current;
    pendingHint.current = null;
    if (h) void setHints([h.id], h.text);
  }, []);

  // Save any pending edit when switching images or leaving the editor.
  useEffect(() => flush, [imageId, flush]);
  useEffect(() => setCropping(false), [imageId]);

  useEffect(() => {
    if (!image) return;
    if (loadedId !== image.id) {
      setLoadedId(image.id);
      setDraft(image.caption);
      setHint(image.hint ?? '');
      touched.current = false;
      const el = textarea.current;
      if (el) {
        el.focus({ preventScroll: true });
        el.setSelectionRange(image.caption.length, image.caption.length);
      }
    } else if (!touched.current && image.caption !== draft) {
      // e.g. a batch run filled this caption while it was open
      setDraft(image.caption);
    }
  }, [image, loadedId, draft]);

  function onChange(text: string) {
    touched.current = true;
    setDraft(text);
    pending.current = { id: imageId, text };
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 400);
  }

  function onHintChange(text: string) {
    setHint(text);
    pendingHint.current = { id: imageId, text };
    clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(flush, 400);
  }

  const go = (delta: number) => {
    const next = ids[index + delta];
    if (!next) return;
    flush();
    onNavigate(next, ids, review);
  };

  const back = () => {
    flush();
    onBack(imageId);
  };

  const leaveAfterRemoval = useCallback(() => {
    const remaining = ids.filter((id) => id !== imageId);
    const next = remaining[index] ?? remaining[index - 1];
    if (next) onNavigate(next, remaining, review);
    else onBack();
  }, [ids, imageId, index, review, onNavigate, onBack]);

  // Deleted from somewhere else (or by undoable delete below).
  useEffect(() => {
    if (image === null) leaveAfterRemoval();
  }, [image, leaveAfterRemoval]);

  async function remove() {
    flush();
    const deleted = await deleteImage(imageId);
    if (deleted) toast('Image deleted', { action: { label: 'Undo', run: () => void restoreImage(deleted) } });
  }

  /** Approves the auto caption. In review, moves on to the next one still waiting. */
  async function approve() {
    const target = imageId;
    flush();
    await setReviewed([target], true);
    if (!review) return;
    const queue = await db.images.bulkGet(ids);
    const waiting = (i: number) => {
      const img = queue[i];
      return !!img && img.id !== target && needsReview(img);
    };
    const after = ids.findIndex((_, i) => i > index && waiting(i));
    const next = after >= 0 ? after : ids.findIndex((_, i) => waiting(i));
    if (next >= 0) {
      onNavigate(ids[next]!, ids, true);
    } else {
      toast('All auto-captions reviewed');
      onBack(target);
    }
  }

  /** Captions the image with the dataset's style, or `styleId` just this once. */
  async function generate(styleId?: string) {
    if (generatingId || !dataset) return;
    const target = imageId;
    const previous = draft;
    const note = hint;
    flush();
    setGeneratingId(target);
    try {
      const [backend, styles] = await Promise.all([getBackend(), getStyles()]);
      const style = resolveStyle(styles, styleId ?? dataset.captionStyleId);
      if (!style) throw new CaptionError('Add a caption style in Settings first.', true);
      const [original, record] = await Promise.all([db.originals.get(target), db.images.get(target)]);
      if (!original) throw new Error('The image data is missing.');
      const caption = applyTrigger(
        await generateCaption(original.blob, style, backend, { crop: record?.crop, hint: note }),
        dataset.triggerWord,
      );
      await setCaption(target, caption, 'auto');
      if (currentId.current === target) {
        touched.current = false;
        setDraft(caption);
      }
      if (previous.trim() && previous !== caption) {
        toast('Caption replaced', {
          action: {
            label: 'Undo',
            run: () => {
              void setCaption(target, previous, 'manual');
              if (currentId.current === target) setDraft(previous);
            },
          },
        });
      }
    } catch (err) {
      toastError(err, err instanceof CaptionError && err.fatal ? { label: 'Settings', run: openSettings } : undefined);
    } finally {
      setGeneratingId(undefined);
    }
  }

  async function applyCrop(crop: Crop | undefined) {
    const target = imageId;
    const previous = shown?.crop;
    setCropping(false);
    try {
      await setCrop(target, crop);
      toast(crop ? `Cropped to ${crop.width}×${crop.height}` : 'Crop removed', {
        action: { label: 'Undo', run: () => void setCrop(target, previous).catch(toastError) },
      });
    } catch (err) {
      toastError(err);
    }
  }

  // Re-registered each render so the handler always sees current state.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || cropping || document.querySelector('dialog[open]')) return;
      const mod = e.ctrlKey || e.metaKey;
      const typing = isTyping(e.target);
      if (e.key === 'Escape') {
        e.preventDefault();
        back();
      } else if (e.key === 'PageDown' || (e.key === 'Enter' && mod && !e.shiftKey)) {
        e.preventDefault();
        go(1);
      } else if (e.key === 'PageUp' || (e.key === 'Enter' && mod && e.shiftKey)) {
        e.preventDefault();
        go(-1);
      } else if (e.altKey && e.code === 'KeyG') {
        e.preventDefault();
        void generate();
      } else if (e.altKey && e.code === 'KeyA' && reviewable) {
        e.preventDefault();
        void approve();
      } else if (!typing && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        e.preventDefault();
        go(e.key === 'ArrowRight' ? 1 : -1);
      } else if (!typing && e.key === 'Enter') {
        e.preventDefault();
        textarea.current?.focus();
      } else if (!typing && e.key === '?') {
        setShowKeys((s) => !s);
      } else if (!typing && !mod && !e.altKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        setCropping(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const shown = image ?? lastImage.current;
  if (!shown || !dataset) return null;

  const words = draft.trim() ? draft.trim().split(/\s+/).length : 0;
  const size = outputSize(shown);
  const shortSide = Math.min(size.width, size.height);
  const datasetStyle = settings && resolveStyle(settings.styles, dataset.captionStyleId);
  const styleName = datasetStyle?.name;
  const sourceLabel = shown.captionSource === 'auto' ? 'Auto' : shown.captionSource === 'import' ? 'Imported' : null;

  return (
    <>
      <header className="topbar">
        <button className="icon-btn" aria-label="Back to grid" title="Back to grid (Esc)" onClick={back}>
          <ArrowLeft size={18} />
        </button>
        <h1 className="topbar-title" title={dataset.name}>
          {dataset.name}
          <span className="topbar-sub">
            {review ? `Reviewing ${index + 1} of ${ids.length} · ${left ?? '…'} left` : `Image ${index + 1} of ${ids.length}`}
          </span>
        </h1>
        <button className="icon-btn" aria-label="Previous image" title="Previous (PgUp)" disabled={index <= 0} onClick={() => go(-1)}>
          <ChevronLeft size={20} />
        </button>
        <button
          className="icon-btn"
          aria-label="Next image"
          title="Next (PgDn or Ctrl+Enter)"
          disabled={index >= ids.length - 1}
          onClick={() => go(1)}
        >
          <ChevronRight size={20} />
        </button>
      </header>

      <div className="editor">
        {cropping ? (
          <Cropper
            key={shown.id}
            url={url}
            width={shown.width}
            height={shown.height}
            initial={shown.crop}
            onApply={(crop) => void applyCrop(crop)}
            onCancel={() => setCropping(false)}
          />
        ) : (
          <div className="stage-col">
            <div className="stage">
              <FramedImage url={url} width={shown.width} height={shown.height} crop={shown.crop} alt={draft || shown.name} />
              <button
                className={shown.crop ? 'stage-btn is-on' : 'stage-btn'}
                aria-label={shown.crop ? 'Edit crop' : 'Crop'}
                title={shown.crop ? 'Edit crop (C)' : 'Crop (C)'}
                onClick={() => setCropping(true)}
              >
                <CropIcon size={16} />
              </button>
            </div>
          </div>
        )}

        <div className="editor-side">
          <div className="meta-row">
            <span className={shortSide < LOW_RES ? 'warn' : undefined} title={shortSide < LOW_RES ? 'Low resolution' : undefined}>
              {size.width}×{size.height}
            </span>
            <span>{megapixels(size.width, size.height)}</span>
            {shown.crop && (
              <span title="Captioning and export use the cropped area; the original is kept">
                cropped from {shown.width}×{shown.height}
              </span>
            )}
            <span>{(EXT_BY_MIME[shown.mime] ?? shown.mime).toUpperCase()}</span>
            <span>{formatBytes(shown.size)}</span>
            {shown.frameTime !== undefined && (
              <span title="Grabbed from a video">
                Frame at {Math.floor(shown.frameTime / 60)}:{(shown.frameTime % 60).toFixed(1).padStart(4, '0')}
              </span>
            )}
            {shown.pageUrl && (
              <a href={shown.pageUrl} target="_blank" rel="noreferrer" title={shown.pageUrl}>
                {hostOf(shown.pageUrl)} <ExternalLink size={11} style={{ verticalAlign: '-1px' }} />
              </a>
            )}
          </div>

          <div className="caption-head">
            <label htmlFor="caption">
              Caption
              {reviewable ? (
                <span className="badge" title="Auto caption nobody has approved or edited yet">
                  Needs review
                </span>
              ) : (
                sourceLabel && draft.trim() && !touched.current && <span className="badge">{sourceLabel}</span>
              )}
            </label>
            <span>
              {words} words · {draft.length} chars
            </span>
          </div>
          <textarea
            id="caption"
            ref={textarea}
            className="textarea caption-box"
            value={draft}
            readOnly={generating}
            placeholder={generating ? 'Generating…' : 'Describe this image, or press Alt+G to generate a caption.'}
            onChange={(e) => onChange(e.target.value)}
            spellCheck
          />

          {reviewable && !generating && (
            <button
              className={review ? 'btn btn-primary' : 'btn'}
              title={review ? 'Approve this caption and go to the next one (Alt+A)' : 'Approve this caption (Alt+A)'}
              onClick={() => void approve()}
            >
              <BadgeCheck size={16} /> {review ? 'Approve and next' : 'Approve caption'}
            </button>
          )}

          <div className="editor-actions">
            <div className="split-btn">
              <button
                className="btn"
                onClick={() => void generate()}
                disabled={!!generatingId}
                title={styleName ? `Style: ${styleName} (Alt+G)` : 'Alt+G'}
              >
                {generating ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} color="var(--accent)" />}
                {generating ? 'Generating…' : draft.trim() ? 'Regenerate' : 'Generate caption'}
              </button>
              <MenuButton
                label="Generate with another style"
                icon={<ChevronDown size={15} />}
                className="btn split-toggle"
                align="left"
                disabled={!!generatingId || !settings?.styles.length}
                items={(settings?.styles ?? []).map((st) => ({
                  label: st.name,
                  checked: st.id === datasetStyle?.id,
                  onSelect: () => void generate(st.id),
                }))}
              />
            </div>
            <span className="spacer" />
            <button
              className="icon-btn"
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts (?)"
              aria-pressed={showKeys}
              onClick={() => setShowKeys((s) => !s)}
            >
              <Keyboard size={18} />
            </button>
            <button className="btn btn-ghost btn-danger" onClick={() => void remove()}>
              <Trash2 size={15} /> Delete
            </button>
          </div>
          <label className="field">
            <span className="field-label">Captioning hint</span>
            <input
              className="input"
              value={hint}
              maxLength={300}
              placeholder="optional, e.g. back view, holding a katana"
              title="Sent to the model with the caption style when this image is captioned"
              onChange={(e) => onHintChange(e.target.value)}
            />
          </label>
          {styleName && (
            <span className="field-hint">
              Style: {styleName}
              {dataset.triggerWord && ` · Trigger: ${dataset.triggerWord}`}
            </span>
          )}

          {showKeys && (
            <dl className="shortcuts">
              <dt>
                <kbd>Ctrl</kbd>
                <kbd>Enter</kbd>
              </dt>
              <dd>Next image (also PgDn)</dd>
              <dt>
                <kbd>Ctrl</kbd>
                <kbd>Shift</kbd>
                <kbd>Enter</kbd>
              </dt>
              <dd>Previous image (also PgUp)</dd>
              <dt>
                <kbd>←</kbd>
                <kbd>→</kbd>
              </dt>
              <dd>Previous / next when not typing</dd>
              <dt>
                <kbd>Alt</kbd>
                <kbd>G</kbd>
              </dt>
              <dd>Generate caption</dd>
              <dt>
                <kbd>Alt</kbd>
                <kbd>A</kbd>
              </dt>
              <dd>Approve an auto caption (in review, then go to the next)</dd>
              <dt>
                <kbd>C</kbd>
              </dt>
              <dd>Crop when not typing (then Enter applies, Esc cancels)</dd>
              <dt>
                <kbd>Esc</kbd>
              </dt>
              <dd>Back to the grid</dd>
              <dt>
                <kbd>Del</kbd>
              </dt>
              <dd>In the grid: delete the focused or selected images</dd>
              <dt>
                <kbd>Space</kbd>
              </dt>
              <dd>In the grid: select the focused image (Ctrl+A selects all)</dd>
            </dl>
          )}
        </div>
      </div>
    </>
  );
}
