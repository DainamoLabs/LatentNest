import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AppWindow,
  ArrowDownUp,
  ArrowLeft,
  BadgeCheck,
  Download,
  FileArchive,
  FolderOpen,
  ImagePlus,
  LayoutGrid,
  Pencil,
  ReplaceAll,
  Sparkles,
  SquareCheck,
  Trash2,
  X,
} from 'lucide-react';
import { db, hasCaption, needsReview } from '@/lib/db';
import {
  copyImages,
  createDataset,
  deleteImages,
  editCaptions,
  moveImages,
  restoreCaptions,
  restoreHints,
  restoreImages,
  setHints,
  setReviewed,
  updateDataset,
} from '@/lib/datasets';
import {
  filterImages,
  GRID_SIZES,
  isGridSize,
  isSizeLabel,
  isSortKey,
  SIZE_LABELS,
  sortImages,
  SORTS,
  type GridFilter,
  type GridSize,
  type SizeLabel,
  type SortKey,
} from '@/lib/grid';
import { collectDrop, filesFromInput, importFiles, importUrl, type ImportSummary, type InputFile } from '@/lib/import';
import { resolveStyle } from '@/lib/settings';
import { cancelBatch, clearBatch, formatDuration, startBatch, useBatch } from '@/lib/batch';
import { useAddShortcut, useSettings } from '@/hooks/useSettings';
import { MenuButton } from '@/components/Menu';
import { Keys } from '@/components/Keys';
import { BusyModal } from '@/components/Modal';
import { Progress } from '@/components/Progress';
import { toast, toastError } from '@/components/Toasts';
import { ImageGrid } from './ImageGrid';
import { SiteAccessBanner } from './SiteAccessBanner';
import { TimeLeft } from './TimeLeft';
import { SelectionBar, TagDialog, tagEdit, TransferDialog, type TagRequest, type TransferRequest } from './Selection';
import { openInTab, openSettings, useDatasetActions } from './actions';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const SORT_STORAGE = 'latentnest:sort';
const SIZE_STORAGE = 'latentnest:gridSize';
const LABEL_STORAGE = 'latentnest:sizeLabel';

/** A remembered view choice, shared by the side panel and the tab. */
function loadChoice<T extends string>(key: string, valid: (v: unknown) => v is T, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return valid(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function saveChoice(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

function summarize(s: ImportSummary): string {
  const parts = [`Added ${plural(s.added, 'image')}`];
  if (s.captions) parts.push(`${plural(s.captions, 'caption')} imported`);
  if (s.duplicates) parts.push(`${s.duplicates} already here`);
  const [onlyFailure] = s.failed;
  if (onlyFailure && s.failed.length === 1 && !s.added && !s.duplicates) return onlyFailure.reason;
  if (s.failed.length) parts.push(`${s.failed.length} failed`);
  return parts.join(' · ');
}

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function DatasetView({
  id,
  focusId,
  isTab,
  filter,
  onFilterChange,
  onBack,
  onOpenImage,
  onEditCaptions,
}: {
  id: string;
  focusId?: string;
  isTab: boolean;
  filter: GridFilter;
  onFilterChange: (filter: GridFilter) => void;
  onBack: () => void;
  /** `ids` is the order to step through; `review` opens the review queue. */
  onOpenImage: (imageId: string, ids: string[], review?: boolean) => void;
  onEditCaptions: () => void;
}) {
  const dataset = useLiveQuery(async () => (await db.datasets.get(id)) ?? null, [id]);
  const images = useLiveQuery(
    () =>
      db.images
        .where('[datasetId+addedAt]')
        .between([id, -Infinity], [id, Infinity])
        .reverse()
        .toArray(),
    [id],
  );
  const settings = useSettings();
  const batch = useBatch();
  const actions = useDatasetActions();
  const otherDatasets = useLiveQuery(
    async () => (await db.datasets.orderBy('lastUsedAt').reverse().toArray()).filter((d) => d.id !== id),
    [id],
  );
  const shortcut = useAddShortcut();
  const [sort, setSort] = useState(() => loadChoice<SortKey>(SORT_STORAGE, isSortKey, 'newest'));
  const [gridSize, setGridSize] = useState(() => loadChoice<GridSize>(SIZE_STORAGE, isGridSize, 'medium'));
  const [sizeLabel, setSizeLabel] = useState(() => loadChoice<SizeLabel>(LABEL_STORAGE, isSizeLabel, 'off'));
  /** Selected image ids; null outside selection mode. */
  const [selection, setSelection] = useState<Set<string> | null>(null);
  const [dialog, setDialog] = useState<'transfer' | 'tag' | null>(null);
  const [trigger, setTrigger] = useState('');
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (dataset === null) onBack();
  }, [dataset, onBack]);

  useEffect(() => {
    folderInput.current?.setAttribute('webkitdirectory', '');
  }, []);

  // Load the trigger word once per dataset; afterwards local state is the source of truth.
  const triggerLoaded = useRef<string | null>(null);
  useEffect(() => {
    if (dataset && triggerLoaded.current !== dataset.id) {
      triggerLoaded.current = dataset.id;
      setTrigger(dataset.triggerWord ?? '');
    }
  }, [dataset]);
  useEffect(() => {
    if (!dataset || triggerLoaded.current !== dataset.id || trigger === (dataset.triggerWord ?? '')) return;
    const t = setTimeout(() => void updateDataset(dataset.id, { triggerWord: trigger.trim() || undefined }), 500);
    return () => clearTimeout(t);
  }, [trigger, dataset]);

  const counts = useMemo(() => {
    const done = images?.filter(hasCaption).length ?? 0;
    const review = images?.filter(needsReview).length ?? 0;
    return { all: images?.length ?? 0, done, blank: (images?.length ?? 0) - done, review };
  }, [images]);

  const visible = useMemo(() => (images ? sortImages(filterImages(images, filter), sort) : []), [images, filter, sort]);
  /** The selected images still in view, in grid order. */
  const selected = useMemo(() => (selection ? visible.filter((img) => selection.has(img.id)) : []), [selection, visible]);

  function chooseSort(key: SortKey) {
    setSort(key);
    saveChoice(SORT_STORAGE, key);
  }

  function chooseSize(size: GridSize) {
    setGridSize(size);
    saveChoice(SIZE_STORAGE, size);
  }

  function chooseLabel(label: SizeLabel) {
    setSizeLabel(label);
    saveChoice(LABEL_STORAGE, label);
  }

  // Esc leaves selection mode; Ctrl/⌘+A selects every image in view.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping(e.target) || document.querySelector('dialog[open]')) return;
      if (e.key === 'Escape' && selection) {
        e.preventDefault();
        setSelection(null);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && visible.length) {
        e.preventDefault();
        setSelection(new Set(visible.map((img) => img.id)));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selection, visible]);

  const { setBusy } = actions;
  const runImport = useCallback(
    async (files: InputFile[]) => {
      if (!files.length) return;
      const title = 'Importing images…';
      setBusy({ title, done: 0, total: 0 });
      try {
        const summary = await importFiles(id, files, (done, total) => setBusy({ title, done, total }));
        toast(summarize(summary), { kind: summary.added || summary.captions ? 'info' : 'error' });
      } catch (err) {
        toastError(err);
      } finally {
        setBusy(null);
      }
    },
    [id, setBusy],
  );

  async function addUrl(url: string) {
    try {
      const result = await importUrl(id, url);
      toast(result.status === 'added' ? 'Image added' : 'That image is already in this dataset');
    } catch (err) {
      toastError(err);
    }
  }

  // Paste images straight from the clipboard.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target)) return;
      const files = Array.from(e.clipboardData?.files ?? []);
      if (!files.length) return;
      e.preventDefault();
      void runImport(files.map((f) => ({ path: f.name || 'pasted.png', blob: f })));
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [runImport]);

  const openImage = useCallback(
    (imageId: string) =>
      onOpenImage(
        imageId,
        visible.map((img) => img.id),
        filter === 'review',
      ),
    [onOpenImage, visible, filter],
  );

  const removeImages = useCallback(async (ids: string[]) => {
    const deleted = await deleteImages(ids);
    if (!deleted.length) return;
    setSelection(null);
    toast(deleted.length === 1 ? 'Image deleted' : `Deleted ${deleted.length} images`, {
      action: { label: 'Undo', run: () => void restoreImages(deleted) },
    });
  }, []);

  if (!dataset || !images || !settings) return null;

  /** Saves the trigger word as typed, so runs and exports use what's on screen. */
  async function flushTrigger() {
    const triggerWord = trigger.trim() || undefined;
    if (dataset && triggerWord !== dataset.triggerWord) await updateDataset(dataset.id, { triggerWord });
  }

  function startReview() {
    const queue = sortImages(images!.filter(needsReview), sort);
    if (!queue[0]) return;
    onFilterChange('review');
    onOpenImage(
      queue[0].id,
      queue.map((img) => img.id),
      true,
    );
  }

  async function approve(ids: string[]) {
    const changed = await setReviewed(ids, true);
    if (!changed.length) return toast('Nothing to approve.');
    toast(`Approved ${plural(changed.length, 'auto-caption')}`, {
      action: { label: 'Undo', run: () => void setReviewed(changed, false) },
    });
  }

  async function editSelected(edit: (caption: string) => string, describe: (n: number) => string) {
    try {
      const before = await editCaptions(dataset!.id, edit, selected.map((img) => img.id));
      if (!before.length) return toast('Nothing to change.');
      toast(describe(before.length), { action: { label: 'Undo', run: () => void restoreCaptions(before) } });
    } catch (err) {
      toastError(err);
    }
  }

  async function setHint() {
    const ids = selected.map((img) => img.id);
    const hints = new Set(selected.map((img) => img.hint ?? ''));
    const hint = await actions.prompt({
      title: `Captioning hint for ${plural(ids.length, 'image')}`,
      label: 'Hint',
      initial: hints.size === 1 ? [...hints][0] : '',
      placeholder: 'e.g. back view, holding a katana',
      hint: 'Sent to the model with the caption style. Leave it empty to remove the hint.',
      maxLength: 300,
      allowEmpty: true,
      confirmLabel: 'Save',
    });
    if (hint === null) return;
    const before = await setHints(ids, hint);
    if (!before.length) return toast('Nothing to change.');
    toast(hint ? `Hint set on ${plural(before.length, 'image')}` : `Hint removed from ${plural(before.length, 'image')}`, {
      action: { label: 'Undo', run: () => void restoreHints(before) },
    });
  }

  async function transfer(request: TransferRequest) {
    setDialog(null);
    const ids = selected.map((img) => img.id);
    try {
      const target = 'targetId' in request ? await db.datasets.get(request.targetId) : await createDataset(request.newName);
      if (!target) throw new Error('That dataset no longer exists.');
      const move = request.mode === 'move';
      const result = await (move ? moveImages : copyImages)(ids, target.id);
      if (!result.ids.length) {
        return toast(`“${target.name}” already has ${ids.length === 1 ? 'that image' : 'these images'}.`);
      }
      if (move) setSelection(null);
      const skipped = result.skipped ? ` · ${result.skipped} already there` : '';
      toast(`${move ? 'Moved' : 'Copied'} ${plural(result.ids.length, 'image')} to “${target.name}”${skipped}`, {
        action: {
          label: 'Undo',
          run: () => void (move ? moveImages(result.ids, dataset!.id) : deleteImages(result.ids)).catch(toastError),
        },
      });
    } catch (err) {
      toastError(err);
    }
  }

  function tag(request: TagRequest) {
    setDialog(null);
    const what = request.action === 'remove' ? `Removed “${request.tag}” from` : `Added “${request.tag}” to`;
    void editSelected(tagEdit(request, dataset!.triggerWord), (n) => `${what} ${plural(n, 'caption')}`);
  }

  if (!dataset || !images || !settings) return null;

  const style = resolveStyle(settings.styles, dataset.captionStyleId);
  const myBatch = batch?.datasetId === id ? batch : null;
  const otherBatchRunning = !!batch?.running && batch.datasetId !== id;
  const configured = !!settings.backend.model.trim() || settings.backend.preset === 'llamacpp';
  const acceptsDrag = (dt: DataTransfer) =>
    dt.types.includes('Files') || dt.types.includes('text/uri-list') || dt.types.includes('text/html');

  return (
    <div
      className="drop-area"
      onDragEnter={(e) => {
        if (!acceptsDrag(e.dataTransfer)) return;
        e.preventDefault();
        dragDepth.current++;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (!acceptsDrag(e.dataTransfer)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        const { files, urls } = collectDrop(e.dataTransfer);
        if (urls[0]) void addUrl(urls[0]);
        else void files.then(runImport, toastError);
      }}
    >
      {dragging && <div className="drop-overlay">Drop images, folders or ZIPs</div>}

      <header className="topbar">
        <button className="icon-btn" aria-label="Back to datasets" title="Back" onClick={onBack}>
          <ArrowLeft size={18} />
        </button>
        <h1 className="topbar-title" title={dataset.name}>
          {dataset.name}
        </h1>
        <MenuButton
          label="Import images"
          icon={<ImagePlus size={18} />}
          items={[
            { label: 'Images, captions or ZIP…', icon: <FileArchive size={15} />, onSelect: () => fileInput.current?.click() },
            { label: 'Folder…', icon: <FolderOpen size={15} />, onSelect: () => folderInput.current?.click() },
          ]}
        />
        <MenuButton
          items={[
            { label: 'Rename', icon: <Pencil size={15} />, onSelect: () => void actions.rename(dataset) },
            { label: 'Edit captions…', icon: <ReplaceAll size={15} />, onSelect: onEditCaptions, hidden: !images.length },
            {
              label: `Approve all ${plural(counts.review, 'auto-caption')}`,
              icon: <BadgeCheck size={15} />,
              onSelect: () => void approve(images.filter(needsReview).map((img) => img.id)),
              hidden: !counts.review,
            },
            {
              label: 'Export ZIP…',
              icon: <Download size={15} />,
              onSelect: () =>
                void flushTrigger().then(async () => actions.exportZip((await db.datasets.get(dataset.id)) ?? dataset)),
            },
            { label: 'Open in tab', icon: <AppWindow size={15} />, onSelect: () => openInTab(dataset.id), hidden: isTab },
            {
              label: 'Delete dataset',
              icon: <Trash2 size={15} />,
              danger: true,
              separatorBefore: true,
              onSelect: () => void actions.remove(dataset),
            },
          ]}
        />
      </header>

      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        accept="image/*,.txt,.caption,.zip"
        onChange={(e) => {
          void runImport(filesFromInput(e.target.files));
          e.target.value = '';
        }}
      />
      <input
        ref={folderInput}
        type="file"
        hidden
        onChange={(e) => {
          void runImport(filesFromInput(e.target.files));
          e.target.value = '';
        }}
      />

      <SiteAccessBanner />

      <div className="ds-stats">
        <span>
          {plural(counts.all, 'image')} · {counts.done} captioned
        </span>
        <Progress value={counts.done} max={counts.all} label="Captioned" />
      </div>

      <section className="caption-panel" aria-label="Auto-captioning">
        <div className="caption-panel-row">
          <label className="field">
            <span className="field-label">Caption style</span>
            <select
              className="select"
              value={style?.id ?? ''}
              onChange={(e) => {
                if (e.target.value === '__manage') openSettings();
                else void updateDataset(dataset.id, { captionStyleId: e.target.value });
              }}
            >
              {settings.styles.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
              <option disabled>──────────</option>
              <option value="__manage">Manage styles…</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Trigger word</span>
            <input
              className="input"
              placeholder="optional, e.g. ohwx"
              value={trigger}
              onChange={(e) => setTrigger(e.target.value)}
            />
          </label>
        </div>

        {myBatch?.running ? (
          <div className="batch">
            <div className="batch-row">
              <span>
                {myBatch.total
                  ? `Captioning ${Math.min(myBatch.done + myBatch.failed + 1, myBatch.total)} of ${myBatch.total}…`
                  : 'Starting…'}
              </span>
              <button className="btn btn-sm btn-ghost" onClick={cancelBatch}>
                Stop
              </button>
            </div>
            <Progress value={myBatch.done + myBatch.failed} max={myBatch.total} label="Auto-captioning" />
            <span className="field-hint">
              <TimeLeft job={myBatch}>
                {(timing) =>
                  timing &&
                  (timing.left >= 1000
                    ? `About ${formatDuration(timing.left)} left (${formatDuration(timing.perImage)} per image). `
                    : 'Almost done. ')
                }
              </TimeLeft>
              Keeps running if you close the panel.
            </span>
          </div>
        ) : (
          <>
            {myBatch && (
              <div className="batch">
                <div className="batch-row">
                  <span>
                    Captioned {plural(myBatch.done, 'image')}
                    {myBatch.failed > 0 && ` · ${myBatch.failed} failed`}
                    {myBatch.progressAt && ` · took ${formatDuration(myBatch.progressAt - myBatch.startedAt)}`}
                  </span>
                  <button className="icon-btn" style={{ width: 24, height: 24 }} aria-label="Dismiss" onClick={() => void clearBatch()}>
                    <X size={14} />
                  </button>
                </div>
                {myBatch.error && <span className="batch-error">{myBatch.error}</span>}
              </div>
            )}
            {configured ? (
              <button
                className="btn btn-block"
                disabled={!counts.blank || otherBatchRunning || !style}
                title={otherBatchRunning ? 'Another dataset is being captioned' : undefined}
                onClick={async () => {
                  await flushTrigger();
                  startBatch(dataset.id).catch(toastError);
                }}
              >
                <Sparkles size={16} color="var(--accent)" />
                {counts.blank ? `Auto-caption ${plural(counts.blank, 'blank image')}` : 'All images captioned'}
              </button>
            ) : (
              <button className="btn btn-block" onClick={openSettings}>
                <Sparkles size={16} color="var(--accent)" /> Set up a captioning model
              </button>
            )}
          </>
        )}
        {counts.review > 0 && (
          <div className="review-row">
            <span>
              <b>{counts.review}</b> auto-caption{counts.review === 1 ? '' : 's'} to review
            </span>
            <button className="btn btn-sm" onClick={startReview}>
              <BadgeCheck size={14} /> Review
            </button>
          </div>
        )}
      </section>

      {images.length > 0 ? (
        <>
          {selection ? (
            <SelectionBar
              count={selected.length}
              allSelected={selected.length === visible.length}
              blank={selected.filter((img) => !hasCaption(img)).length}
              captioned={selected.filter(hasCaption).length}
              review={selected.filter(needsReview).length}
              captionBlocked={
                !configured
                  ? 'Set up a captioning model in Settings first'
                  : batch?.running
                    ? 'Wait for the current auto-captioning to finish'
                    : !style
                      ? 'Add a caption style in Settings first'
                      : undefined
              }
              onSelectAll={() =>
                setSelection(selected.length === visible.length ? new Set() : new Set(visible.map((img) => img.id)))
              }
              onCancel={() => setSelection(null)}
              onCaption={async () => {
                const ids = selected.filter((img) => !hasCaption(img)).map((img) => img.id);
                await flushTrigger();
                startBatch(dataset.id, ids).then(() => setSelection(null), toastError);
              }}
              onTransfer={() => setDialog('transfer')}
              onDelete={() => void removeImages(selected.map((img) => img.id))}
              onTag={() => setDialog('tag')}
              onHint={() => void setHint()}
              onApprove={() => void approve(selected.map((img) => img.id))}
              onClear={() =>
                void editSelected(
                  () => '',
                  (n) => `Cleared ${plural(n, 'caption')}`,
                )
              }
            />
          ) : (
            <div className="toolbar">
              <div className="segmented" role="group" aria-label="Filter images">
                {(
                  [
                    ['all', 'All', counts.all],
                    ['blank', 'Blank', counts.blank],
                    ['done', 'Captioned', counts.done],
                    ['review', 'Review', counts.review],
                  ] as const
                ).map(([key, label, n]) => (
                  <button
                    key={key}
                    aria-pressed={filter === key}
                    title={key === 'review' ? 'Auto-captions nobody has approved or edited yet' : undefined}
                    onClick={() => onFilterChange(key)}
                  >
                    {label}
                    <span className="count">{n}</span>
                  </button>
                ))}
              </div>
              <div className="toolbar-actions">
                <MenuButton
                  label={`Sort: ${SORTS.find((s) => s.key === sort)?.label}`}
                  icon={<ArrowDownUp size={17} />}
                  className={sort === 'newest' ? 'icon-btn' : 'icon-btn is-on'}
                  items={SORTS.map((s) => ({ label: s.label, checked: s.key === sort, onSelect: () => chooseSort(s.key) }))}
                />
                <MenuButton
                  label={`Thumbnails: ${GRID_SIZES.find((s) => s.key === gridSize)?.label}${sizeLabel === 'off' ? '' : `, showing ${sizeLabel}`}`}
                  icon={<LayoutGrid size={17} />}
                  items={[
                    ...GRID_SIZES.map((s, i) => ({
                      label: s.label,
                      heading: i === 0 ? 'Thumbnail size' : undefined,
                      checked: s.key === gridSize,
                      onSelect: () => chooseSize(s.key),
                    })),
                    ...SIZE_LABELS.map((s, i) => ({
                      label: s.label,
                      heading: i === 0 ? 'Show image size' : undefined,
                      checked: s.key === sizeLabel,
                      onSelect: () => chooseLabel(s.key),
                    })),
                  ]}
                />
                <button
                  className="icon-btn"
                  title="Select images (or Ctrl/⌘-click one)"
                  aria-label="Select images"
                  onClick={() => setSelection(new Set())}
                >
                  <SquareCheck size={17} />
                </button>
                <button className="icon-btn" title="Edit captions in bulk" aria-label="Edit captions in bulk" onClick={onEditCaptions}>
                  <ReplaceAll size={17} />
                </button>
              </div>
            </div>
          )}
          {visible.length > 0 ? (
            <ImageGrid
              images={visible}
              focusId={focusId}
              workingId={myBatch?.currentId}
              selection={selection}
              size={gridSize}
              sizeLabel={sizeLabel}
              onOpen={openImage}
              onSelectionChange={setSelection}
              onDelete={(ids) => void removeImages(ids)}
              onSizeChange={chooseSize}
            />
          ) : (
            <p className="grid-empty">
              {filter === 'review'
                ? 'No auto-captions left to review.'
                : filter === 'blank'
                  ? 'Every image has a caption.'
                  : 'No captioned images yet.'}
            </p>
          )}
        </>
      ) : (
        <div className="empty">
          <img src="/logo.png" alt="" />
          <strong>This dataset is empty</strong>
          <p>
            Right-click any image on the web and choose <b>Add to Dataset</b> (or <b>Add Frame to Dataset</b> on a
            video), or drop images, folders or ZIPs here.
            Matching .txt files become captions.
          </p>
          {shortcut && (
            <p>
              Where a site has its own right-click menu, like TikTok, point at the picture or video and press{' '}
              <Keys value={shortcut} />.
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button className="btn btn-sm" onClick={() => fileInput.current?.click()}>
              <FileArchive size={14} /> Choose files
            </button>
            <button className="btn btn-sm" onClick={() => folderInput.current?.click()}>
              <FolderOpen size={14} /> Choose folder
            </button>
          </div>
        </div>
      )}

      <TransferDialog
        open={dialog === 'transfer'}
        count={selected.length}
        datasets={otherDatasets ?? []}
        onClose={() => setDialog(null)}
        onSubmit={(request) => void transfer(request)}
      />
      <TagDialog
        open={dialog === 'tag'}
        captions={selected.map((img) => img.caption)}
        trigger={dataset.triggerWord}
        onClose={() => setDialog(null)}
        onSubmit={tag}
      />
      {actions.elements}
      <BusyModal busy={actions.busy} />
    </div>
  );
}
