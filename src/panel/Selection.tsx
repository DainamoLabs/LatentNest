// The toolbar shown while selecting images, and its move/copy and tag dialogs.
import { useMemo, useState } from 'react';
import {
  BadgeCheck,
  CheckCheck,
  Eraser,
  FolderInput,
  Lightbulb,
  Sparkles,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import type { Dataset } from '@/lib/db';
import { addTag, removeTag } from '@/lib/captionEdit';
import { MenuButton } from '@/components/Menu';
import { Modal } from '@/components/Modal';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function SelectionBar({
  count,
  allSelected,
  blank,
  captioned,
  review,
  captionBlocked,
  onSelectAll,
  onCancel,
  onCaption,
  onTransfer,
  onDelete,
  onTag,
  onHint,
  onApprove,
  onClear,
}: {
  count: number;
  allSelected: boolean;
  /** How many of the selected images have a blank caption, a caption, or one to review. */
  blank: number;
  captioned: number;
  review: number;
  /** Why auto-captioning can't start now, if it can't. */
  captionBlocked?: string;
  onSelectAll: () => void;
  onCancel: () => void;
  onCaption: () => void;
  onTransfer: () => void;
  onDelete: () => void;
  onTag: () => void;
  onHint: () => void;
  onApprove: () => void;
  onClear: () => void;
}) {
  const none = count === 0;
  const captionTitle = none
    ? 'Auto-caption'
    : captionBlocked
      ? captionBlocked
      : blank
        ? `Auto-caption ${plural(blank, 'blank image')}`
        : 'The selected images already have captions';

  return (
    <div className="toolbar select-bar" role="group" aria-label="Selected images">
      <button className="icon-btn" aria-label="Stop selecting" title="Stop selecting (Esc)" onClick={onCancel}>
        <X size={18} />
      </button>
      <span className="select-count" aria-live="polite">
        {count} selected
      </span>
      <span className="spacer" />
      <button
        className="icon-btn"
        aria-label={allSelected ? 'Select none' : 'Select all'}
        title={allSelected ? 'Select none' : 'Select all (Ctrl+A)'}
        aria-pressed={allSelected}
        onClick={onSelectAll}
      >
        <CheckCheck size={17} />
      </button>
      <button className="icon-btn" aria-label="Auto-caption" title={captionTitle} disabled={none || !blank || !!captionBlocked} onClick={onCaption}>
        <Sparkles size={17} />
      </button>
      <button className="icon-btn" aria-label="Move or copy" title="Move or copy to another dataset" disabled={none} onClick={onTransfer}>
        <FolderInput size={17} />
      </button>
      <button className="icon-btn" aria-label="Delete selected" title="Delete (Del)" disabled={none} onClick={onDelete}>
        <Trash2 size={17} />
      </button>
      <MenuButton
        label="More actions for the selection"
        disabled={none}
        items={[
          { label: 'Add or remove a tag…', icon: <Tag size={15} />, onSelect: onTag, disabled: !captioned },
          { label: 'Captioning hint…', icon: <Lightbulb size={15} />, onSelect: onHint },
          {
            label: review ? `Approve ${plural(review, 'auto-caption')}` : 'Approve auto-captions',
            icon: <BadgeCheck size={15} />,
            onSelect: onApprove,
            disabled: !review,
          },
          { label: 'Clear captions', icon: <Eraser size={15} />, onSelect: onClear, disabled: !captioned, danger: true, separatorBefore: true },
        ]}
      />
    </div>
  );
}

// ------------------------------------------------------- move or copy

export type TransferRequest = { mode: 'move' | 'copy'; targetId: string } | { mode: 'move' | 'copy'; newName: string };

export function TransferDialog({
  open,
  count,
  datasets,
  onClose,
  onSubmit,
}: {
  open: boolean;
  count: number;
  /** The other datasets, most recently used first. */
  datasets: Dataset[];
  onClose: () => void;
  onSubmit: (request: TransferRequest) => void;
}) {
  return (
    <Modal open={open} onClose={onClose}>
      {open && <TransferForm count={count} datasets={datasets} onCancel={onClose} onSubmit={onSubmit} />}
    </Modal>
  );
}

const NEW = '__new';

function TransferForm({
  count,
  datasets,
  onCancel,
  onSubmit,
}: {
  count: number;
  datasets: Dataset[];
  onCancel: () => void;
  onSubmit: (request: TransferRequest) => void;
}) {
  const [mode, setMode] = useState<'move' | 'copy'>('move');
  const [target, setTarget] = useState(datasets[0]?.id ?? NEW);
  const [name, setName] = useState('');
  const valid = target !== NEW || !!name.trim();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onSubmit(target === NEW ? { mode, newName: name.trim() } : { mode, targetId: target });
      }}
    >
      <h2>Move or copy {plural(count, 'image')}</h2>
      <div className="segmented" role="group" aria-label="Move or copy">
        <button type="button" aria-pressed={mode === 'move'} onClick={() => setMode('move')}>
          Move
        </button>
        <button type="button" aria-pressed={mode === 'copy'} onClick={() => setMode('copy')}>
          Copy
        </button>
      </div>
      <label className="field">
        <span className="field-label">To dataset</span>
        <select className="select" autoFocus value={target} onChange={(e) => setTarget(e.target.value)}>
          {datasets.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
          <option value={NEW}>New dataset…</option>
        </select>
      </label>
      {target === NEW && (
        <label className="field">
          <span className="field-label">Name of the new dataset</span>
          <input className="input" autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
      )}
      <p>Captions, crops and hints go with them. Images already in that dataset are skipped.</p>
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={!valid}>
          {mode === 'move' ? 'Move' : 'Copy'}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- tags

export type TagRequest = { tag: string; action: 'start' | 'end' | 'remove' };

export const tagEdit = ({ tag, action }: TagRequest, trigger?: string) =>
  action === 'remove' ? (c: string) => removeTag(c, tag) : (c: string) => addTag(c, tag, action, trigger);

export function TagDialog({
  open,
  captions,
  trigger,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** The selected images' captions. */
  captions: string[];
  trigger?: string;
  onClose: () => void;
  onSubmit: (request: TagRequest) => void;
}) {
  return (
    <Modal open={open} onClose={onClose}>
      {open && <TagForm captions={captions} trigger={trigger} onCancel={onClose} onSubmit={onSubmit} />}
    </Modal>
  );
}

function TagForm({
  captions,
  trigger,
  onCancel,
  onSubmit,
}: {
  captions: string[];
  trigger?: string;
  onCancel: () => void;
  onSubmit: (request: TagRequest) => void;
}) {
  const [tag, setTag] = useState('');
  const [action, setAction] = useState<TagRequest['action']>('end');
  const request = { tag: tag.trim(), action };
  const changes = useMemo(() => {
    if (!tag.trim()) return 0;
    const edit = tagEdit({ tag: tag.trim(), action }, trigger);
    return captions.filter((c) => edit(c) !== c).length;
  }, [captions, tag, action, trigger]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (changes) onSubmit(request);
      }}
    >
      <h2>Tag {plural(captions.length, 'image')}</h2>
      <div className="input-row">
        <input
          className="input"
          autoFocus
          aria-label="Tag"
          placeholder="Tag, e.g. smiling"
          maxLength={100}
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          spellCheck={false}
        />
        <select className="select select-auto" aria-label="What to do" value={action} onChange={(e) => setAction(e.target.value as TagRequest['action'])}>
          <option value="start">Add at start</option>
          <option value="end">Add at end</option>
          <option value="remove">Remove</option>
        </select>
      </div>
      <p>
        {!request.tag
          ? 'Blank captions are skipped so auto-captioning still fills them.'
          : changes
            ? `Changes ${plural(changes, 'caption')}${action === 'start' && trigger ? ', after the trigger word' : ''}.`
            : action === 'remove'
              ? 'None of the selected captions have that tag.'
              : 'Every selected caption already has it.'}
      </p>
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={!changes}>
          Apply
        </button>
      </div>
    </form>
  );
}
