import { useId, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, hasCaption, type Dataset, type ExportOptions } from '@/lib/db';
import { exportFolder, exportOptionsFor, MAX_SIDES } from '@/lib/export';
import { Modal } from '@/components/Modal';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Export choices for one dataset; the last ones used are offered again. */
export function ExportDialog({
  dataset,
  onClose,
  onExport,
}: {
  dataset: Dataset | null;
  onClose: () => void;
  onExport: (dataset: Dataset, options: ExportOptions) => void;
}) {
  return (
    <Modal open={!!dataset} onClose={onClose}>
      {dataset && <ExportForm key={dataset.id} dataset={dataset} onCancel={onClose} onExport={onExport} />}
    </Modal>
  );
}

function ExportForm({
  dataset,
  onCancel,
  onExport,
}: {
  dataset: Dataset;
  onCancel: () => void;
  onExport: (dataset: Dataset, options: ExportOptions) => void;
}) {
  const [options, setOptions] = useState(() => exportOptionsFor(dataset));
  const id = useId();
  const counts = useLiveQuery(async () => {
    let total = 0;
    let blank = 0;
    await db.images
      .where('datasetId')
      .equals(dataset.id)
      .each((img) => {
        total++;
        if (!hasCaption(img)) blank++;
      });
    return { total, blank };
  }, [dataset.id]);
  if (!counts) return null;

  const set = (patch: Partial<ExportOptions>) => setOptions((o) => ({ ...o, ...patch }));
  const kohya = options.layout === 'kohya';
  const count = options.skipBlank ? counts.total - counts.blank : counts.total;
  const valid = count > 0 && (!kohya || options.repeats >= 1);

  return (
    <form
      className="export-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onExport(dataset, options);
      }}
    >
      <h2>Export “{dataset.name}”</h2>

      <div className="field">
        <label className="field-label" htmlFor={`${id}-layout`}>
          Folder layout
        </label>
        <select
          id={`${id}-layout`}
          className="select"
          autoFocus
          aria-describedby={`${id}-layout-hint`}
          value={options.layout}
          onChange={(e) => set({ layout: e.target.value === 'kohya' ? 'kohya' : 'standard' })}
        >
          <option value="standard">Images with .txt captions</option>
          <option value="kohya">kohya_ss (repeats folder)</option>
        </select>
        <span className="field-hint" id={`${id}-layout-hint`}>
          {kohya
            ? 'kohya_ss reads the repeat count from the folder name.'
            : 'For ai-toolkit, OneTrainer, SimpleTuner and most other trainers.'}
        </span>
      </div>

      {kohya && (
        <div className="form-row">
          <label className="field field-narrow">
            <span className="field-label">Repeats</span>
            <input
              className="input"
              type="number"
              min={1}
              max={1000}
              required
              value={options.repeats || ''}
              onChange={(e) => set({ repeats: Math.min(1000, Math.max(0, Math.floor(e.target.valueAsNumber) || 0)) })}
            />
          </label>
          <label className="field">
            <span className="field-label">Class word</span>
            <input
              className="input"
              placeholder="optional, e.g. woman"
              maxLength={60}
              value={options.className}
              onChange={(e) => set({ className: e.target.value })}
            />
          </label>
        </div>
      )}

      <div className="field">
        <label className="field-label" htmlFor={`${id}-size`}>
          Image size
        </label>
        <select
          id={`${id}-size`}
          className="select"
          aria-describedby={options.maxSide > 0 ? `${id}-size-hint` : undefined}
          value={options.maxSide}
          onChange={(e) => set({ maxSide: Number(e.target.value) })}
        >
          {MAX_SIDES.map((n) => (
            <option key={n} value={n}>
              {n ? `Shrink to ${n} px (longest side)` : 'Original size'}
            </option>
          ))}
        </select>
        {options.maxSide > 0 && (
          <span className="field-hint" id={`${id}-size-hint`}>
            Smaller images are left as they are. Shrunk images are saved as PNG.
          </span>
        )}
      </div>

      <div className="check-col">
        <label>
          <input type="checkbox" checked={options.metadata} onChange={(e) => set({ metadata: e.target.checked })} /> Add
          metadata.jsonl (Hugging Face, diffusers)
        </label>
        {counts.blank > 0 && (
          <label>
            <input type="checkbox" checked={options.skipBlank} onChange={(e) => set({ skipBlank: e.target.checked })} />{' '}
            Leave out {plural(counts.blank, 'image')} without a caption
          </label>
        )}
      </div>

      <p className="export-path" title="Where the files go inside the zip">
        <code>{exportFolder(dataset, options)}/</code>
        <span>0001.png + 0001.txt{options.metadata && ', metadata.jsonl'}</span>
      </p>
      {counts.blank > 0 && !options.skipBlank && (
        <p className="export-warn">
          {counts.blank} of {plural(counts.total, 'image')} will get an empty caption file.
        </p>
      )}

      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={!valid}>
          Export {plural(count, 'image')}
        </button>
      </div>
    </form>
  );
}
