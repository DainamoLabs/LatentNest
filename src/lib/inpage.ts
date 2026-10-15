// Functions injected into web pages with scripting.executeScript. They are
// serialized with Function.toString(), so each must be fully self-contained:
// no imports, no references to anything outside its own body.

/**
 * Brief confirmation in the corner of the page. `iconDataUrl` is a PNG data
 * URL; it's decoded onto a canvas because strict page CSPs block data: images.
 * With `undo`, an Undo button sends that message to the extension; the toast
 * then stays until the extension shows the next one (or hovering ends).
 */
export function showToast(title: string, detail: string, kind: 'ok' | 'error', iconDataUrl: string, undo?: object | null) {
  const ID = 'latentnest-toast';
  document.getElementById(ID)?.remove();
  const host = document.createElement('div');
  host.id = ID;
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;right:20px;bottom:20px;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>
    .t{display:flex;align-items:center;gap:10px;max-width:360px;padding:10px 16px 10px 10px;
      font:13px/1.35 system-ui,-apple-system,"Segoe UI",Ubuntu,sans-serif;color:#9aa1ad;
      background:#1b1e24;border:1px solid #353a43;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.45);
      animation:in .18s ease-out;transition:opacity .25s,transform .25s}
    .t.out{opacity:0;transform:translateY(6px)}
    .i{flex:none;width:30px;height:30px;border-radius:8px;background:#22262e;display:grid;place-items:center}
    .i canvas{width:24px;height:24px}
    .b{color:#eef0f3;font-weight:600}
    .error .b{color:#ff8a80}
    .u{flex:none;margin-left:6px;padding:6px 11px;border-radius:8px;border:1px solid #3a3f48;background:transparent;
      color:#f29f2e;font:600 13px/1 system-ui,-apple-system,"Segoe UI",Ubuntu,sans-serif;cursor:pointer}
    .u:hover{background:#22262e}
    .u:disabled{color:#9aa1ad;cursor:default}
    @keyframes in{from{opacity:0;transform:translateY(8px)}}
  </style>
  <div class="t"><div class="i"><canvas width="48" height="48"></canvas></div>
  <div><div class="b"></div><div class="d"></div></div></div>`;
  root.querySelector('.t')!.classList.add(kind);
  root.querySelector('.b')!.textContent = title;
  root.querySelector('.d')!.textContent = detail;
  const bytes = Uint8Array.from(atob(iconDataUrl.slice(iconDataUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0));
  createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    .then((bitmap) => root.querySelector('canvas')!.getContext('2d')!.drawImage(bitmap, 0, 0, 48, 48))
    .catch(() => {});
  document.documentElement.append(host);
  const toast = root.querySelector('.t')!;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const closeIn = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      toast.classList.add('out');
      setTimeout(() => host.remove(), 300);
    }, ms);
  };
  closeIn(kind === 'error' ? 5000 : undo ? 6000 : 2600);
  if (!undo) return;

  const button = document.createElement('button');
  button.className = 'u';
  button.textContent = 'Undo';
  toast.append(button);
  // Stays while the pointer is on it, so there's time to reach the button.
  toast.addEventListener('mouseenter', () => clearTimeout(timer));
  toast.addEventListener('mouseleave', () => closeIn(2500));
  button.addEventListener('click', (e) => {
    // Only a real click: the page can't script into this closed shadow root, but be sure.
    if (!e.isTrusted || button.disabled) return;
    button.disabled = true;
    button.textContent = 'Undoing…';
    clearTimeout(timer);
    // The extension answers with a new toast; this one only reports a lost connection.
    type Api = { runtime: { sendMessage(message: unknown): Promise<unknown> } };
    const g = globalThis as unknown as { browser?: Api; chrome?: Api };
    // After an extension reload, sending throws instead of rejecting.
    new Promise((resolve) => resolve((g.browser ?? g.chrome)!.runtime.sendMessage(undo))).catch(() => {
      root.querySelector('.t')!.classList.add('error');
      root.querySelector('.b')!.textContent = 'Couldn’t undo';
      root.querySelector('.d')!.textContent = 'LatentNest was reloaded. Remove the image from the side panel instead.';
      button.remove();
      closeIn(5000);
    });
  });
}

/** Small in-page dialog asking for a dataset name. Resolves to null on cancel. */
export function promptDatasetName(defaultName: string): Promise<string | null> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>
      .s{position:fixed;inset:0;background:rgba(10,11,14,.55);display:grid;place-items:center;
        font:14px/1.4 system-ui,-apple-system,"Segoe UI",Ubuntu,sans-serif}
      form{width:min(360px,calc(100vw - 32px));background:#1b1e24;border:1px solid #353a43;border-radius:14px;
        padding:18px;box-shadow:0 20px 60px rgba(0,0,0,.5);color:#eef0f3}
      h2{margin:0 0 12px;font-size:15px;font-weight:600}
      input{box-sizing:border-box;width:100%;padding:9px 11px;border-radius:8px;border:1px solid #3a3f48;
        background:#14161b;color:#eef0f3;font:inherit;outline:none}
      input:focus{border-color:#f29f2e;box-shadow:0 0 0 3px rgba(242,159,46,.2)}
      .r{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}
      button{font:inherit;font-weight:500;border-radius:8px;padding:7px 14px;cursor:pointer;border:1px solid transparent}
      .c{background:transparent;color:#9aa1ad;border-color:#3a3f48}
      .k{background:#f29f2e;color:#14161b}
    </style>
    <div class="s"><form><h2>New dataset</h2><input maxlength="80" aria-label="Dataset name">
    <div class="r"><button type="button" class="c">Cancel</button><button class="k">Create &amp; add</button></div></form></div>`;
    const input = root.querySelector('input')!;
    const form = root.querySelector('form')!;
    input.value = defaultName;
    const done = (value: string | null) => {
      host.remove();
      resolve(value);
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      done(input.value.trim() || defaultName);
    });
    root.querySelector('.c')!.addEventListener('click', () => done(null));
    root.querySelector('.s')!.addEventListener('mousedown', (e) => {
      if (e.target === e.currentTarget) done(null);
    });
    // Keep the page's own shortcuts from firing while typing.
    host.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') done(null);
    });
    document.documentElement.append(host);
    input.focus();
    input.select();
  });
}

/**
 * Fallback when the background can't download an image: fetch it from the
 * page itself (works for same-origin and blob: URLs), then try reading the
 * already-rendered <img> through a canvas.
 */
export async function grabImageInPage(url: string): Promise<string | null> {
  const toDataUrl = (blob: Blob) =>
    new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  try {
    // Default credentials: cookies for same-origin images, and cross-origin
    // ones still pass a wildcard CORS policy.
    const res = await fetch(url);
    if (res.ok) {
      const blob = await res.blob();
      if (blob.size > 0 && !blob.type.startsWith('text/')) return await toDataUrl(blob);
    }
  } catch {
    /* fall through to canvas */
  }
  const img = Array.from(document.images).find((i) => i.currentSrc === url || i.src === url);
  if (!img || !img.naturalWidth) return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d')!.drawImage(img, 0, 0);
    return canvas.toDataURL('image/png'); // throws if the canvas is cross-origin tainted
  } catch {
    return null;
  }
}

export type FrameCapture =
  | { ok: true; dataUrl: string; time: number }
  /** The page may not read the video's pixels; the caller can screenshot `rect` instead. */
  | { ok: false; time: number; rect: { x: number; y: number; width: number; height: number }; viewportWidth: number }
  | { error: string };

/**
 * Grab the current frame of the right-clicked video at its native resolution.
 * Falls back to the largest loaded video when the clicked one can't be matched
 * (custom players often swap sources or nest the element in a shadow root).
 */
export function captureVideoFrame(srcUrl: string): FrameCapture {
  const videos: HTMLVideoElement[] = [];
  const walk = (root: Document | ShadowRoot) => {
    root.querySelectorAll('video').forEach((v) => videos.push(v));
    root.querySelectorAll('*').forEach((el) => el.shadowRoot && walk(el.shadowRoot));
  };
  walk(document);
  const area = (v: HTMLVideoElement) => {
    const r = v.getBoundingClientRect();
    return r.width * r.height;
  };
  const video =
    (srcUrl && videos.find((v) => v.currentSrc === srcUrl || v.src === srcUrl)) ||
    videos.filter((v) => v.readyState >= 2).sort((a, b) => area(b) - area(a))[0];

  if (!video) return { error: 'Couldn’t find the video on this page.' };
  if (video.readyState < 2 || !video.videoWidth) {
    return { error: 'The video hasn’t loaded a frame yet. Play it for a moment, then try again.' };
  }
  const time = video.currentTime;
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(video, 0, 0);

  let dataUrl: string;
  try {
    // DRM-protected video draws as solid black rather than throwing.
    const probe = document.createElement('canvas');
    probe.width = probe.height = 16;
    probe.getContext('2d')!.drawImage(canvas, 0, 0, 16, 16);
    const px = probe.getContext('2d')!.getImageData(0, 0, 16, 16).data;
    let max = 0;
    for (let i = 0; i < px.length; i += 4) max = Math.max(max, px[i]!, px[i + 1]!, px[i + 2]!);
    if (max < 4) {
      return { error: 'The frame came out blank. The video may be DRM-protected, or it’s on a black frame.' };
    }
    dataUrl = canvas.toDataURL('image/png');
  } catch {
    // Cross-origin video without CORS: report where the picture is on screen.
    // Videos default to object-fit: contain, so skip any letterbox bars.
    document.getElementById('latentnest-toast')?.remove();
    const r = video.getBoundingClientRect();
    let { x, y, width, height } = r;
    const fit = getComputedStyle(video).objectFit;
    if (fit !== 'fill' && fit !== 'cover') {
      const s = Math.min(width / video.videoWidth, height / video.videoHeight);
      x += (width - video.videoWidth * s) / 2;
      y += (height - video.videoHeight * s) / 2;
      width = video.videoWidth * s;
      height = video.videoHeight * s;
    }
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(innerWidth, x + width);
    const y1 = Math.min(innerHeight, y + height);
    if (x1 - x0 < 8 || y1 - y0 < 8) return { error: 'Scroll the video into view, then try again.' };
    return { ok: false, time, rect: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, viewportWidth: innerWidth };
  }
  return { ok: true, dataUrl, time };
}
