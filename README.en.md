# HighlightClip

**Languages:** [简体中文](README.md) · [English](README.en.md) · [日本語](README.ja.md)

A desktop app for a **local video library**, **keyword search**, **automatic highlight detection**, and **FFmpeg export**. Built with **Electron**; the UI is **React + Vite**. The main process handles analysis, encoding, and native dialogs; the renderer talks to it via **`window.api`** exposed from **preload**.

## Features

- **Library**: import local videos (multi-select), title / notes metadata, search by title, notes, or path.
- **Highlight analysis**: configurable target duration, max segments, highlight window (per-segment length), scene threshold, motion sampling, etc.; progress UI including an “analyzing” state.
- **Export reel**: concatenate detected segments to MP4 (optional loudness normalization, crossfade between clips).
- **Multi-clip compile**: check multiple items and merge them into one reel in list order (each analyzed, then stitched).
- **Settings**: optional custom `ffmpeg` / `ffprobe` paths; if empty, bundled binaries from dependencies are used (`asarUnpack` is configured for packaging). By default you **do not** need FFmpeg installed system-wide.

## Requirements

- **Node.js** 18+ (LTS recommended)
- **npm** 9+
- `ffmpeg-static` and `@ffprobe-installer/ffprobe` ship platform-specific binaries; after `npm install` you can run and develop locally.

## Install & run

```bash
npm install
```

- **Build once and launch**

  ```bash
  npm start
  ```

- **Dev mode** (watch main, renderer, preload; start Electron)

  ```bash
  npm run dev
  ```

  If `wait-on` does not see outputs on first run, run `npm run build` once.

## NPM scripts

| Command | Description |
|--------|-------------|
| `npm run build` | Compile main (`tsconfig.main.json`), Vite renderer, copy static assets, esbuild preload |
| `npm run build:renderer` | Vite only: `src/renderer` → `dist/renderer` |
| `npm run build:preload` | Preload bundle only → `dist/preload/bundle.js` |
| `npm run watch` | Watch main / renderer / preload (does not start Electron) |
| `npm run pack` | `electron-builder --dir` for the **current** OS (unpacked dir) |
| `npm run dist` | Production installer for the **current** OS → `release/` |
| `npm run dist:mac` | **macOS only**: `dmg` + `zip` |
| `npm run dist:win` | **Windows only**: NSIS installer + `zip` |
| `npm run pack:mac` / `pack:win` | Per-platform `--dir` for quick smoke tests |

## Packaging macOS / Windows

**Note:** `electron-builder` by default builds for the **host OS** (e.g. on a Mac, `npm run dist` produces mac artifacts only). To ship **both** macOS and Windows installers, use one of the following.

### 1. Build on each OS

- **Mac:** `npm run dist:mac` → outputs under `release/` (e.g. `HighlightClip-0.1.0-mac-arm64.dmg`, names vary by arch/settings).
- **Windows:** `npm run dist:win` → `release/` (NSIS + portable `zip`).

Building Windows installers **on macOS** usually needs extra tooling (e.g. Wine); CI is simpler.

### 2. GitHub Actions (both platforms)

Workflow: `.github/workflows/build-desktop.yml`

- **Manual:** repo → **Actions** → **Build desktop** → **Run workflow**.
- **Tags:** pushing a tag like `v0.1.0` (`v*`) also triggers it.

Jobs run on `macos-latest` and `windows-latest`. Download **Artifacts** (`HighlightClip-macos` / `HighlightClip-windows`) from each job; they contain the `release/` folder (installers and archives).

### Artifact names

`package.json` → `build.artifactName`: `${productName}-${version}-${os}-${arch}.${ext}`.

### Windows installer (NSIS)

Not one-click; user can change install directory (`build.nsis`). Code signing / macOS notarization require extra `electron-builder` / certificate setup.

## Icon & unpacked app

- App icon: `build/icon.png` (square PNG ≥1024×1024 recommended). `build.icon` in `package.json` points here.
- **Main process** changes require an **Electron restart**; React-only changes refresh via `vite build --watch` depending on how you start the app.
- `npm run pack` / `pack:mac` / `pack:win`: unpacked app directory for local inspection.

## Project layout

```
src/
  main/           # Electron main: IPC, highlight engine, render jobs, library
  preload/        # contextBridge API (esbuild bundle)
  renderer/       # React entry, App, styles, Vite index.html
  shared/         # IPC constants & shared types
dist/             # Build output (main, preload, renderer)
build/            # Packager assets (e.g. icon.png)
```

Main entry: `dist/main/main.js` (`package.json` → `main`). Window loads `dist/renderer/index.html`.

## Tech stack

- Electron 33, TypeScript 5, React 19, Vite 5  
- `electron-store` for settings and library persistence  
- `electron-builder` config under `package.json` → `build`

## License

MIT — see `package.json` → `license`.
