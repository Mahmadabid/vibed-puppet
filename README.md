<p align="center">
  <img src="logo.svg" width="80" height="80" alt="Vibed Puppet logo" />
</p>

<h1 align="center">vibed puppet</h1>

<p align="center">
  Clean up X/Twitter history and extract Google Form fields locally, with a desktop app built for fast, private workflow.
</p>

<p align="center">
  It helps you:
</p>

<ul>
  <li>Delete posts, replies, reposts, media, likes, and highlights in bulk</li>
  <li>Filter cleanup by date, keywords, replies, engagement, and pinned posts</li>
  <li>Extract Google Form field IDs, labels, types, and options in one place</li>
  <li>Keep everything on your machine with no API required</li>
</ul>

<p align="center">
  <a href="https://github.com/mahmadabid/vibed-puppet/releases"><img src="https://img.shields.io/github/v/release/mahmadabid/vibed-puppet?color=00ffa6&labelColor=0f172a" alt="Latest Release" /></a>
  <img src="https://img.shields.io/badge/Electron-39-47848F?logo=electron&labelColor=0f172a" alt="Electron" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&labelColor=0f172a" alt="TypeScript" />
  <img src="https://img.shields.io/badge/License-MIT-00ffa6?labelColor=0f172a" alt="MIT" />
</p>

---

## Features

### X / Twitter cleanup
Delete posts, reposts, replies, media, and highlights. Unlike posts in bulk.

Powerful filters:

| Filter | What it does |
|---|---|
| Date range | Only touch posts between two dates |
| Keywords | Only delete posts containing specific words |
| Reply to user | Only delete replies directed at a specific person |
| Reply to post | Only delete replies under one specific tweet |
| Engagement ceiling | Skip posts with too many likes or replies |
| Skip pinned | Preserve your pinned post |

### Google Forms extractor
Extract all field `entry.XXXXX` IDs, types, labels, and options from any Google Form.
A floating panel in Chrome lets you approve the extraction directly in the browser.

### Browser-native UX
All sign-in prompts appear as floating overlays **inside the Chrome window** — no switching between apps. The overlay survives page navigations and keeps polling until you're logged in.

### Auto-updater
GitHub Releases integration. Updates are downloaded in the background and installed on restart.

---

## Download

Get the latest installer from [**Releases**](https://github.com/mahmadabid/vibed-puppet/releases).

| Platform | File |
|---|---|
| Windows | `Vibed-Puppet-Setup-x.x.x.exe` |
| macOS   | `Vibed-Puppet-x.x.x.dmg` |
| Linux   | `Vibed-Puppet-x.x.x.AppImage` |

---

## Requirements

- **Google Chrome** installed (Puppeteer uses your existing Chrome — no separate ChromeDriver)
- Windows 10+, macOS 12+, or recent Ubuntu/Debian

No Node.js required to run the packaged app.

---

## Building from source

```bash
git clone https://github.com/mahmadabid/vibed-puppet.git
cd vibed-puppet
npm install
npm run dev          # hot-reload dev mode
npm run dist:win     # build Windows installer
npm run dist:mac     # build macOS DMG
npm run dist:linux   # build Linux AppImage
```

Before running `dist`, the app icons are already in `build/`:
- `build/icon.ico` — Windows
- `build/icon.icns` — macOS
- `build/icon.png` — Linux + taskbar (512×512)

If you want to regenerate them from `logo.svg`, replace the files in `build/` with your exported app icons.

For AppX/MSIX or Microsoft Store packaging, use the tile assets in `build/appx/`:
- `build/appx/StoreLogo.png`
- `build/appx/Square150x150Logo.png`
- `build/appx/Square44x44Logo.png`
- `build/appx/Wide310x150Logo.png`

Releases: This project publishes releases via GitHub Actions. The CI workflow is in `.github/workflows/main.yml`. It runs on every push to `main` and creates a draft release with the new version number from `package.json`. You can then edit the release notes and publish it manually.

---

## How it works

```
Electron main process
├── scraper/x-cleaner.ts        Puppeteer: deletes posts/replies/media/likes
├── scraper/forms-extractor.ts  Puppeteer: reads FB_PUBLIC_LOAD_DATA_
├── scraper/github-star.ts      Puppeteer: stars this repo on GitHub
├── scraper/browser-ui.ts       Injects floating overlay into Chrome pages
├── scraper/updater.ts          electron-updater GitHub Releases
└── index.ts                    IPC handlers, window, default paths

Preload (contextBridge)
└── index.ts                    Exposes window.api to renderer

Renderer (React + TypeScript + Tailwind v4)
└── App.tsx                     Full UI — tabs, filters, log, summary modal
```

---

## Login flow

Vibed Puppet opens Chrome with a persistent overlay. On X:
1. If not logged in → overlay shows "You're not logged in"
2. You sign in normally in Chrome (URL changes are fine)  
3. Overlay checks every 30s automatically
4. Or click **I'm logged in ✓** once your feed is visible
5. Username is auto-detected via 5 different strategies

---

## Output files

All logs are JSON, saved to the folder you choose (default: `Documents/vibed-puppet-output`).

| File | Contents |
|---|---|
| `deleted-posts.json` | Deleted posts and undone reposts |
| `deleted-replies.json` | Deleted replies |
| `unliked-posts.json` | Unliked posts |
| `deleted-media.json` | Posts deleted via the media tab |
| `deleted-highlights.json` | Deleted highlights |
| `form-fields.json` | Extracted Google Form fields |

---

## Privacy

Everything runs on your machine. Nothing is sent to any server. Your credentials live only in the Chrome profile stored in your app data folder.

---

## Contributing

PRs welcome. Open an issue first for significant changes.

```
src/main/scraper/    Add new automations here
src/renderer/src/    React UI
```

---

## License

[MIT](LICENSE) © 2025 Muhammad Ahmad
