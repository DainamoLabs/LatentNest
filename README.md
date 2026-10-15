# LatentNest

A browser extension for building image datasets for LoRA / fine-tune training. Right-click any image on the web → **Add to Dataset**, then caption images by hand or with a local vision model (Ollama, llama.cpp, LM Studio, or any OpenAI-compatible server), and export a ZIP that kohya_ss, ai-toolkit, OneTrainer and other trainers can read directly.

Chrome (side panel) and Firefox (sidebar) from one codebase. By Dainamo Labs.

## Development

Needs Node 22 or newer.

```sh
npm install
npm run dev            # Chrome, with hot reload
npm run dev:firefox    # Firefox
npm run build          # → .output/chrome-mv3
npm run build:firefox  # → .output/firefox-mv3
npm run zip            # store-ready ZIPs (zip:firefox for AMO, plus the sources ZIP it asks for)
npm run compile        # type-check
npm run lint           # oxlint
npm test               # unit tests (Vitest)
npm run test:e2e       # builds with --mode e2e, then runs the Playwright smoke tests in Chromium
```

Before the first `test:e2e`, run `npm run test:e2e:install` once. It downloads Playwright's Chromium into `.playwright/` inside the project (git-ignored), not into your home folder.

Releasing: the store texts, permission justifications and a pre-submission checklist are in [store/LISTING.md](store/LISTING.md).

Load a build manually:

- **Chrome**: `chrome://extensions` → Developer mode → *Load unpacked* → `.output/chrome-mv3`. Click the toolbar icon to open the side panel.
- **Firefox** (128+): `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on* → `.output/firefox-mv3/manifest.json`. Click the toolbar icon to toggle the sidebar.

On first use the panel asks for access to all websites. That permission is optional, but without it most images on other sites (e.g. CDN-hosted ones) can't be downloaded, and images under overlays can't be found: with it, a small script in each page notes where you last right-clicked (just the position, kept in the page) so LatentNest can look under that spot, and where the pointer is, for the keyboard shortcut.

## Captioning setup

Open Settings (gear icon), pick a server type, choose a model, and click **Test connection**. The test captions a small generated image, which confirms the model can actually see images.

| Server | Notes |
| --- | --- |
| Ollama | Blocks extension origins by default. Start it with `OLLAMA_ORIGINS="chrome-extension://*,moz-extension://*" ollama serve` (or set it in the systemd unit). Then pull a vision model, e.g. `ollama pull qwen2.5vl:7b`. |
| llama.cpp | `llama-server -m model.gguf --mmproj mmproj.gguf`. The model field is optional. |
| LM Studio | Load a vision model and start the server from the Developer tab. |
| Custom | Any `/v1/chat/completions` endpoint that accepts `image_url` parts. Optional API key. |

Servers on `localhost`/`127.0.0.1` work out of the box. For another machine on your network, Settings asks for permission to reach that host.

Under *Advanced*: **Max tokens** is empty by default, so no limit is sent and the server's own applies (set one to cap replies). **Extra request fields** is a JSON object added to every caption request, e.g. `{"chat_template_kwargs": {"reasoning_strength": "low"}}` for a llama.cpp thinking model whose chat template takes a reasoning setting, or `{"top_p": 0.9}`. It's only saved while it's valid JSON.

**Caption styles** are prompt presets, managed in Settings and chosen per dataset. Five are built in: Detailed description, Short caption, Booru tags, Character LoRA and Style LoRA. To add your own, type the instructions, or import `.txt` / `.md` prompt files (picker or drag and drop, several at once). Each file becomes a style named after the file; a Markdown file can set the name with `name:` or `title:` in its front matter instead, and the front matter isn't sent to the model. In the style editor, *Load from file…* replaces the instructions with a file's contents. *Export* (on each style) saves it as a `.md` file and *Export all* saves a `.zip` of them; *Import* reads both back. A dataset's **trigger word** is put at the front of every auto-generated caption. Batch auto-captioning only fills images that have no caption yet. Generating a single image from the editor replaces its caption, with Undo; the arrow next to *Generate* uses a different style for just that image. An image's **captioning hint** (in the editor, or for several selected images at once) is sent to the model along with the style, e.g. "back view, holding a katana".

**Batch runs keep going after you close the panel.** In Chrome they run in an offscreen document; in Firefox, in the background event page, which the run keeps awake. The toolbar badge shows progress, and reopening the panel shows the run where it is (with Stop) and, after the first image, about how long is left. A run that takes over 20 seconds ends with a desktop notification (unless you stopped it); clicking it opens the dataset in a tab. If the browser closes mid-run, the captions done so far are kept; starting again picks up the remaining blanks.

## Using it

- **Add images**: right-click → *Add to Dataset* → pick a dataset (most recent first) or *New dataset…*. It saves the largest size the page offers (from `srcset`), falling back to the one on screen. On X/Twitter it saves the original upload rather than the scaled copy shown in the timeline (often several times larger), and the original format: a JPEG upload shown as WebP is saved as that JPEG. It does the same on Pinterest, Reddit, Wikipedia/Wikimedia Commons, Bluesky, Mastodon, Danbooru, ArtStation and older Tumblr posts. The confirmation on the page has an **Undo** button (it stays while the pointer is on it); undoing an add to a new dataset removes that dataset too. It also works where the browser doesn't see an image under the cursor: photos that sites cover with a transparent layer (Instagram, Flickr, Pinterest…), CSS background images and images inside web components. That's why *Add to Dataset* also shows on links and empty parts of a page; there it looks for the picture under the cursor, and says so if there isn't one. Open a post to save it at full size: profile grids only hold small, cropped previews.
- **Sites with their own right-click menu** (TikTok, YouTube): point at the picture or video and press **Alt+Q** to add it to the dataset you used most recently (a video gives its current frame). Settings → *Keyboard shortcut* shows the current keys, with a button to change them (Chrome's `chrome://extensions/shortcuts`, or Firefox's add-on shortcut settings). In Firefox, Shift+right-click also brings up the browser's own menu on such sites. On TikTok, frames come at the resolution TikTok streams (often 576×1024 or 720×1280) and photo posts at their original size.
- **Grab video frames**: right-click a video → *Add Frame to Dataset* saves the current frame as a lossless PNG at the video's native resolution. If a site blocks reading the video's pixels, LatentNest takes a screenshot cropped to the video instead; that copy is at display size and may include on-screen controls or subtitles. DRM-protected video (Netflix etc.) can't be captured. Some players cover the video with their own layer, so the browser never sees a video under the cursor; there, *Add to Dataset* finds the video underneath and saves its current frame. On YouTube, right-click twice to get the browser's menu. You can also drag and drop files, folders or ZIPs onto a dataset, drag images from web pages into the panel, or paste with Ctrl+V. When importing, `foo.txt` next to `foo.png` becomes that image's caption.
- **Duplicates** (same bytes) are skipped within a dataset.
- **Crop**: the crop button on the image (or C) in the editor. Drag the box or its handles, or drag outside it to draw a new one; pick an aspect ratio (1:1, 2:3, 16:9, …) to lock it. Arrow keys nudge the box, Enter applies, Esc cancels. The original is kept: the crop is applied when captioning and exporting, can be changed or reset any time, and the grid's low-resolution badge (under 512 px on the short side) uses the cropped size.
- **Edit captions in bulk** (the icon next to the filter, or ⋯ → *Edit captions…*): *Find & replace* across a dataset with a live preview, optional match case, whole words and regular expressions (`$1` in the replacement). *Tags* lists comma-separated tags by how many captions use them, and renames or removes one everywhere, or adds a tag to every captioned image (at the end, or at the start after the trigger word). Blank captions are never touched, so auto-captioning still fills them. Every change has Undo.
- **Review auto-captions**: auto captions start out unreviewed (a ✨ on the tile, *Needs review* in the editor). *Review* in the caption panel (or the *Review* filter) steps through them: *Approve and next* (Alt+A) accepts one, and editing the text by hand also counts. Regenerating puts a caption back in review. Bulk find & replace doesn't count as reviewing. ⋯ → *Approve all* clears the queue in one go, with Undo.
- **Sort** the grid (the arrows icon): newest or oldest first, name, smallest first, shortest caption first, or recently edited. The editor steps through images in the same order, and the choice is remembered.
- **Thumbnail size** (the grid icon): small, medium or large tiles (4, 3 or 2 across in the side panel), also changed with + and − while the grid has focus. The same menu can show each image's size on its tile, as dimensions or megapixels. The choices are remembered.
- **Select several images**: Ctrl/⌘-click, Shift-click for a range, the select icon, Space on a focused tile, or Ctrl+A for all. Then auto-caption the blank ones among them, move or copy them to another dataset (or a new one), delete them, add or remove a tag, set a captioning hint, approve their auto captions or clear their captions. Everything has Undo. Esc stops selecting.
- **Keyboard**: in the grid, the arrow keys move, Enter opens, Space selects, Delete removes the focused or selected images (with Undo), and + / − change the thumbnail size. In the editor, Ctrl+Enter / PgDn goes to the next image, Ctrl+Shift+Enter / PgUp to the previous one, Alt+G generates a caption, Alt+A approves it, C crops and Esc goes back. Captions save automatically.
- **Open in tab** (window icon / ⋯ menu) runs the same UI full-width for long captioning sessions.

### Export format

⋯ → **Export ZIP…** asks how to lay the files out, and remembers the answer for each dataset:

```
Images with .txt captions            kohya_ss (repeats folder)
character_lora.zip                   character_lora.zip
└── character_lora/                  └── character_lora/
    ├── 0001.png                         └── 10_ohwx woman/
    ├── 0001.txt                             ├── 0001.png
    ├── 0002.jpg                             ├── 0001.txt
    └── 0002.txt                             └── …
```

The first suits ai-toolkit, OneTrainer, SimpleTuner and most trainers. For kohya_ss, the folder name carries the repeat count, then the trigger word and an optional class word. Other options:

- **Image size**: shrink images to 2048, 1536, 1024 or 768 px on the longest side. Smaller images are left alone.
- **metadata.jsonl**: adds `{"file_name": "0001.png", "text": "…"}` lines for Hugging Face / diffusers style trainers.
- **Leave out images without a caption** (otherwise they get an empty .txt file).

PNG and JPEG files are copied byte-for-byte. WebP, AVIF, GIF (first frame) and BMP are converted to PNG, and so are cropped or shrunk images (so a JPEG is never compressed twice).

## Backup & restore

Everything lives in the browser profile, so uninstalling LatentNest or clearing browser data deletes it. **Settings → Storage & backup → Back up everything** saves one `latentnest-backup-YYYY-MM-DD.tar`:

```
latentnest-backup.json        datasets, captions, crops, hints, review state, export choices, sources,
                              caption styles, server settings (no API key)
datasets/character_lora/0001.png   the original image, unchanged
datasets/character_lora/0001.txt   its caption
…
```

Each dataset folder is also usable on its own (image/.txt pairs), so the backup is readable without LatentNest. It's a tar rather than a ZIP so backups larger than 4 GB work and nothing has to be loaded into memory.

**Restore from backup…** shows what the file holds, then adds whatever is missing. Nothing already here is changed or deleted, except blank captions, which are filled from the backup, so it's safe to restore into a browser that already has data, or to run again after an interruption. Caption styles are merged in. Server settings are only restored if this browser has none. A backup whose download was cut short restores the images it contains.

## Project layout

```
src/
  entrypoints/
    background.ts       context menu, image download (with in-page fallbacks), toasts
    finder.ts           runs in web pages: notes where the last right-click was and where the pointer is
    sidepanel/          side panel / sidebar (also served in a tab via #tab)
    options/            settings page
    offscreen/          Chrome only: hosts batch runs so they outlive the side panel
  lib/
    db.ts               IndexedDB schema (Dexie): datasets, images, originals, thumbs
    datasets.ts         dataset and image operations
    image.ts            format sniffing, thumbnails, PNG conversion
    captioner.ts        OpenAI-compatible vision client
    batch.ts            batch auto-captioning (runner + progress shared through IndexedDB)
    backup.ts, tar.ts   whole-library backup and restore
    captionEdit.ts      find & replace and tag operations
    crop.ts             crop box geometry
    grid.ts             grid filters, sort orders and tile sizes
    settings.ts         server settings and caption styles; styleFile.ts reads .txt/.md prompt files
    import.ts / export.ts
    inpage.ts           functions injected into web pages (must stay self-contained)
    findImage.ts        the picture under a right-click: overlays, srcset, backgrounds, shadow DOM
    fullSize.ts         per-site rules for original-size addresses (X, Pinterest, Reddit, …)
    menus.ts            "Add to Dataset" submenu
  panel/                side panel views (Home, DatasetView, ImageGrid, Editor, Selection, ExportDialog, …)
  options/              settings UI
  components/, hooks/, styles/
tests/
  unit/                 Vitest, with an in-memory browser API and IndexedDB
  e2e/                  Playwright: loads the e2e build in Chromium, with a fake caption server
assets-src/             source logo; scripts/make-mark.py derives the simplified 16/32px mark
                        from it, then `npm run icons` regenerates public/icon and friends
docs/                   GitHub Pages site: the privacy policy
store/                  store listing texts and the promo tile (scripts/make-store-assets.mjs)
```

Everything is stored locally in the browser profile (IndexedDB, with `unlimitedStorage`). Nothing leaves the machine except image downloads from the sites you save from and requests to the captioning server you configure. See the [privacy policy](https://dainamolabs.github.io/LatentNest/privacy.html).

The database schema is versioned in `src/lib/db.ts`. Never edit a version that has shipped: add a new one (with an upgrade function if existing rows must change). `tests/unit/db.test.ts` fails if a shipped version changes.

## Known limitations

- Only one batch run at a time, across all datasets.
- Sites that check the `Referer` header on image requests (some art sites) can refuse the download.
- `wxt build --mode e2e` exposes a test hook in the background script. Normal builds strip it.

## License

The code is released under the [MIT License](LICENSE).

The LatentNest name, the bird logo and the Dainamo Labs name and logo are not covered by that license. A fork you publish must use a different name and icon.
