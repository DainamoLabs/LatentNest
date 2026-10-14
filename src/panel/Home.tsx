import { useLiveQuery } from 'dexie-react-hooks';
import { AppWindow, Download, Pencil, Plus, Settings, Trash2 } from 'lucide-react';
import { db, type Dataset } from '@/lib/db';
import { createDataset } from '@/lib/datasets';
import { formatDuration, useBatch } from '@/lib/batch';
import { BrandTile } from '@/components/Mark';
import { Footer } from '@/components/Footer';
import { MenuButton } from '@/components/Menu';
import { BusyModal } from '@/components/Modal';
import { Progress } from '@/components/Progress';
import { SiteAccessBanner } from './SiteAccessBanner';
import { TimeLeft } from './TimeLeft';
import { openInTab, openSettings, useDatasetActions } from './actions';

interface Row {
  dataset: Dataset;
  total: number;
  captioned: number;
}

export function Home({ onOpen, isTab }: { onOpen: (id: string) => void; isTab: boolean }) {
  const actions = useDatasetActions();
  const batch = useBatch();

  const rows = useLiveQuery(async (): Promise<Row[]> => {
    const datasets = await db.datasets.orderBy('lastUsedAt').reverse().toArray();
    const stats = new Map(datasets.map((d) => [d.id, { total: 0, captioned: 0 }]));
    await db.images.each((img) => {
      const s = stats.get(img.datasetId);
      if (!s) return;
      s.total++;
      if (img.caption.trim()) s.captioned++;
    });
    return datasets.map((dataset) => ({ dataset, ...stats.get(dataset.id)! }));
  }, []);

  async function create() {
    const name = await actions.prompt({ title: 'New dataset', label: 'Name', confirmLabel: 'Create' });
    if (name) onOpen((await createDataset(name)).id);
  }

  return (
    <>
      <header className="topbar">
        <BrandTile />
        <h1 className="topbar-title">LatentNest</h1>
        {!isTab && (
          <button className="icon-btn" title="Open in a tab" aria-label="Open in a tab" onClick={() => openInTab()}>
            <AppWindow size={18} />
          </button>
        )}
        <button className="icon-btn" title="Settings" aria-label="Settings" onClick={openSettings}>
          <Settings size={18} />
        </button>
      </header>

      <SiteAccessBanner />

      <div className="section-head">
        <h2>My Datasets</h2>
        {rows && (
          <span>
            {rows.length} collection{rows.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {rows && rows.length === 0 && (
        <div className="empty" style={{ marginBottom: 12 }}>
          <img src="/logo.png" alt="" />
          <strong>No datasets yet</strong>
          <p>Create a dataset, then right-click any image on the web and choose “Add to Dataset”, or any video for “Add Frame to Dataset”.</p>
        </div>
      )}

      <div className="dataset-list">
        {rows?.map(({ dataset, total, captioned }) => (
          <div className="dataset-card" key={dataset.id}>
            <button className="dataset-card-main" onClick={() => onOpen(dataset.id)}>
              <span className="dataset-card-name">{dataset.name}</span>
              <span className="dataset-card-meta">
                {total} image{total === 1 ? '' : 's'} · {captioned} captioned
                {batch?.running && batch.datasetId === dataset.id && (
                  <span className="card-busy">
                    {' · '}
                    <TimeLeft job={batch}>
                      {(timing) => (timing && timing.left >= 1000 ? `auto-captioning, ${formatDuration(timing.left)} left` : 'auto-captioning…')}
                    </TimeLeft>
                  </span>
                )}
              </span>
              <Progress value={captioned} max={total} label="Captioned" />
            </button>
            <MenuButton
              label={`Actions for ${dataset.name}`}
              items={[
                { label: 'Rename', icon: <Pencil size={15} />, onSelect: () => void actions.rename(dataset) },
                { label: 'Export ZIP…', icon: <Download size={15} />, onSelect: () => void actions.exportZip(dataset) },
                {
                  label: 'Open in tab',
                  icon: <AppWindow size={15} />,
                  onSelect: () => openInTab(dataset.id),
                  hidden: isTab,
                },
                {
                  label: 'Delete',
                  icon: <Trash2 size={15} />,
                  danger: true,
                  separatorBefore: true,
                  onSelect: () => void actions.remove(dataset),
                },
              ]}
            />
          </div>
        ))}
      </div>

      <button className="btn btn-primary btn-lg btn-block" onClick={create}>
        <Plus size={18} /> Create Dataset
      </button>

      <Footer />
      {actions.elements}
      <BusyModal busy={actions.busy} />
    </>
  );
}
