# HighlightClip

**Languages:** [简体中文](README.md) · [English](README.en.md) · [日本語](README.ja.md)

A desktop app for a **local video library**, **keyword search**, **automatic highlight detection**, and **FFmpeg export**. Built with **Electron**; the UI is **React + Vite**. The main process handles analysis, encoding, and native dialogs; the renderer talks to it via **`window.api`** exposed from **preload**.

## Features

- **Library**: import local videos (multi-select), title / notes metadata, search by title, notes, or path.
- **Highlight analysis**: configurable target duration, max segments, highlight window (per-segment length), scene threshold, motion sampling, etc.; progress UI including an “analyzing” state.
- **Export reel**: concatenate detected segments to MP4 (optional loudness normalization, crossfade between clips).
- **Multi-clip compile**: check multiple items and merge them into one reel in list order (each analyzed, then stitched).
- **Settings**: optional custom `ffmpeg` / `ffprobe` paths; if empty, bundled binaries from dependencies are used (`asarUnpack` is configured for packaging). By default you **do not** need FFmpeg installed system-wide.
- **Qwen / Alibaba Cloud Model Studio (optional)**: save a **Bailian** API key (`sk-…`) from the [Model Studio console](https://bailian.console.aliyun.com/) to enable highlight strategies; **cutting and export still run locally with FFmpeg**. See below.

## Qwen (Alibaba Cloud Model Studio / Bailian, optional)

In **Settings → Qwen (Alibaba Cloud Bailian)**, enter your **Model Studio API key** (`sk-…`, created in the [Bailian console](https://bailian.console.aliyun.com/)). Keys are stored locally via **`electron-store`**; do **not** commit keys to Git.

The app uses the **OpenAI-compatible** endpoint (same key as in the console):

`https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`

(No separate “Lingji” console is required; billing and models are managed in Model Studio / Bailian.)

### Highlight modes (pick one in Settings)

| Mode | Summary |
|------|---------|
| **Local only** | Heuristic scoring from motion, loudness, and scene cuts on the FFmpeg side; **no network**. |
| **Local + Qwen text rerank** | Local candidates first, then a **text model** reranks / filters segments. |
| **Qwen audio (direct)** | A **multimodal** model listens to a WAV from the **first ~2 minutes** of the file and returns highlight times; on failure, falls back to local heuristics. |
| **Transcribe then pick** | FFmpeg exports **~48s** WAV chunks locally; the multimodal model **transcribes with timestamps** per chunk, then a **text model** picks highlight ranges from the merged transcript. Transcription covers **at most ~14 minutes** from the start of long files; on failure, falls back to local heuristics. |

### Model fields (editable in Settings)

- **Text model** (default `qwen3.6-plus`): used for **rerank** and for **picking segments** in transcribe-then-pick mode.
- **Audio multimodal model** (default `qwen3-omni-flash`): used for **audio-in** requests (`input_audio`) in audio-direct mode and for **per-chunk transcription**.

Exact model IDs and billing are defined in **[Alibaba Cloud Model Studio](https://help.aliyun.com/zh/model-studio/)** documentation.

### Privacy and data flow

- **Slicing, transcoding, export**: always runs against **local file paths** using **FFmpeg** on your machine.
- **Qwen calls**: only the payload required by the API (e.g. base64 WAV chunks, transcript text, candidate lists) is sent over **HTTPS** to the Bailian-compatible host above; the app does **not** upload the full video as a public URL for ASR-style “file URL” APIs.

After changing **main-process** code, **restart Electron** before re-running highlight analysis.

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

- **Dev mode** (Vite dev server with **React HMR**; watch main + preload; start Electron)

  ```bash
  npm run dev
  ```

  The window loads `http://127.0.0.1:5173`, so edits under `src/renderer` (e.g. `App.tsx`) hot-reload without a manual refresh. `npm start` still serves the built `dist/renderer` via `loadFile` (**no** HMR).

  If `wait-on` does not see outputs on first run, run `npm run build` once.

### VS Code debugging (`.vscode/launch.json`)

| Configuration | What it does |
|---------------|----------------|
| **Electron: 开发 (Vite 热更新)** | Pre-launch runs `dev:compile-once` (main + preload) then starts **Vite** in the background; Electron gets `ELECTRON_RENDERER_URL=http://127.0.0.1:5173` → **React HMR**. |
| **Electron: 主进程 (静态 dist，无热更新)** | Pre-launch `npm run build`, then `loadFile` on `dist` → **no HMR**. |
| **Electron: 主进程 (仅构建渲染)** | Pre-launch task label **`npm: build:renderer`** runs `npm run build:renderer` (Vite **production** build of `src/renderer` → `dist/renderer` only) → **still no HMR**; skips recompiling main/preload. |
| **Electron: 主进程 (不执行 build)** | No pre-launch build; you must already have a valid `dist/`. Often used with `npm run dev` / Vite started elsewhere. |
| **Electron: 附加到渲染进程** | Chrome debugger attach to `--remote-debugging-port=9223` for renderer breakpoints (start Electron with one of the configs above that passes this flag). |

Pick **「Electron: 开发 (Vite 热更新)」** for UI work. If port **5173** stays busy after stopping debug, stop the leftover Vite terminal. Pre-launch tasks are defined in **`.vscode/tasks.json`** (e.g. `electron-dev: compile + vite`, `vite: dev server`).

## NPM scripts

| Command | Description |
|--------|-------------|
| `npm run build` | Compile main (`tsconfig.main.json`), Vite renderer, copy static assets, esbuild preload |
| `npm run build:renderer` | Vite **production** build only: `src/renderer` → `dist/renderer` (no dev server, **no HMR**) |
| `npm run build:preload` | Preload bundle only → `dist/preload/bundle.js` |
| `npm run copy:static` | Copy `static/` → `dist/static` (invoked by `build`) |
| `npm run watch` | Watch main (`tsc -w`), `vite build --watch`, preload watch (**does not** start Electron) |
| `npm run dev` | Dev: Vite dev server (HMR) + main + preload watch + Electron with `cross-env ELECTRON_RENDERER_URL=…` |
| `npm run vite:dev` | Vite dev server only (`http://127.0.0.1:5173`); rarely run alone unless you wire Electron yourself |
| `npm run dev:compile-once` | One-shot main + preload compile (used by the VS Code “Vite hot” pre-launch task) |
| `npm start` | Full `build` then launch with static `dist/renderer` (no HMR) |
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
- **Main** or **preload** changes need an **Electron restart**. **React**: use **`npm run dev` / VS Code “Vite hot”** for **HMR**; with **`npm start`** or static `dist` only, rebuild (`npm run build` / `vite build`) then refresh or restart the window.
- `npm run pack` / `pack:mac` / `pack:win`: unpacked app directory for local inspection.

## Project layout

```
src/
  main/           # Electron main: IPC, highlight engine, Qwen pipelines (qwen*), render jobs, library
  preload/        # contextBridge API (esbuild bundle)
  renderer/       # React entry, App, styles, Vite index.html
  shared/         # IPC constants & shared types
dist/             # Build output (main, preload, renderer)
build/            # Packager assets (e.g. icon.png)
```

Main entry: `dist/main/main.js` (`package.json` → `main`).

### Window loading (dev vs prod)

- **`npm start` or no `ELECTRON_RENDERER_URL`**: main process uses **`loadFile`** → `dist/renderer/index.html` (static build).
- **`npm run dev` or VS Code “Electron: 开发 (Vite 热更新)”**: with **`ELECTRON_RENDERER_URL`** (e.g. `http://127.0.0.1:5173`), main uses **`loadURL`** to the Vite server; **preload** still loads from `dist/preload/bundle.js`.

## Tech stack

- Electron 33, TypeScript 5, React 19, Vite 5  
- `electron-store` for settings and library persistence  
- `cross-env` so `npm run dev` sets `ELECTRON_RENDERER_URL` on Windows too  
- Optional: Qwen via `fetch` to Bailian **OpenAI-compatible** API (`dashscope.aliyuncs.com`)  
- `electron-builder` config under `package.json` → `build`

## License

MIT — see `package.json` → `license`.
