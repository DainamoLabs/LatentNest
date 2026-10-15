# Changelog

Notable changes to LatentNest. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [0.1.0] - Unreleased

First public release, for the Chrome Web Store and Firefox Add-ons.

### Collecting

- Right-click → *Add to Dataset* saves the largest size the page offers, and the original upload on X/Twitter, Pinterest, Reddit, Wikimedia, Bluesky, Mastodon, Danbooru, ArtStation and older Tumblr posts.
- Finds pictures under overlays, CSS backgrounds and shadow DOM; *Add Frame to Dataset* saves a video's current frame as a PNG.
- Alt+Q adds the picture or video frame under the pointer, for sites with their own right-click menu.
- Undo on the page confirmation; drag and drop, paste, and import of folders and ZIPs with `.txt` captions.

### Captioning

- Ollama, llama.cpp, LM Studio or any OpenAI-compatible server, with a connection test.
- Caption styles managed in Settings, importable from `.txt` / `.md` files; per-dataset trigger word; per-image captioning hints.
- Batch captioning that keeps running after the panel closes, with a time-left estimate and a notification at the end.
- Review queue for auto captions; bulk find & replace and tag tools; crop without losing the original.

### Exporting and backup

- ZIP export as image/.txt pairs or kohya_ss repeat folders, with optional downscaling and `metadata.jsonl`.
- Whole-library backup to a single `.tar`, and a restore that only adds what's missing.

### Release preparation

- Minimum Chrome version 116; homepage link; 128px icon with the store's 16px padding.
- Privacy policy (GitHub Pages), store listing texts and promo tile.
- Crash screen with Reload and Copy error details, instead of a blank panel.
- Unit tests (Vitest), an end-to-end smoke test (Playwright) and linting (oxlint).
- MIT license; the name and logos are excluded.

[0.1.0]: https://github.com/DainamoLabs/LatentNest/releases/tag/v0.1.0
