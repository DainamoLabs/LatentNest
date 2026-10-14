// Dataset actions shared by the home list and the dataset view.
import { useState } from 'react';
import { browser } from 'wxt/browser';
import { db, type Dataset, type ExportOptions } from '@/lib/db';
import { deleteDataset, updateDataset } from '@/lib/datasets';
import { downloadBlob, exportDatasetZip } from '@/lib/export';
import { toast, toastError } from '@/components/Toasts';
import { useConfirm, usePrompt } from '@/components/Modal';
import { ExportDialog } from './ExportDialog';

export type Busy = { title: string; done: number; total: number } | null;

export function openInTab(datasetId?: string) {
  const hash = datasetId ? `#tab/dataset/${datasetId}` : '#tab';
  void browser.tabs.create({ url: browser.runtime.getURL('/sidepanel.html') + hash });
}

export function openSettings() {
  void browser.runtime.openOptionsPage();
}

export function useDatasetActions() {
  const [confirm, confirmEl] = useConfirm();
  const [prompt, promptEl] = usePrompt();
  const [busy, setBusy] = useState<Busy>(null);
  const [exporting, setExporting] = useState<Dataset | null>(null);

  async function rename(dataset: Dataset) {
    const name = await prompt({ title: 'Rename dataset', label: 'Name', initial: dataset.name });
    if (name && name !== dataset.name) await updateDataset(dataset.id, { name });
  }

  async function remove(dataset: Dataset): Promise<boolean> {
    const count = await db.images.where('datasetId').equals(dataset.id).count();
    const ok = await confirm({
      title: `Delete “${dataset.name}”?`,
      body: `This permanently removes the dataset and its ${count} image${count === 1 ? '' : 's'}. Export it first if you want a copy.`,
      confirmLabel: 'Delete dataset',
      danger: true,
    });
    if (ok) await deleteDataset(dataset.id);
    return ok;
  }

  async function exportZip(dataset: Dataset) {
    if (!(await db.images.where('datasetId').equals(dataset.id).count())) return toast('This dataset has no images to export yet.');
    setExporting(dataset);
  }

  async function runExport(dataset: Dataset, options: ExportOptions) {
    setExporting(null);
    const title = 'Exporting dataset…';
    setBusy({ title, done: 0, total: 0 });
    try {
      await updateDataset(dataset.id, { exportOptions: options });
      const fresh = (await db.datasets.get(dataset.id)) ?? dataset;
      const { blob, filename, count } = await exportDatasetZip(fresh, options, (done, total) => setBusy({ title, done, total }));
      downloadBlob(blob, filename);
      toast(`Exported ${count} image${count === 1 ? '' : 's'} to ${filename}`);
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(null);
    }
  }

  const elements = (
    <>
      {confirmEl}
      {promptEl}
      <ExportDialog dataset={exporting} onClose={() => setExporting(null)} onExport={(d, o) => void runExport(d, o)} />
    </>
  );
  return { rename, remove, exportZip, prompt, confirm, busy, setBusy, elements };
}
