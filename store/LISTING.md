# Store listing

Everything the Chrome Web Store and Firefox Add-ons (AMO) dashboards ask for, ready to paste. Keep it in step with the manifest and `docs/privacy.html`.

## Assets

| Asset | File | Notes |
| --- | --- | --- |
| Store icon | `public/icon/128.png` | Taken from the package. 96×96 artwork inside 16px of padding. |
| Small promo tile (440×280) | `store/promo-tile-440x280.png` | Regenerate with `node scripts/make-store-assets.mjs`. |
| Screenshots (1280×800, 1–5) | `store/screenshots/` | 24-bit PNG, no transparency. |

Upload in this order (the first one sells the listing):

1. `1-overview.png`: the Commons page with the side panel open on the captioned dataset.
2. `2-context-menu.png`: right-click → *Add to Dataset* → `watercolor_style`.
3. `3-editor.png`: an auto caption in the editor, marked *Needs review*.
4. `4-batch-captioning.png`: a batch run in progress, with time left.
5. `5-export.png`: the Export dialog with the kohya_ss layout.

Alternates: `alt-settings.png` (a successful connection test against llama.cpp), `alt-bulk-edit.png` (regex find & replace with its preview), `alt-grid.png` (the captioned dataset).

The screenshot dataset is 16 public-domain watercolors by Winslow Homer (1836–1910), from Wikimedia Commons. The captions are real output from a local llama.cpp vision model, using the *Style LoRA* caption style. Shots 1 and 2 are captured by hand in Chromium (raw captures in the git-ignored `store/screenshots/raw/`); shots 3–5 and the alternates come from Playwright, with the website-access banner hidden, as it is once access is granted.

## Basics

- **Name**: LatentNest
- **Summary** (manifest `description`, max 132 characters): Collect images from the web into captioned training datasets.
- **Chrome category**: Productivity › Tools
- **AMO categories**: Photos, Music & Videos; Other
- **Language**: English
- **Homepage**: https://github.com/DainamoLabs/LatentNest
- **Support**: https://github.com/DainamoLabs/LatentNest/issues
- **Privacy policy**: https://dainamolabs.github.io/LatentNest/privacy.html
- **License (AMO)**: MIT

## Description

```
LatentNest turns images you find on the web into datasets for training LoRAs and fine-tunes.

Right-click any image → Add to Dataset. LatentNest saves the largest version the page offers, including the original upload on X/Twitter, Pinterest, Reddit, Wikimedia, Bluesky, Mastodon, Danbooru, ArtStation and Tumblr. It finds pictures hidden under overlays, CSS backgrounds and video players, and grabs the current frame of a video as a lossless PNG. On sites that replace the right-click menu, point and press Alt+Q.

Caption by hand, or with a vision model running on your own computer: Ollama, llama.cpp, LM Studio or any OpenAI-compatible server. Batch captioning keeps running after you close the panel and only fills blank captions. Review auto-captions one by one, edit them in bulk with find & replace and tag tools, crop without losing the original, and add a hint per image to steer the model.

Export a ZIP that kohya_ss, ai-toolkit, OneTrainer, SimpleTuner and diffusers trainers read directly: image/.txt pairs, kohya repeat folders, optional downscaling and metadata.jsonl.

Private by design: everything stays in your browser. Images go only to the captioning server you configure. No accounts, no analytics. Back up your whole library to a single file and restore it anywhere.

Open source (MIT): https://github.com/DainamoLabs/LatentNest
```

## Single purpose (Chrome)

```
LatentNest builds image datasets for training AI image models: it saves images from web pages into local datasets, captions them by hand or with the user's own vision model, and exports them in the folder layouts that training tools read.
```

## Permission justifications (Chrome)

| Permission | Justification |
| --- | --- |
| `sidePanel` | The whole interface lives in the side panel: browsing datasets, editing captions, running captioning and exporting. |
| `contextMenus` | Adds "Add to Dataset" and "Add Frame to Dataset" to the right-click menu, the main way users save images. |
| `storage` | Saves settings locally: the captioning server's address and model, caption styles, and interface preferences. |
| `unlimitedStorage` | Datasets are collections of full-resolution training images, often hundreds of images and several gigabytes, stored locally in IndexedDB. Without it the browser could refuse to store them or evict them. |
| `scripting` | When the user right-clicks an image or presses the shortcut, LatentNest runs a function in that page to find the picture under the cursor (sites often cover images with transparent layers, CSS backgrounds or shadow DOM), read the largest size in its srcset, or capture the current video frame. If the user grants website access, it also registers a small script that remembers the last right-click and pointer position inside the page, for the same purpose. |
| `activeTab` | Lets the right-click menu and keyboard shortcut work on the current tab without access to all websites, and lets LatentNest capture the visible tab to save a video frame when the site blocks reading the video's pixels. |
| `notifications` | Shows one notification when a long captioning run (over 20 seconds) finishes, since runs continue after the panel is closed. |
| `offscreen` | Batch captioning runs in an offscreen document (reason: BLOBS) so it continues after the user closes the side panel, and isn't stopped like a service worker while a slow model works. It reads image blobs from IndexedDB and sends them to the user's captioning server. |
| Host permission `http://localhost/*`, `http://127.0.0.1/*` | The captioning server (Ollama, llama.cpp, LM Studio) runs on the user's own computer. LatentNest sends it images to caption. Loopback addresses only. |
| Optional host permission `<all_urls>` | Requested at runtime from the side panel, only if the user agrees. Most images are served from other domains (CDNs), so downloading them needs access to those hosts. The same access lets the right-click finder work on every site, and lets the user reach a captioning server on another machine. |

**Remote code**: No. All code is bundled in the package.

## Privacy practices (Chrome)

Chrome requires disclosing data an extension handles even when it stays on the device ([User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)). Tick:

- **Website content**: images the user saves, with the image address and the address of the page it came from.
- **User activity**: the in-page script keeps the last right-click and pointer position (never sent anywhere) to find the image under the cursor.
- **Authentication information**: the optional API key for the user's own captioning server, stored locally and sent only to that server.

Leave the rest unticked. Then certify all three statements: data isn't sold or transferred to third parties outside the approved use cases, isn't used for purposes unrelated to the single purpose, and isn't used for creditworthiness or lending.

## Firefox Add-ons (AMO)

- **Add-on ID**: `latentnest@dainamolabs` (fixed in `wxt.config.ts`; never change it after the first upload).
- **Data collection**: the manifest declares `data_collection_permissions: { required: ['none'] }`. Nothing is transmitted to the developer.
- **Upload**: `npm run zip:firefox` writes `.output/latentnest-<version>-firefox.zip` (the add-on) and `.output/latentnest-<version>-sources.zip` (the source code AMO asks for, because the code is bundled).
- **Notes to reviewer**:

```
Built with WXT (Vite) from the attached sources. To reproduce:
  Node 22 or newer (built with Node 24.14, npm 11.11)
  npm ci
  npm run build:firefox
The output is in .output/firefox-mv3/ and matches the uploaded package.

The captioning feature talks to a vision-model server the user runs themselves (Ollama, llama.cpp or LM Studio on localhost). To try it without a server, everything else (adding images by right-click, captions by hand, export, backup) works on its own.
```

## Before each submission

1. `npm run lint && npm run compile && npm test && npm run test:e2e`
2. Bump `version` in `package.json` and add a section to `CHANGELOG.md`.
3. `npm run zip` and `npm run zip:firefox`.
4. Load both ZIPs once on a fresh browser profile: add an image, caption it, export, back up.
5. Commit, then tag: `git tag v<version> && git push --tags`.
