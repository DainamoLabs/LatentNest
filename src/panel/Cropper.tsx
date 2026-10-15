import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type KeyboardEvent } from 'react';
import { RotateCcw } from 'lucide-react';
import type { Crop } from '@/lib/db';
import { dragCrop, drawCrop, fitAspect, fullCrop, isFullCrop, MIN_CROP, type Handle } from '@/lib/crop';
import { LOW_RES } from './ImageGrid';

const ASPECTS: [key: string, label: string, ratio?: number][] = [
  ['free', 'Free'],
  ['original', 'Original'],
  ['1:1', '1:1', 1],
  ['4:5', '4:5', 4 / 5],
  ['3:4', '3:4', 3 / 4],
  ['2:3', '2:3', 2 / 3],
  ['9:16', '9:16', 9 / 16],
  ['5:4', '5:4', 5 / 4],
  ['4:3', '4:3', 4 / 3],
  ['3:2', '3:2', 3 / 2],
  ['16:9', '16:9', 16 / 9],
];
const CORNERS: Handle[] = ['nw', 'ne', 'sw', 'se'];
const EDGES: Handle[] = ['n', 's', 'e', 'w'];

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

const pct = (v: number, of: number) => `${(v / of) * 100}%`;

/** The image as it will be trained on: the crop region, scaled to fit the stage. */
export function FramedImage({ url, width, height, crop, alt }: { url?: string; width: number; height: number; crop?: Crop; alt: string }) {
  const c = crop ?? fullCrop(width, height);
  return (
    <div className="frame" style={{ '--ratio': c.width / c.height } as CSSProperties}>
      {url && (
        <img
          src={url}
          alt={alt}
          draggable={false}
          style={{ width: pct(width, c.width), height: pct(height, c.height), left: pct(-c.x, c.width), top: pct(-c.y, c.height) }}
        />
      )}
    </div>
  );
}

type Drag = { handle: Handle | 'draw'; start: Crop; px: number; py: number; scale: number; ax: number; ay: number };

/**
 * Crop box over the whole image. Drag the box to move it, its handles to
 * resize, or anywhere outside it to draw a new one.
 */
export function Cropper({
  url,
  width: W,
  height: H,
  initial,
  onApply,
  onCancel,
}: {
  url?: string;
  width: number;
  height: number;
  initial?: Crop;
  onApply: (crop: Crop | undefined) => void;
  onCancel: () => void;
}) {
  const [rect, setRect] = useState<Crop>(initial ?? fullCrop(W, H));
  const [aspect, setAspect] = useState('free');
  const frame = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const ratio = aspect === 'original' ? W / H : ASPECTS.find(([k]) => k === aspect)?.[2];

  useEffect(() => box.current?.focus({ preventScroll: true }), []);

  const apply = () => onApply(isFullCrop(rect, W, H) ? undefined : rect);

  // Enter applies and Esc cancels from anywhere except text fields.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented || document.querySelector('dialog[open]')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter' && !isTyping(e.target)) {
        e.preventDefault();
        apply();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function begin(e: PointerEvent, handle: Handle | 'draw') {
    if (e.button !== 0 || !frame.current) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const bounds = frame.current.getBoundingClientRect();
    const scale = W / bounds.width;
    drag.current = {
      handle,
      start: rect,
      px: e.clientX,
      py: e.clientY,
      scale,
      ax: (e.clientX - bounds.left) * scale,
      ay: (e.clientY - bounds.top) * scale,
    };
    box.current?.focus({ preventScroll: true });
  }

  function move(e: PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.px) * d.scale;
    const dy = (e.clientY - d.py) * d.scale;
    setRect(d.handle === 'draw' ? drawCrop(d.ax, d.ay, d.ax + dx, d.ay + dy, W, H, ratio) : dragCrop(d.start, d.handle, dx, dy, W, H, ratio));
  }

  function end() {
    const d = drag.current;
    drag.current = null;
    // A click (or tiny drag) outside the box keeps the previous crop.
    if (d?.handle === 'draw') setRect((r) => (r.width < MIN_CROP || r.height < MIN_CROP ? d.start : r));
  }

  function nudge(e: KeyboardEvent) {
    const step = e.shiftKey ? 10 : 1;
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!delta) return;
    e.preventDefault();
    e.stopPropagation();
    setRect((r) => dragCrop(r, 'move', delta[0]!, delta[1]!, W, H));
  }

  function chooseAspect(key: string) {
    setAspect(key);
    const r = key === 'original' ? W / H : ASPECTS.find(([k]) => k === key)?.[2];
    if (r) setRect((c) => fitAspect(W, H, r, c.x + c.width / 2, c.y + c.height / 2));
  }

  const lowRes = Math.min(rect.width, rect.height) < LOW_RES;

  return (
    <div className="stage-col">
      <div className="stage">
        <div
          ref={frame}
          className="frame cropping"
          style={{ '--ratio': W / H } as CSSProperties}
          onPointerDown={(e) => begin(e, 'draw')}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        >
          {url && <img src={url} alt="" draggable={false} style={{ inset: 0, width: '100%', height: '100%' }} />}
          {/* A focusable, labelled widget: arrow keys move it. */}
          {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
          <div
            ref={box}
            className="crop-box"
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
            tabIndex={0}
            role="group"
            aria-label={`Crop area ${rect.width}×${rect.height}. Arrow keys move it, Enter applies, Esc cancels.`}
            style={{ left: pct(rect.x, W), top: pct(rect.y, H), width: pct(rect.width, W), height: pct(rect.height, H) }}
            onPointerDown={(e) => begin(e, 'move')}
            onKeyDown={nudge}
          >
            {(ratio ? CORNERS : [...CORNERS, ...EDGES]).map((h) => (
              <span key={h} className={`crop-handle h-${h}`} onPointerDown={(e) => begin(e, h)} />
            ))}
          </div>
        </div>
      </div>

      <div className="crop-bar">
        <select className="select" aria-label="Aspect ratio" value={aspect} onChange={(e) => chooseAspect(e.target.value)}>
          {ASPECTS.map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <span className={lowRes ? 'crop-size warn' : 'crop-size'} title={lowRes ? `Below ${LOW_RES}px on the short side` : undefined}>
          {rect.width}×{rect.height}
        </span>
        <span className="spacer" />
        <button
          className="icon-btn"
          aria-label="Reset crop"
          title="Reset to the whole image"
          disabled={isFullCrop(rect, W, H)}
          onClick={() => {
            setAspect('free');
            setRect(fullCrop(W, H));
          }}
        >
          <RotateCcw size={16} />
        </button>
        <button className="btn btn-sm btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-sm btn-primary" onClick={apply}>
          Apply
        </button>
      </div>
    </div>
  );
}
