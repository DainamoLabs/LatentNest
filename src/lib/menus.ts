import { browser, type Browser } from 'wxt/browser';
import { db } from './db';

/** The keyboard shortcut that adds what's under the pointer (declared in wxt.config.ts). */
export const ADD_COMMAND = 'add-under-pointer';

/** "image" saves the clicked image; "frame" grabs the current frame of a video. */
export type MenuKind = 'image' | 'frame';

type Context = 'image' | 'video' | 'page' | 'link' | 'frame';

// "Add to Dataset" also shows where the browser sees no image, since many
// sites cover their photos with an overlay; the page finder looks underneath.
const ROOTS: { kind: MenuKind; title: string; contexts: [Context, ...Context[]] }[] = [
  { kind: 'image', title: 'Add to Dataset', contexts: ['image', 'page', 'link', 'frame'] },
  { kind: 'frame', title: 'Add Frame to Dataset', contexts: ['video'] },
];

export type MenuAction =
  | { kind: MenuKind; action: 'dataset'; datasetId: string }
  | { kind: MenuKind; action: 'new' }
  | { kind: MenuKind; action: 'more' };

// Ids look like "ln-image-new" or "ln-frame-ds:<dataset id>".
export function parseMenuId(id: string): MenuAction | null {
  const m = /^ln-(image|frame)-(new|more|ds:(.+))$/.exec(id);
  if (!m) return null;
  const kind = m[1] as MenuKind;
  if (m[3]) return { kind, action: 'dataset', datasetId: m[3] };
  return { kind, action: m[2] as 'new' | 'more' };
}

const MAX_DATASETS = 12;
// Keep the items off extension pages (including our own side panel).
const DOCUMENTS = ['http://*/*', 'https://*/*', 'file:///*'];

function create(props: Browser.contextMenus.CreateProperties) {
  return new Promise<void>((resolve) =>
    browser.contextMenus.create(props, () => {
      void browser.runtime.lastError; // e.g. duplicate id during a racing rebuild
      resolve();
    }),
  );
}

// Firefox treats "&" as an access-key marker.
const label = (name: string) => (import.meta.env.FIREFOX ? name.replaceAll('&', '&&') : name);

async function build() {
  await browser.contextMenus.removeAll();
  const datasets = await db.datasets.orderBy('lastUsedAt').reverse().limit(MAX_DATASETS + 1).toArray();
  for (const { kind, title, contexts } of ROOTS) {
    const root = `ln-${kind}`;
    await create({ id: root, title, contexts, documentUrlPatterns: DOCUMENTS });
    for (const d of datasets.slice(0, MAX_DATASETS)) {
      await create({ id: `${root}-ds:${d.id}`, parentId: root, title: label(d.name), contexts });
    }
    if (datasets.length > MAX_DATASETS) {
      await create({ id: `${root}-more`, parentId: root, title: 'More datasets…', contexts });
    }
    if (datasets.length) {
      await create({ id: `${root}-sep`, parentId: root, type: 'separator', contexts });
    }
    await create({ id: `${root}-new`, parentId: root, title: 'New dataset…', contexts });
  }
}

let queue: Promise<void> = Promise.resolve();
/** Rebuilds are serialized so overlapping calls can't interleave removeAll/create. */
export function rebuildMenus(): Promise<void> {
  queue = queue.then(build).catch((err) => console.error('LatentNest: menu rebuild failed', err));
  return queue;
}
