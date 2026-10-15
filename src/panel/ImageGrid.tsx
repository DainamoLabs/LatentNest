import { memo, useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Check, LoaderCircle, Sparkles } from 'lucide-react';
import { hasCaption, needsReview, outputSize, type ImageRecord } from '@/lib/db';
import { refreshThumb } from '@/lib/datasets';
import { megapixels, stepGridSize, type GridSize, type SizeLabel } from '@/lib/grid';
import { thumbIsOutdated } from '@/lib/image';
import { useBlobUrl, useInView } from '@/hooks/useBlobUrl';

export const LOW_RES = 512;

interface TileProps {
  image: ImageRecord;
  index: number;
  active: boolean;
  working: boolean;
  /** In selection mode: undefined otherwise. */
  selected?: boolean;
  sizeLabel: SizeLabel;
  onFocusIndex: (i: number) => void;
  onActivate: (index: number, e: MouseEvent) => void;
}

const Tile = memo(function Tile({ image, index, active, working, selected, sizeLabel, onFocusIndex, onActivate }: TileProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const visible = useInView(ref);
  const { width, height } = outputSize(image);
  const [redrawn, setRedrawn] = useState(0);
  // The crop is part of the key so the thumbnail reloads when it changes.
  const crop = image.crop ? `${image.crop.x},${image.crop.y},${width},${height}` : '';
  const url = useBlobUrl('thumbs', image.id, visible, `${crop}|${redrawn}`, (thumb) => {
    // Thumbnails from older versions are too small for big tiles.
    if (thumbIsOutdated(thumb, width, height)) void refreshThumb(image.id).then((ok) => ok && setRedrawn((n) => n + 1));
  });
  const captioned = hasCaption(image);
  const review = needsReview(image);
  const shortSide = Math.min(width, height);
  const low = shortSide < LOW_RES;
  const exact = `${width}×${height}`;
  const mp = megapixels(width, height);
  const status = working ? 'working' : review ? 'review' : captioned ? 'done' : 'blank';

  return (
    <button
      ref={ref}
      className={selected ? 'tile selected' : 'tile'}
      tabIndex={active ? 0 : -1}
      aria-pressed={selected}
      onFocus={() => onFocusIndex(index)}
      onClick={(e) => onActivate(index, e)}
      title={captioned ? image.caption : 'No caption yet'}
      aria-label={`${image.name}, ${width}×${height}${image.crop ? ' (cropped)' : ''}, ${
        review ? 'auto caption to review' : captioned ? 'captioned' : 'no caption'
      }`}
    >
      {url && <img src={url} alt="" draggable={false} />}
      {selected !== undefined && <span className="tile-check">{selected && <Check size={13} strokeWidth={3} />}</span>}
      <span className={`tile-status ${status}`}>
        {working ? (
          <LoaderCircle size={12} className="spin" />
        ) : review ? (
          <Sparkles size={11} strokeWidth={2.5} />
        ) : (
          captioned && <Check size={12} strokeWidth={3} />
        )}
      </span>
      {sizeLabel === 'off' ? (
        low && (
          <span className="tile-size low" title={`${exact}: below ${LOW_RES}px on the short side`}>
            {shortSide}px
          </span>
        )
      ) : (
        // A tile too narrow for the full label shows only the low-res warning, as with labels off.
        <span
          className={low ? 'tile-size low' : 'tile-size'}
          data-label={sizeLabel}
          title={`${exact}, ${mp}${low ? `: below ${LOW_RES}px on the short side` : ''}`}
        >
          <span className="tile-size-full">{sizeLabel === 'megapixels' ? mp : exact}</span>
          {low && <span className="tile-size-narrow">{shortSide}px</span>}
        </span>
      )}
    </button>
  );
});

/**
 * Thumbnail grid with roving focus: arrows move, Enter opens, Space selects,
 * Delete removes, + and − change the tile size. Ctrl/⌘-click toggles an
 * image's selection and Shift-click selects a range. `selection` is null
 * outside selection mode.
 */
export function ImageGrid({
  images,
  focusId,
  workingId,
  selection,
  size,
  sizeLabel,
  onOpen,
  onSelectionChange,
  onDelete,
  onSizeChange,
}: {
  images: ImageRecord[];
  focusId?: string;
  workingId?: string;
  selection: Set<string> | null;
  size: GridSize;
  sizeLabel: SizeLabel;
  onOpen: (id: string) => void;
  onSelectionChange: (next: Set<string>) => void;
  onDelete: (ids: string[]) => void;
  onSizeChange: (size: GridSize) => void;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const restored = useRef(false);
  const refocus = useRef(false);
  /** Where a Shift-click range starts: the last image toggled. */
  const anchor = useRef<string | null>(null);
  const current = Math.max(0, Math.min(active, images.length - 1));
  // Read by the memoized click handler, so tiles don't re-render on every change.
  const latest = useRef({ images, selection, onOpen, onSelectionChange });
  latest.current = { images, selection, onOpen, onSelectionChange };

  const tileAt = (i: number) => gridRef.current?.querySelectorAll<HTMLButtonElement>('.tile')[i];

  // Coming back from the editor: put focus on the image that was open.
  useEffect(() => {
    if (restored.current || !images.length) return;
    restored.current = true;
    const i = focusId ? images.findIndex((img) => img.id === focusId) : -1;
    if (i < 0) return;
    setActive(i);
    const el = tileAt(i);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: 'center' });
  }, [images, focusId]);

  // A new round of selecting starts a new range.
  useEffect(() => {
    if (!selection) anchor.current = null;
  }, [selection]);

  // Resizing from the keyboard: keep the focused image on screen.
  const shownSize = useRef(size);
  useEffect(() => {
    if (shownSize.current === size) return;
    shownSize.current = size;
    const el = tileAt(current);
    if (el && el === document.activeElement) el.scrollIntoView({ block: 'nearest' });
  }, [size, current]);

  // After a keyboard delete, keep focus at the same position.
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    tileAt(current)?.focus();
  }, [images, current]);

  const toggle = useCallback((index: number) => {
    const { images, selection, onSelectionChange } = latest.current;
    const id = images[index]?.id;
    if (!id) return;
    const next = new Set(selection ?? []);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    anchor.current = id;
    onSelectionChange(next);
  }, []);

  const activate = useCallback(
    (index: number, e: MouseEvent) => {
      const { images, selection, onOpen, onSelectionChange } = latest.current;
      const image = images[index];
      if (!image) return;
      if (e.shiftKey) {
        const from = images.findIndex((img) => img.id === anchor.current);
        const [a, b] = from < 0 ? [index, index] : from < index ? [from, index] : [index, from];
        const next = new Set(selection ?? []);
        for (const img of images.slice(a, b + 1)) next.add(img.id);
        if (from < 0) anchor.current = image.id;
        onSelectionChange(next);
      } else if (selection || e.ctrlKey || e.metaKey) {
        toggle(index);
      } else {
        onOpen(image.id);
      }
    },
    [toggle],
  );

  function onKeyDown(e: KeyboardEvent) {
    if (!gridRef.current || !images.length) return;
    const cols = getComputedStyle(gridRef.current).gridTemplateColumns.split(' ').length;
    let next: number;
    switch (e.key) {
      case 'ArrowRight':
        next = current + 1;
        break;
      case 'ArrowLeft':
        next = current - 1;
        break;
      case 'ArrowDown':
        next = current + cols;
        break;
      case 'ArrowUp':
        next = current - cols;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = images.length - 1;
        break;
      case ' ':
        // Instead of the button's own click, which would open the image.
        e.preventDefault();
        if (!e.repeat) toggle(current);
        return;
      case '+':
      case '=':
      case '-':
        // Ctrl/⌘ with these is the browser's zoom.
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        e.preventDefault();
        onSizeChange(stepGridSize(size, e.key === '-' ? -1 : 1));
        return;
      case 'Delete':
      case 'Backspace': {
        e.preventDefault();
        const chosen = selection ? images.filter((img) => selection.has(img.id)).map((img) => img.id) : [];
        refocus.current = true;
        onDelete(chosen.length ? chosen : [images[current]!.id]);
        return;
      }
      default:
        return;
    }
    e.preventDefault();
    next = Math.max(0, Math.min(images.length - 1, next));
    setActive(next);
    tileAt(next)?.focus();
  }

  return (
    // Arrow-key navigation for the tiles (buttons) inside, handled in one place.
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      className={`grid grid-${size}${selection ? ' selecting' : ''}`}
      ref={gridRef}
      onKeyDown={onKeyDown}
      // Space activates buttons on key-up; it was handled on key-down.
      onKeyUp={(e) => e.key === ' ' && e.preventDefault()}
      aria-label="Images"
    >
      {images.map((img, i) => (
        <Tile
          key={img.id}
          image={img}
          index={i}
          active={i === current}
          working={img.id === workingId}
          selected={selection ? selection.has(img.id) : undefined}
          sizeLabel={sizeLabel}
          onFocusIndex={setActive}
          onActivate={activate}
        />
      ))}
    </div>
  );
}
