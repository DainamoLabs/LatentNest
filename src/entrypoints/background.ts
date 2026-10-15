import { defineBackground } from 'wxt/utils/define-background';
import { browser, type Browser } from 'wxt/browser';
import { db, type BatchJob, type Dataset } from '@/lib/db';
import { addImage, createDataset, deleteDataset, deleteImage, setDatasetsChangedHandler } from '@/lib/datasets';
import { nameFromUrl, sniffMime } from '@/lib/image';
import { fullSizeUrls } from '@/lib/fullSize';
import { captureVideoFrame, grabImageInPage, promptDatasetName, showToast } from '@/lib/inpage';
import type { FindRequest, FinderGlobal, Found } from '@/lib/findImage';
import { ADD_COMMAND, parseMenuId, rebuildMenus, type MenuKind } from '@/lib/menus';
import { hasSiteAccess, openSidePanel, toggleSidebar } from '@/lib/platform';
import { abortBatch, endInterruptedBatch, formatDuration, isLive, queueBatch, runQueuedBatch, type BatchMessage } from '@/lib/batch';
import { getBackend, getStyles } from '@/lib/settings';
import toastMark from '@/assets/toast-mark.png?inline';

type Tab = Browser.tabs.Tab | undefined;
type ClickInfo = Browser.contextMenus.OnClickData;
/** How an add was asked for: a context-menu item, or the keyboard shortcut. */
type Via = 'menu' | 'shortcut';

/** Sent by the page toast's Undo button. */
interface UndoAdd {
  type: 'add:undo';
  imageId: string;
  datasetId: string;
  /** The dataset was made for this image; it goes too if nothing else was added. */
  newDataset: boolean;
  /** The dataset's last-used time before, so the shortcut and menu order go back too. */
  lastUsedAt: number;
}
/** Undo only reaches back this far. */
const UNDO_WINDOW_MS = 2 * 60_000;

/** What a context-menu click produced, ready to store. */
interface Grabbed {
  blob: Blob;
  name: string;
  sourceUrl?: string;
  frameTime?: number;
  /** Frame came from a screenshot because the site blocks reading the video. */
  fromScreen?: boolean;
}

export default defineBackground(() => {
  setDatasetsChangedHandler(() => void rebuildMenus());

  browser.runtime.onInstalled.addListener(() => {
    void rebuildMenus();
    // Pages already open don't get a newly registered script, nor one from before an update.
    void syncFinder(true);
    void endInterruptedBatch();
  });
  browser.runtime.onStartup.addListener(() => {
    void rebuildMenus();
    void syncFinder(false);
    void endInterruptedBatch();
  });
  browser.permissions.onAdded.addListener(() => void syncFinder(true));
  browser.permissions.onRemoved.addListener(() => void syncFinder(false));

  if (import.meta.env.FIREFOX) {
    browser.action.onClicked.addListener(() => void toggleSidebar());
  } else {
    browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
  }

  browser.contextMenus.onClicked.addListener((info, tab) => {
    const menu = parseMenuId(String(info.menuItemId));
    if (!menu) return;
    if (menu.action === 'more') void openSidePanel(tab?.windowId);
    else void addFromContextMenu(menu.kind, menu.action === 'new' ? 'new' : menu.datasetId, info, tab);
  });

  browser.commands.onCommand.addListener((command, tab) => {
    if (command === ADD_COMMAND) void addUnderPointer(tab);
  });

  browser.notifications.onClicked.addListener(openNotifiedDataset);

  browser.runtime.onMessage.addListener((msg: { type?: string } | BatchMessage, sender, sendResponse) => {
    switch (msg?.type) {
      case 'add:undo':
        // Only from a toast this extension put in a page.
        if (sender.id !== browser.runtime.id || !sender.tab) return;
        undoAdd(msg as UndoAdd, sender.tab).then(
          () => sendResponse({}),
          (err) => sendResponse({ error: message(err) }),
        );
        return true;
      case 'menus:refresh':
        void rebuildMenus();
        return;
      case 'batch:start': {
        const { datasetId, ids } = msg as Extract<BatchMessage, { type: 'batch:start' }>;
        startBatch(datasetId, ids).then(
          (error) => sendResponse({ error }),
          (err) => sendResponse({ error: message(err) }),
        );
        return true;
      }
      case 'batch:settings':
        void loadSettings().then(sendResponse);
        return true;
      case 'batch:badge':
        setBatchBadge((msg as Extract<BatchMessage, { type: 'batch:badge' }>).text || null);
        return;
      case 'batch:done': {
        const { job, cancelled } = msg as Extract<BatchMessage, { type: 'batch:done' }>;
        void notifyBatchEnded(job, cancelled);
        return;
      }
      case 'batch:cancel':
        if (import.meta.env.FIREFOX) abortBatch();
        return;
      case 'batch:finished':
        void closeRunner();
        return;
    }
  });

  // Browser automation can't click native context menus; `wxt build --mode e2e`
  // exposes the handler instead. Stripped from normal builds.
  if (import.meta.env.MODE === 'e2e') {
    Object.assign(globalThis, { __latentnest: { addFromContextMenu, addUnderPointer, rebuildMenus, openNotifiedDataset } });
  }
});

// ------------------------------------------------------------ batch runs

const loadSettings = async () => ({ backend: await getBackend(), styles: await getStyles() });

function setBatchBadge(text: string | null) {
  void browser.action.setBadgeBackgroundColor({ color: '#f29f2e' });
  void browser.action.setBadgeText({ text: text ?? '' });
}

/** Queues a run and hands it to the runner. Resolves to an error message, if any. */
async function startBatch(datasetId: string, ids?: string[]): Promise<string | undefined> {
  const busy = await queueBatch(datasetId, ids);
  if (busy) return busy;
  if (import.meta.env.FIREFOX) {
    // The event page itself runs it; the heartbeat's API call keeps the page alive.
    void loadSettings().then((settings) =>
      runQueuedBatch(settings, {
        badge: setBatchBadge,
        keepAlive: () => void browser.runtime.getPlatformInfo(),
        ended: (job, cancelled) => void notifyBatchEnded(job, cancelled),
      }),
    );
    return;
  }
  try {
    await browser.offscreen.createDocument({
      url: '/offscreen.html',
      reasons: ['BLOBS'],
      justification: 'Runs batch auto-captioning with the local vision model so it continues after the side panel closes.',
    });
  } catch {
    // Already open (one per extension): it picks the job up when woken.
    await browser.runtime.sendMessage({ type: 'batch:wake' } satisfies BatchMessage).catch(() => {});
  }
}

/** Runs shorter than this end while you're still looking. */
const NOTIFY_AFTER_MS = 20_000;
/** Followed by the dataset id, so a click knows what to open even after a restart. */
const BATCH_NOTIFICATION = 'latentnest-batch:';

/** A desktop notification when a long run ends, unless you stopped it yourself. */
async function notifyBatchEnded(job: BatchJob, cancelled: boolean) {
  if (cancelled || !job.total || Date.now() - job.startedAt < NOTIFY_AFTER_MS) return;
  const dataset = await db.datasets.get(job.datasetId);
  const name = dataset?.name ?? 'Your dataset';
  const finished = job.done + job.failed;
  const took = job.progressAt ? ` in ${formatDuration(job.progressAt - job.startedAt)}` : '';
  const counts = `${job.done} captioned${job.failed ? `, ${job.failed} failed` : ''}`;
  const stopped = finished < job.total;
  await browser.notifications
    .create(BATCH_NOTIFICATION + job.datasetId, {
      type: 'basic',
      iconUrl: browser.runtime.getURL('/icon/128.png'),
      title: stopped ? 'Auto-captioning stopped' : 'Auto-captioning finished',
      message: stopped
        ? `${name}: stopped after ${finished} of ${job.total}. ${job.error ?? ''}`.trim()
        : `${name}: ${counts}${took}.`,
    })
    .catch(() => {});
}

function openNotifiedDataset(notificationId: string) {
  if (!notificationId.startsWith(BATCH_NOTIFICATION)) return;
  void browser.notifications.clear(notificationId);
  const hash = `#tab/dataset/${notificationId.slice(BATCH_NOTIFICATION.length)}`;
  void browser.tabs.create({ url: browser.runtime.getURL('/sidepanel.html') + hash });
}

async function closeRunner() {
  setBatchBadge(null);
  if (import.meta.env.FIREFOX || isLive(await db.jobs.get('batch'))) return;
  await browser.offscreen.closeDocument().catch(() => {});
}

// ------------------------------------------------------- page finder

const FINDER_ID = 'latentnest-finder';
const FINDER_FILE = '/finder.js';

/**
 * With website access, the finder script runs in every page so it sees each
 * right-click. Without it, the script is only injected when a menu item is
 * chosen, which is too late to know where the click was. Serialized like the
 * menu rebuilds, since install and permission events can overlap.
 */
let finderQueue: Promise<void> = Promise.resolve();
function syncFinder(injectOpenTabs: boolean): Promise<void> {
  finderQueue = finderQueue.then(() => updateFinder(injectOpenTabs));
  return finderQueue;
}

async function updateFinder(injectOpenTabs: boolean) {
  try {
    const access = await hasSiteAccess();
    const registered = (await browser.scripting.getRegisteredContentScripts({ ids: [FINDER_ID] })).length > 0;
    if (!access) {
      if (registered) await browser.scripting.unregisterContentScripts({ ids: [FINDER_ID] });
      return;
    }
    if (!registered) {
      await browser.scripting.registerContentScripts([
        { id: FINDER_ID, js: [FINDER_FILE], matches: ['<all_urls>'], allFrames: true, runAt: 'document_start' },
      ]);
    }
    if (!injectOpenTabs) return;
    for (const tab of await browser.tabs.query({ url: ['http://*/*', 'https://*/*'] })) {
      if (tab.id === undefined || tab.discarded) continue;
      browser.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: [FINDER_FILE] }).catch(() => {});
    }
  } catch (err) {
    console.error('LatentNest: couldn’t set up the page finder', err);
  }
}

/** Asks the page what was under the right-click (or the pointer). Null when the page can't be scripted. */
async function findInPage(info: ClickInfo, tab: Tab, via: Via): Promise<Found | null> {
  if (tab?.id === undefined) return null;
  const target = { tabId: tab.id, frameIds: [info.frameId ?? 0] };
  const request: FindRequest = { srcUrl: info.srcUrl, linkUrl: info.linkUrl, pointer: via === 'shortcut' ? 'hover' : 'menu' };
  const ask = async () => {
    const [injection] = await browser.scripting.executeScript({
      target,
      func: (request: FindRequest) => (globalThis as FinderGlobal).__latentnestFind?.(request) ?? null,
      args: [request],
    });
    return (injection?.result as Found | null | undefined) ?? null;
  };
  try {
    const found = await ask();
    if (found) return found;
    await browser.scripting.executeScript({ target, files: [FINDER_FILE] });
    return await ask();
  } catch {
    return null; // restricted page, or a frame we can't reach
  }
}

async function nothingFound(found: Found | null, via: Via): Promise<string> {
  if (via === 'shortcut' && found?.kind === 'none') {
    // Injected just now, the page script hasn't seen the pointer yet; it has from here on.
    return found.reason === 'nothing-here'
      ? 'No image or video under the pointer.'
      : 'Move the pointer over the picture, then press the shortcut again.';
  }
  if (found?.kind === 'none' && found.reason === 'nothing-here') return 'No image found where you right-clicked.';
  if (!(await hasSiteAccess())) {
    return 'To save images a site covers with an overlay (like Instagram), allow website access in the LatentNest side panel, then reload the page.';
  }
  return found ? 'Reload the page, then try again.' : 'LatentNest can’t access this page.';
}

// ------------------------------------------------- context menu, shortcut

/**
 * The keyboard shortcut, for sites that replace the browser's right-click
 * menu (TikTok, YouTube): whatever is under the pointer goes into the most
 * recently used dataset.
 */
async function addUnderPointer(tab: Tab) {
  tab ??= (await browser.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  const latest = await db.datasets.orderBy('lastUsedAt').last();
  const info = { frameId: await pointerFrame(tab), pageUrl: tab?.url, menuItemId: ADD_COMMAND, editable: false } as ClickInfo;
  await addFromContextMenu('image', latest?.id ?? 'new', info, tab, 'shortcut');
}

/** The frame the pointer last moved in; the top page when none can say. */
async function pointerFrame(tab: Tab): Promise<number> {
  if (tab?.id === undefined) return 0;
  try {
    const frames = await browser.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: () => (globalThis as FinderGlobal).__latentnestHover?.at ?? 0,
    });
    const latest = frames.reduce((a, b) => (Number(b.result) > Number(a.result) ? b : a));
    return Number(latest.result) > 0 ? latest.frameId : 0;
  } catch {
    return 0;
  }
}

async function addFromContextMenu(kind: MenuKind, target: string | 'new', info: ClickInfo, tab: Tab, via: Via = 'menu') {
  const failTitle = kind === 'frame' ? 'Couldn’t grab frame' : 'Couldn’t save image';

  // Grab before asking for a name so a failure doesn't leave an empty dataset behind.
  let grabbed: Grabbed;
  try {
    grabbed = kind === 'frame' ? await grabFrame(info, tab) : await grabImage(info, tab, via);
  } catch (err) {
    return notify(tab, failTitle, message(err), 'error');
  }

  let dataset: Dataset | undefined;
  const newDataset = target === 'new';
  if (newDataset) {
    const name = await askForName(tab);
    if (name === null) return;
    dataset = await createDataset(name);
  } else {
    dataset = await db.datasets.get(target);
    if (!dataset) {
      void rebuildMenus();
      return notify(tab, 'Dataset not found', 'It may have been deleted. The menu has been refreshed.', 'error');
    }
  }

  try {
    const result = await addImage(dataset.id, grabbed.blob, {
      name: grabbed.name,
      sourceUrl: grabbed.sourceUrl,
      pageUrl: info.pageUrl ?? tab?.url,
      frameTime: grabbed.frameTime,
    });
    const count = await db.images.where('datasetId').equals(dataset.id).count();
    let detail = `${count} image${count === 1 ? '' : 's'} in dataset`;
    if (grabbed.fromScreen && result.status === 'added') detail += ' · captured from the screen at display size';
    const added = grabbed.frameTime !== undefined ? `Frame added to ${dataset.name}` : `Added to ${dataset.name}`;
    if (result.status === 'added') {
      const undo: UndoAdd = { type: 'add:undo', imageId: result.image.id, datasetId: dataset.id, newDataset, lastUsedAt: dataset.lastUsedAt };
      await notify(tab, added, detail, 'ok', undo);
    } else {
      await notify(tab, `Already in ${dataset.name}`, detail, 'ok');
    }
    void rebuildMenus();
  } catch (err) {
    await notify(tab, failTitle, message(err), 'error');
  }
}

/**
 * The image under the right-click at the largest size available: a site's
 * known original (X), else the page's largest srcset size, else the one on
 * screen. A video there gives its current frame.
 */
async function grabImage(info: ClickInfo, tab: Tab, via: Via): Promise<Grabbed> {
  const found = await findInPage(info, tab, via);
  if (found?.kind === 'video') return grabFrame({ ...info, srcUrl: found.src }, tab);
  const shown = found?.kind === 'image' ? found.urls : info.srcUrl ? [info.srcUrl] : [];
  const urls = [...new Set(shown.flatMap(fullSizeUrls))];
  if (!urls.length) throw new Error(await nothingFound(found, via));
  let failure: unknown;
  for (const url of urls) {
    try {
      return { blob: await downloadImage(url, tab, info.frameId), name: nameFromUrl(url), sourceUrl: /^https?:/.test(url) ? url : undefined };
    } catch (err) {
      failure = err;
    }
  }
  throw failure;
}

const formatTime = (s: number) =>
  `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

async function grabFrame(info: ClickInfo, tab: Tab): Promise<Grabbed> {
  if (tab?.id === undefined) throw new Error('Frames can only be grabbed from web pages.');
  const frameId = info.frameId ?? 0;
  let capture;
  try {
    [capture] = await browser.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [frameId] },
      func: captureVideoFrame,
      args: [info.srcUrl ?? ''],
    });
  } catch {
    throw new Error(
      (await hasSiteAccess()) ? 'LatentNest can’t access this page.' : 'Allow website access in the LatentNest side panel, then try again.',
    );
  }
  const result = capture?.result;
  if (!result) throw new Error('Couldn’t find the video on this page.');
  if ('error' in result) throw new Error(result.error);

  const base = {
    name: `frame ${formatTime(result.time)}`,
    sourceUrl: info.srcUrl && /^https?:/.test(info.srcUrl) ? info.srcUrl : undefined,
    frameTime: result.time,
  };
  if (result.ok) return { ...base, blob: await (await fetch(result.dataUrl)).blob() };

  // The site doesn't let pages read this video's pixels. A screenshot of the
  // visible tab still works, cropped to the picture. Screenshot coordinates
  // are only known for the top frame.
  if (frameId !== 0) throw new Error('This embedded video is protected by the site and can’t be captured.');
  return { ...base, blob: await screenshotRegion(tab, result.rect, result.viewportWidth), fromScreen: true };
}

async function screenshotRegion(
  tab: Browser.tabs.Tab,
  rect: { x: number; y: number; width: number; height: number },
  viewportWidth: number,
): Promise<Blob> {
  let shot: string;
  try {
    shot = await browser.tabs.captureVisibleTab(tab.windowId!, { format: 'png' });
  } catch {
    throw new Error('This site blocks reading its video, and a screenshot wasn’t allowed either.');
  }
  const bitmap = await createImageBitmap(await (await fetch(shot)).blob());
  try {
    // Screenshot pixels per CSS pixel (covers device pixel ratio and page zoom).
    const scale = bitmap.width / viewportWidth;
    const sx = Math.round(rect.x * scale);
    const sy = Math.round(rect.y * scale);
    const sw = Math.min(bitmap.width - sx, Math.round(rect.width * scale));
    const sh = Math.min(bitmap.height - sy, Math.round(rect.height * scale));
    const canvas = new OffscreenCanvas(sw, sh);
    canvas.getContext('2d')!.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
    return await canvas.convertToBlob({ type: 'image/png' });
  } finally {
    bitmap.close();
  }
}

async function downloadImage(url: string, tab: Tab, frameId?: number): Promise<Blob> {
  // 1. From the extension: works for data: URLs and any host we have access to.
  //    Without access, only CORS-enabled hosts work, and a wildcard
  //    Access-Control-Allow-Origin rejects requests carrying cookies, hence the retry.
  if (/^(https?|data):/.test(url)) {
    for (const credentials of ['include', 'omit'] as const) {
      try {
        const res = await fetch(url, { credentials, cache: 'force-cache' });
        if (res.ok) {
          const blob = await res.blob();
          if (await sniffMime(blob)) return blob;
        }
      } catch {
        /* CORS without host access, network error */
      }
    }
  }
  // 2. From inside the page: same-origin and blob: URLs, or the rendered <img>.
  if (tab?.id !== undefined) {
    try {
      const [injection] = await browser.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [frameId ?? 0] },
        func: grabImageInPage,
        args: [url],
      });
      if (injection?.result) {
        const blob = await (await fetch(injection.result)).blob();
        if (await sniffMime(blob)) return blob;
      }
    } catch {
      /* restricted page or frame */
    }
  }
  throw new Error(
    (await hasSiteAccess())
      ? 'The website blocked the download.'
      : 'Open the LatentNest side panel and allow website access, then try again.',
  );
}

async function askForName(tab: Tab): Promise<string | null> {
  const suggested = `Dataset ${(await db.datasets.count()) + 1}`;
  if (tab?.id === undefined) return suggested;
  try {
    const [injection] = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: promptDatasetName,
      args: [suggested],
    });
    return injection?.result ?? null;
  } catch {
    return suggested; // can't show UI on this page; go with the default
  }
}

/** Takes back an add from the page toast: the image, and a dataset made just for it. */
async function undoAdd({ imageId, datasetId, newDataset, lastUsedAt }: UndoAdd, tab: Tab) {
  const [image, dataset] = await Promise.all([db.images.get(imageId), db.datasets.get(datasetId)]);
  if (!image || !dataset || image.datasetId !== datasetId || Date.now() - image.addedAt > UNDO_WINDOW_MS) {
    return notify(tab, 'Nothing to undo', 'The image was already moved or removed.', 'error');
  }
  await deleteImage(imageId);
  const left = await db.images.where('datasetId').equals(datasetId).count();
  if (newDataset && !left) {
    await deleteDataset(datasetId);
    await notify(tab, 'Undone', `Removed the image and the new dataset “${dataset.name}”.`, 'ok');
  } else {
    await db.datasets.update(datasetId, { lastUsedAt });
    await notify(tab, `Removed from ${dataset.name}`, `${left} image${left === 1 ? '' : 's'} in dataset`, 'ok');
  }
  void rebuildMenus();
}

async function notify(tab: Tab, title: string, detail: string, kind: 'ok' | 'error', undo?: UndoAdd) {
  if (tab?.id !== undefined) {
    try {
      await browser.scripting.executeScript({ target: { tabId: tab.id }, func: showToast, args: [title, detail, kind, toastMark, undo ?? null] });
      return;
    } catch {
      /* fall back to the badge */
    }
  }
  const tabId = tab?.id;
  await browser.action.setBadgeBackgroundColor({ color: kind === 'ok' ? '#f29f2e' : '#d9534f', tabId });
  await browser.action.setBadgeText({ text: kind === 'ok' ? '✓' : '!', tabId });
  // null (not '') hands the tab back to the global badge, e.g. batch progress.
  setTimeout(() => void browser.action.setBadgeText({ text: null as unknown as undefined, tabId }), 2500);
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
