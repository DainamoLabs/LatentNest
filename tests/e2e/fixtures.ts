// Playwright fixtures: Chromium with the e2e build of LatentNest loaded, a
// local site with test images, and a fake OpenAI-compatible caption server.
// Both servers listen on 127.0.0.1, which the extension can reach without
// asking (its loopback host permission).
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import sharp from 'sharp';
import type { browser } from 'wxt/browser';

/** The extension API, inside `evaluate` callbacks that run in the service worker. */
declare const chrome: typeof browser;

const EXTENSION_PATH = fileURLToPath(new URL('../../.output/chrome-mv3-e2e', import.meta.url));

export const CAPTION = 'a test caption from the fake server';

/** Distinct images (duplicates are skipped within a dataset). */
async function makeImages() {
  const solid = (r: number, g: number, b: number) =>
    sharp({ create: { width: 640, height: 480, channels: 3, background: { r, g, b } } });
  return {
    'red.png': { type: 'image/png', body: await solid(200, 40, 40).png().toBuffer() },
    'green.jpg': { type: 'image/jpeg', body: await solid(40, 160, 60).jpeg().toBuffer() },
    'blue.png': { type: 'image/png', body: await solid(40, 60, 200).png().toBuffer() },
  };
}
export type ImageName = keyof Awaited<ReturnType<typeof makeImages>>;

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
const close = (server: Server) =>
  new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });

export interface Site {
  origin: string;
  /** A page showing every test image. */
  pageUrl: string;
  imageUrl: (name: ImageName) => string;
}

export interface CaptionServer {
  baseUrl: string;
  /** Milliseconds each caption takes. */
  delayMs: number;
  /** Chat completion requests received so far. */
  requests: number;
}

/** The extension's background service worker, which a reload replaces. */
export async function serviceWorker(context: BrowserContext): Promise<Worker> {
  const live = context.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://'));
  return live ?? context.waitForEvent('serviceworker', { predicate: (w) => w.url().startsWith('chrome-extension://') });
}

interface Fixtures {
  site: Site;
  captionServer: CaptionServer;
  context: BrowserContext;
  extensionId: string;
  /** chrome-extension://<id>/<path> */
  extUrl: (path: string) => string;
}

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern -- Playwright needs the destructuring
  site: async ({}, use) => {
    const images = await makeImages();
    const server = createServer((req, res) => {
      const name = req.url?.slice(1) as ImageName;
      if (images[name]) {
        res.writeHead(200, { 'Content-Type': images[name].type }).end(images[name].body);
      } else if (req.url === '/') {
        const tags = Object.keys(images).map((n) => `<img src="/${n}" alt="${n}" width="320">`);
        res.writeHead(200, { 'Content-Type': 'text/html' }).end(`<!doctype html><title>Test images</title>${tags.join('')}`);
      } else {
        res.writeHead(404).end();
      }
    });
    const origin = await listen(server);
    await use({ origin, pageUrl: `${origin}/`, imageUrl: (name) => `${origin}/${name}` });
    await close(server);
  },

  // eslint-disable-next-line no-empty-pattern
  captionServer: async ({}, use) => {
    const state: CaptionServer = { baseUrl: '', delayMs: 0, requests: 0 };
    const reply = (res: ServerResponse, status: number, body?: unknown) =>
      res
        .writeHead(status, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
        })
        .end(body === undefined ? undefined : JSON.stringify(body));
    const server = createServer((req: IncomingMessage, res) => {
      if (req.method === 'OPTIONS') return reply(res, 204);
      if (req.url === '/v1/models') return reply(res, 200, { object: 'list', data: [{ id: 'test-model', object: 'model' }] });
      if (req.method === 'POST' && req.url === '/v1/chat/completions') {
        req.resume();
        req.on('end', () => {
          state.requests++;
          setTimeout(
            () => reply(res, 200, { choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: CAPTION } }] }),
            state.delayMs,
          );
        });
        return;
      }
      reply(res, 404, { error: 'not found' });
    });
    state.baseUrl = await listen(server);
    await use(state);
    await close(server);
  },

  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    // Without developer mode, chrome.runtime.reload() unloads an unpacked
    // extension for good instead of reloading it.
    const profile = await mkdtemp(path.join(tmpdir(), 'latentnest-e2e-'));
    await mkdir(path.join(profile, 'Default'));
    await writeFile(path.join(profile, 'Default', 'Preferences'), JSON.stringify({ extensions: { ui: { developer_mode: true } } }));
    const context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: !process.env.HEADED,
      args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
    });
    await use(context);
    await context.close();
    await rm(profile, { recursive: true, force: true });
  },

  extensionId: async ({ context }, use) => {
    await use(new URL((await serviceWorker(context)).url()).host);
  },

  extUrl: async ({ extensionId }, use) => {
    await use((path) => `chrome-extension://${extensionId}/${path.replace(/^\//, '')}`);
  },
});

export const expect = test.expect;

// ------------------------------------------------------------- helpers

/** Points auto-captioning at the fake server, as saving Settings would. */
export async function useCaptionServer(context: BrowserContext, server: CaptionServer) {
  const sw = await serviceWorker(context);
  await sw.evaluate(async (baseUrl) => {
    await chrome.storage.local.set({
      backend: {
        preset: 'custom',
        baseUrl,
        apiKey: '',
        model: 'test-model',
        maxImageSide: 1024,
        temperature: 0.2,
        maxTokens: null,
        timeoutSec: 60,
        extraBody: '',
        v: 2,
      },
    });
  }, server.baseUrl);
}

/** What `wxt build --mode e2e` puts on the service worker's globalThis. */
interface E2EHook {
  addFromContextMenu(kind: 'image' | 'frame', target: string, info: object, tab: unknown): Promise<void>;
}

/**
 * Right-click → Add to Dataset on an image in `page`. Native context menus
 * can't be automated, so this calls the menu's handler (exposed by the e2e
 * build). With `datasetName`, it picks "New dataset…" and fills in the name.
 */
export async function addFromContextMenu(
  context: BrowserContext,
  page: Page,
  srcUrl: string,
  target: { datasetName: string } | { datasetId: string },
) {
  const sw = await serviceWorker(context);
  const added = sw.evaluate(
    async ({ srcUrl, pageUrl, datasetId }) => {
      const [tab] = await chrome.tabs.query({ url: pageUrl });
      const info = { menuItemId: 'e2e', editable: false, frameId: 0, srcUrl, pageUrl };
      const hook = (globalThis as unknown as { __latentnest: E2EHook }).__latentnest;
      await hook.addFromContextMenu('image', datasetId ?? 'new', info, tab);
    },
    { srcUrl, pageUrl: page.url(), datasetId: 'datasetId' in target ? target.datasetId : undefined },
  );
  if ('datasetName' in target) {
    // The name prompt sits in a closed shadow root, with its field focused.
    await page.waitForFunction(() => document.documentElement.lastElementChild?.tagName === 'DIV');
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type(target.datasetName);
    await page.keyboard.press('Enter');
  }
  await added;
}

/** Rows of an IndexedDB store, read from the extension's service worker. */
export async function readStore<T = Record<string, unknown>>(context: BrowserContext, store: string): Promise<T[]> {
  const sw = await serviceWorker(context);
  return sw.evaluate(
    (store) =>
      new Promise<T[]>((resolve, reject) => {
        const open = indexedDB.open('latentnest');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const idb = open.result;
          if (!idb.objectStoreNames.contains(store)) {
            idb.close();
            return resolve([]);
          }
          const req = idb.transaction(store).objectStore(store).getAll();
          req.onsuccess = () => {
            idb.close();
            resolve(req.result as T[]);
          };
          req.onerror = () => reject(req.error);
        };
      }),
    store,
  );
}

/** File names inside a ustar archive (the backup format). */
export function tarEntries(bytes: Buffer): string[] {
  const names: string[] = [];
  const field = (h: Buffer, offset: number, length: number) => {
    const raw = h.subarray(offset, offset + length);
    const end = raw.indexOf(0);
    return raw.subarray(0, end < 0 ? length : end).toString('utf8');
  };
  for (let at = 0; at + 512 <= bytes.length; ) {
    const header = bytes.subarray(at, at + 512);
    if (header.every((b) => b === 0)) break;
    const name = field(header, 0, 100);
    const prefix = field(header, 345, 155);
    const size = parseInt(field(header, 124, 12).trim() || '0', 8);
    names.push(prefix ? `${prefix}/${name}` : name);
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return names;
}
