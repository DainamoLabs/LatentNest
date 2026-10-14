// Finds the picture under a right-click, from inside the page. Many sites
// (Instagram, Flickr, Pinterest…) lay a transparent element over their photos,
// so the browser doesn't see an image there and the click carries no address.
// Bundled into the injected finder script, so it may only use the DOM.

export interface Pointer {
  x: number;
  y: number;
  at: number;
}

export type Found =
  | { kind: 'image'; urls: string[] }
  | { kind: 'video'; src: string }
  /** no-pointer: the page script wasn't there to see the right-click. */
  | { kind: 'none'; reason: 'no-pointer' | 'nothing-here' };

export interface FindRequest {
  /** The image the browser itself saw, if any. */
  srcUrl?: string;
  linkUrl?: string;
  /** Where to look: the last right-click (default), or wherever the pointer is now (keyboard shortcut). */
  pointer?: 'menu' | 'hover';
}

/** Set by the finder script in the page (extension world only). */
export interface FinderGlobal {
  /** The last right-click. */
  __latentnestPointer?: Pointer;
  /** The last pointer movement. */
  __latentnestHover?: Pointer;
  __latentnestPointerHook?: boolean;
  __latentnestHoverHook?: boolean;
  __latentnestFind?: (request: FindRequest) => Found;
}

/** Ignore icons, avatars and tracking pixels. */
const MIN_SIDE = 24;
/** A right-click older than this is stale (the menu was long closed). */
const MAX_AGE = 120_000;
const DECODABLE = /^image\/(jpeg|jpg|png|webp|avif|gif|bmp)$/i;

/** Candidates in a srcset, as written. Descriptors: "640w", "2x" or none (1x). */
export function parseSrcset(srcset: string): { url: string; w?: number; x?: number }[] {
  const out: { url: string; w?: number; x?: number }[] = [];
  let i = 0;
  while (i < srcset.length) {
    while (i < srcset.length && /[\s,]/.test(srcset[i]!)) i++;
    if (i >= srcset.length) break;
    // The URL runs to the next whitespace; a trailing comma ends it with no descriptor.
    let end = i;
    while (end < srcset.length && !/\s/.test(srcset[end]!)) end++;
    let url = srcset.slice(i, end);
    let descriptor = '';
    if (url.endsWith(',')) {
      url = url.replace(/,+$/, '');
      i = end;
    } else {
      const comma = srcset.indexOf(',', end);
      const stop = comma < 0 ? srcset.length : comma;
      descriptor = srcset.slice(end, stop).trim();
      i = stop + 1;
    }
    const m = /^(\d+(?:\.\d+)?)([wx])$/i.exec(descriptor);
    if (!url) continue;
    if (!m) out.push(descriptor ? { url } : { url, x: 1 });
    else out.push(m[2]!.toLowerCase() === 'w' ? { url, w: Number(m[1]) } : { url, x: Number(m[1]) });
  }
  return out;
}

/** The URL in a computed background-image, e.g. `url("a.jpg")`; gradients give null. */
export function cssUrl(value: string): string | null {
  const m = /url\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^)"'\s]+))\s*\)/.exec(value);
  const raw = m?.[1] ?? m?.[2] ?? m?.[3];
  return raw ? raw.replace(/\\(.)/g, '$1') : null;
}

const absolute = (url: string) => {
  try {
    return new URL(url, document.baseURI).href;
  } catch {
    return null;
  }
};

/**
 * The image's own srcset and same-picture <source>s (not media-query ones,
 * which can be a different crop), largest first, then what's on screen.
 */
export function imageUrls(img: HTMLImageElement): string[] {
  const sets = [img.getAttribute('srcset') ?? ''];
  const picture = img.parentElement?.localName === 'picture' ? img.parentElement : null;
  picture?.querySelectorAll('source').forEach((s) => {
    if (s.media || (s.type && !DECODABLE.test(s.type))) return;
    sets.push(s.getAttribute('srcset') ?? '');
  });
  const candidates = sets.flatMap(parseSrcset);
  // Width and density descriptors can't be compared, so widths win when present.
  const widths = candidates.filter((c) => c.w);
  const best = widths.length
    ? widths.sort((a, b) => b.w! - a.w!)[0]
    : candidates.filter((c) => c.x).sort((a, b) => b.x! - a.x!)[0];
  const urls = [best && absolute(best.url), img.currentSrc || img.src].filter((u): u is string => !!u);
  return [...new Set(urls)];
}

/** Every element at the point, top first, including inside open shadow roots. */
function elementsAt(x: number, y: number): Element[] {
  const out: Element[] = [];
  const seen = new Set<Element>();
  const visit = (root: Document | ShadowRoot) => {
    for (const el of root.elementsFromPoint(x, y)) {
      if (seen.has(el)) continue;
      seen.add(el);
      // A shadow root's contents sit above its host.
      if (el.shadowRoot) visit(el.shadowRoot);
      out.push(el);
    }
  };
  visit(document);
  return out;
}

const bigEnough = (el: Element) => {
  const r = el.getBoundingClientRect();
  return r.width >= MIN_SIDE && r.height >= MIN_SIDE;
};

function mediaOf(el: Element): Found | null {
  if (!bigEnough(el)) return null;
  if (el.localName === 'img') {
    const urls = imageUrls(el as HTMLImageElement);
    return urls.length ? { kind: 'image', urls } : null;
  }
  if (el.localName === 'video') {
    const video = el as HTMLVideoElement;
    if (video.readyState >= 2 && video.videoWidth) return { kind: 'video', src: video.currentSrc || video.src };
    const poster = video.poster && absolute(video.poster);
    return poster ? { kind: 'image', urls: [poster] } : null;
  }
  const bg = cssUrl(getComputedStyle(el).backgroundImage);
  const url = bg && absolute(bg);
  return url ? { kind: 'image', urls: [url] } : null;
}

const area = (el: Element) => {
  const r = el.getBoundingClientRect();
  return r.width * r.height;
};

const isPageRoot = (el: Element) => el === document.body || el === document.documentElement;

/**
 * Pictures with `pointer-events: none` (TikTok's, and sites that block
 * dragging) don't show up in hit testing, so look inside the elements at the
 * point for any that cover it. A playing video wins, then a visible image.
 */
function untouchableMediaAt(stack: Element[], x: number, y: number): Found | null {
  const seen = new Set<Element>();
  const hits: Element[] = [];
  for (const el of stack) {
    // Down to <body>, whose own background doesn't count but whose pictures do.
    if (el === document.documentElement) break;
    for (const m of el.querySelectorAll('img, video')) {
      if (seen.has(m)) continue;
      seen.add(m);
      const r = m.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom && getComputedStyle(m).visibility !== 'hidden') hits.push(m);
    }
  }
  const video = hits.find((m) => m.localName === 'video' && (m as HTMLVideoElement).readyState >= 2);
  const visible = hits.find((m) => m.localName === 'img' && Number(getComputedStyle(m).opacity) > 0);
  for (const m of [video, visible, ...hits]) {
    const found = m && mediaOf(m);
    if (found) return found;
  }
  return null;
}

export function findMedia({ srcUrl, linkUrl, pointer: from = 'menu' }: FindRequest, pointer: Pointer | undefined): Found {
  // The pointer stays put while nothing moves it; a right-click goes stale.
  const fresh = pointer && (from === 'hover' || Date.now() - pointer.at < MAX_AGE) ? pointer : undefined;
  const stack = fresh ? elementsAt(fresh.x, fresh.y) : [];

  // The browser saw an image: offer its largest size.
  if (srcUrl) {
    const shows = (el: Element): el is HTMLImageElement =>
      el.localName === 'img' && ((el as HTMLImageElement).currentSrc === srcUrl || (el as HTMLImageElement).src === srcUrl);
    const img = stack.find(shows) ?? Array.from(document.images).find(shows);
    return { kind: 'image', urls: img ? [...new Set([...imageUrls(img), srcUrl])] : [srcUrl] };
  }

  // Whatever is under the pointer, top first. The page background doesn't count.
  for (const el of stack) {
    if (isPageRoot(el)) break;
    const found = mediaOf(el);
    if (found) return found;
  }
  const hidden = fresh && untouchableMediaAt(stack, fresh.x, fresh.y);
  if (hidden) return hidden;

  // A link around a picture, e.g. a grid of thumbnails.
  if (linkUrl) {
    const imgs = Array.from(document.querySelectorAll('a'))
      .filter((a) => a.href === linkUrl)
      .flatMap((a) => Array.from(a.querySelectorAll('img')))
      .filter(bigEnough)
      .sort((a, b) => area(b) - area(a));
    if (imgs[0]) return { kind: 'image', urls: imageUrls(imgs[0]) };
  }
  return { kind: 'none', reason: fresh ? 'nothing-here' : 'no-pointer' };
}
