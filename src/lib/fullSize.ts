// Some sites show a scaled copy of an image and keep the original at a
// predictable address. These rules turn the address on the page into
// candidates, largest first; each list ends with the address itself, so a
// rule that stops working only costs a failed request. Every rule was checked
// against the live site, and a wrong guess there is an error status (the
// download also refuses anything that isn't image bytes), never a different
// picture.

const TWIMG_PATH = /^(\/(?:media|ext_tw_video_thumb|amplify_video_thumb|tweet_video_thumb)\/[^.:]+)(?:\.(\w+))?(?::\w+)?$/;

/**
 * X/Twitter: pbs.twimg.com scales to `name=small|medium|large|4096x4096`, and
 * `name=orig` is the upload itself. Smaller sizes come in any format, but orig
 * only in the format it was uploaded in (others are a 404), and a WebP copy
 * doesn't say which that was. Old addresses look like `/media/ID.jpg:large`.
 */
function twitter(url: URL): string[] {
  if (url.hostname !== 'pbs.twimg.com') return [];
  const path = TWIMG_PATH.exec(url.pathname);
  if (!path) return [];
  const shown = (url.searchParams.get('format') ?? path[2] ?? '').toLowerCase().replace('jpeg', 'jpg');
  const formats = shown === 'jpg' || shown === 'png' ? [shown] : ['jpg', 'png'];
  const at = (format: string, name: string) => `https://pbs.twimg.com${path[1]}?format=${format}&name=${name}`;
  return [...formats.map((f) => at(f, 'orig')), at(formats[0]!, '4096x4096'), at(formats[0]!, 'large')];
}

/**
 * Pinterest: `/236x/`, `/736x/`, `/75x75_RS/`… are JPEG copies of
 * `/originals/`, which keeps the upload's format (mostly JPEG, then PNG,
 * WebP). `/1200x/` is a JPEG at most 1200px wide, for when none of those fit.
 */
function pinterest(url: URL): string[] {
  if (url.hostname !== 'i.pinimg.com') return [];
  const m = /^\/\d+x\d*(?:_RS)?\/([0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{32})\.(\w+)$/.exec(url.pathname);
  if (!m) return [];
  const formats = m[2]!.toLowerCase() === 'gif' ? ['gif', 'jpg', 'png', 'webp'] : ['jpg', 'png', 'webp', 'gif'];
  return [...formats.map((f) => `https://i.pinimg.com/originals/${m[1]}.${f}`), `https://i.pinimg.com/1200x/${m[1]}.jpg`];
}

/**
 * Reddit: preview.redd.it copies (often with a title slug: `…-v0-ID.jpeg`)
 * of i.redd.it/ID.ext. The extension must stay as written (.jpeg ≠ .jpg).
 */
function reddit(url: URL): string[] {
  if (url.hostname !== 'preview.redd.it') return [];
  const m = /^\/(?:.*-v0-)?([a-z0-9]+)\.(jpe?g|png|gif|webp)$/i.exec(url.pathname);
  return m ? [`https://i.redd.it/${m[1]}.${m[2]}`] : [];
}

/**
 * Wikimedia: `…/thumb/a/ab/File.jpg/960px-File.jpg` (on upload. or thumb.)
 * is a copy of `…/a/ab/File.jpg` on upload.wikimedia.org. Only for photos:
 * an SVG, PDF or TIFF original can't be used as is.
 */
function wikimedia(url: URL): string[] {
  if (url.hostname !== 'upload.wikimedia.org' && url.hostname !== 'thumb.wikimedia.org') return [];
  const m = /^(\/[^/]+\/[^/]+)\/thumb(\/(?:archive\/)?[0-9a-f]\/[0-9a-f]{2}\/[^/]+\.(?:jpe?g|png|gif|webp))\/[^/]+$/i.exec(url.pathname);
  return m ? [`https://upload.wikimedia.org${m[1]}${m[2]}`] : [];
}

/**
 * Bluesky: a post's thumbnail (`feed_thumbnail`, 1000px) and its full-size
 * copy are both re-encoded; the uploaded file itself comes from the account's
 * server (accounts hosted by Bluesky; others fail and fall through). Its
 * address names the content hash, so it can't be a different picture.
 */
function bluesky(url: URL): string[] {
  if (url.hostname !== 'cdn.bsky.app') return [];
  const m = /^\/img\/feed_thumbnail\/plain\/(did:[^/]+)\/([a-z0-9]+)(@\w+)?$/.exec(url.pathname);
  if (!m) return [];
  const blob = `https://bsky.social/xrpc/com.atproto.sync.getBlob?${new URLSearchParams({ did: decodeURIComponent(m[1]!), cid: m[2]! })}`;
  return [blob, `https://cdn.bsky.app/img/feed_fullsize/plain/${m[1]}/${m[2]}${m[3] ?? ''}`];
}

/** Mastodon (any server): `media_attachments/files/…/small/x.jpg` → `/original/`. */
function mastodon(url: URL): string[] {
  const m = /^(.*\/media_attachments\/files\/(?:\d+\/)+)small(\/[0-9a-f]+\.(?:jpe?g|png|webp|gif))$/.exec(url.pathname);
  return m ? [`${url.origin}${m[1]}original${m[2]}`] : [];
}

/**
 * Danbooru: previews and samples name the file's MD5, but not its format
 * (previews are JPEG or WebP whatever the original is).
 */
function danbooru(url: URL): string[] {
  if (url.hostname !== 'cdn.donmai.us') return [];
  const m = /^\/(sample|180x180|360x360|720x720)\/([0-9a-f]{2})\/([0-9a-f]{2})\/(?:sample-)?([0-9a-f]{32})\.\w+$/.exec(url.pathname);
  if (!m) return [];
  const dir = `${m[2]}/${m[3]}`;
  const originals = ['jpg', 'png', 'webp', 'gif', 'avif'].map((f) => `https://cdn.donmai.us/original/${dir}/${m[4]}.${f}`);
  // The 850px sample, for when the original is a video or archive.
  return m[1] === 'sample' ? originals : [...originals, `https://cdn.donmai.us/sample/${dir}/sample-${m[4]}.jpg`];
}

/**
 * ArtStation: an artwork comes in sizes up to `/8k/` (never upscaled; the
 * original isn't public). The square crops sit in a dated folder the other
 * sizes don't have.
 */
function artstation(url: URL): string[] {
  if (!/^cdn[a-z]?\.artstation\.com$/.test(url.hostname)) return [];
  const m = /^\/p\/assets\/images\/images\/(\d{3}\/\d{3}\/\d{3})\/(?:\d{14}\/)?(?:micro_square|smaller_square|small_square|small|medium|large|4k|8k)\/([^/]+)$/.exec(
    url.pathname,
  );
  if (!m) return [];
  return ['8k', '4k', 'large'].map((size) => `${url.origin}/p/assets/images/images/${m[1]}/${size}/${m[2]}`);
}

/**
 * Tumblr, older posts: `tumblr_ID_500.jpg` → `_1280` (the largest; never
 * upscaled). Newer addresses have a different hash per size, so no rule.
 */
function tumblr(url: URL): string[] {
  if (!/^\d+\.media\.tumblr\.com$/.test(url.hostname)) return [];
  const m = /^(\/(?:[0-9a-f]{32}\/)?tumblr_(?:inline_)?[A-Za-z0-9]+(?:_r\d+)?)_(?:\d+|75sq)\.(jpg|png|gif)$/.exec(url.pathname);
  return m ? [`${url.origin}${m[1]}_1280.${m[2]}`] : [];
}

const RULES = [twitter, pinterest, reddit, wikimedia, bluesky, mastodon, danbooru, artstation, tumblr];

/** Addresses to try for the full-size version of `url`, ending with `url`. */
export function fullSizeUrls(url: string): string[] {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [url];
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return [url];
  return [...new Set([...RULES.flatMap((rule) => rule(parsed)), url])];
}
