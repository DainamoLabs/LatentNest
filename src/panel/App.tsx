import { useCallback, useEffect, useState } from 'react';
import type { GridFilter } from '@/lib/grid';
import { Toasts } from '@/components/Toasts';
import { Home } from './Home';
import { DatasetView } from './DatasetView';
import { Editor } from './Editor';
import { CaptionTools } from './CaptionTools';

type View =
  | { name: 'home' }
  | { name: 'dataset'; id: string; focusId?: string }
  | { name: 'editor'; datasetId: string; imageId: string; ids: string[]; review?: boolean }
  | { name: 'captions'; datasetId: string };

/** The same app runs in the side panel and, with `#tab`, in a full browser tab. */
export const isTab = location.hash.startsWith('#tab');
const STORAGE_KEY = 'latentnest:lastDataset';

function initialView(): View {
  const deepLink = location.hash.match(/^#tab\/dataset\/([\w-]+)/);
  if (deepLink?.[1]) return { name: 'dataset', id: deepLink[1] };
  if (!isTab) {
    try {
      const id = localStorage.getItem(STORAGE_KEY);
      if (id) return { name: 'dataset', id };
    } catch {
      /* storage unavailable */
    }
  }
  return { name: 'home' };
}

export function App() {
  const [view, setView] = useState<View>(initialView);
  // The grid filter survives a trip to the editor; a different dataset starts on All.
  const [grid, setGrid] = useState<{ datasetId: string; filter: GridFilter } | null>(null);

  // Reopen the side panel where the user left off; keep the tab URL shareable.
  const datasetId = view.name === 'home' ? null : view.name === 'dataset' ? view.id : view.datasetId;
  useEffect(() => {
    if (isTab) {
      history.replaceState(null, '', datasetId ? `#tab/dataset/${datasetId}` : '#tab');
      return;
    }
    try {
      if (datasetId) localStorage.setItem(STORAGE_KEY, datasetId);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable */
    }
  }, [datasetId]);

  const goHome = useCallback(() => setView({ name: 'home' }), []);
  const openDataset = useCallback((id: string) => {
    window.scrollTo(0, 0);
    setView({ name: 'dataset', id });
  }, []);
  const openImage = useCallback(
    (imageId: string, ids: string[], review?: boolean) => {
      if (!datasetId) return;
      window.scrollTo(0, 0);
      setView({ name: 'editor', datasetId, imageId, ids, review });
    },
    [datasetId],
  );
  const setFilter = useCallback((filter: GridFilter) => datasetId && setGrid({ datasetId, filter }), [datasetId]);
  const backToGrid = useCallback(
    (focusId?: string) => datasetId && setView({ name: 'dataset', id: datasetId, focusId }),
    [datasetId],
  );
  const editCaptions = useCallback(() => {
    if (!datasetId) return;
    window.scrollTo(0, 0);
    setView({ name: 'captions', datasetId });
  }, [datasetId]);

  return (
    <div className="app">
      {view.name === 'home' && <Home onOpen={openDataset} isTab={isTab} />}
      {view.name === 'dataset' && (
        <DatasetView
          key={view.id}
          id={view.id}
          focusId={view.focusId}
          isTab={isTab}
          filter={grid?.datasetId === view.id ? grid.filter : 'all'}
          onFilterChange={setFilter}
          onBack={goHome}
          onOpenImage={openImage}
          onEditCaptions={editCaptions}
        />
      )}
      {view.name === 'editor' && (
        <Editor
          datasetId={view.datasetId}
          imageId={view.imageId}
          ids={view.ids}
          review={view.review}
          onNavigate={openImage}
          onBack={backToGrid}
        />
      )}
      {view.name === 'captions' && <CaptionTools datasetId={view.datasetId} onBack={backToGrid} />}
      <Toasts />
    </div>
  );
}
