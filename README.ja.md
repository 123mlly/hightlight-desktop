# HighlightClip

**Languages:** [简体中文](README.md) · [English](README.en.md) · [日本語](README.ja.md)

**ローカル動画ライブラリ**、**キーワード検索**、**自動ハイライト検出**、**FFmpeg による書き出し**を行うデスクトップアプリです。**Electron** ベースで、UI は **React + Vite** です。メインプロセスが解析・エンコード・ネイティブダイアログを担当し、レンダラーは **preload** が公開する **`window.api`** 経由で通信します。

## 機能概要

- **ライブラリ**：ローカル動画のインポート（複数選択）、タイトル／メモのメタデータ、タイトル・メモ・パスによる検索。
- **ハイライト解析**：目標総尺、最大セグメント数、ハイライト窓（1 クリップあたりの長さ）、シーン閾値、モーションサンプリングなどを設定可能。解析中は進捗と「解析中」表示。
- **書き出し**：検出された候補区間をつなげて MP4 出力（ラウドネス正規化、クリップ間クロスフェードはオプション）。
- **複数素材の結合**：複数チェック後、リスト順にそれぞれ解析して 1 本のリールに結合。
- **設定**：任意の `ffmpeg` / `ffprobe` パス。空欄なら依存パッケージ同梱のバイナリを使用（パッケージ時は `asarUnpack` 済み）。通常は **システムに FFmpeg を別途入れる必要はありません**。
- **通義千問 / 阿里雲百錬（任意）**：[百錬コンソール](https://bailian.console.aliyun.com/)で取得した API キー（`sk-…`）を設定すると、複数のハイライト戦略を選択可能。**実際のカットと書き出しは引き続きローカルの FFmpeg** が行います。詳細は下記。

## 通義千問（阿里雲百錬、任意）

アプリ内 **設定 → 通義千問（阿里雲百錬）** に **百錬 API キー**（`sk-…`、[百錬コンソール](https://bailian.console.aliyun.com/)で発行）を入力します。キーは **`electron-store`** によりローカルに保存され、**Git にコミットしないでください**。

**OpenAI 互換モード**で次のエンドポイントを呼び出します（コンソールで発行したキーと対応）：

`https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`

（別途「霊積」コンソールは不要です。）

### ハイライト解析モード（設定でいずれか 1 つ）

| モード | 概要 |
|--------|------|
| **ローカルのみ** | FFmpeg 側のモーション・音量・シーン切り替え等のヒューリスティック。**ネットワーク不要**。 |
| **ローカル + テキスト再ランク** | まずローカルで候補時間帯を出し、**テキストモデル**で並べ替え / 絞り込み。 |
| **聴取して直接** | **マルチモーダル**が冒頭 **約 2 分**の WAV を聞き、ハイライト時間を返す。失敗時はローカルにフォールバック。 |
| **書き起こしてから選択** | ローカルで **約 48 秒**ごとに FFmpeg で WAV を切り出し、マルチモーダルで**タイムスタンプ付き書き起こし**、続けて**テキストモデル**が字幕から区間を選択。書き起こしは長尺では冒頭 **約 14 分**まで。失敗時はローカルにフォールバック。 |

### モデル欄（設定で変更可）

- **テキストモデル**（既定 `qwen3.6-plus`）：**再ランク**および「書き起こしてから選択」の**区間選択**に使用。
- **聴取用マルチモーダル**（既定 `qwen3-omni-flash`）：「聴取して直接」と「書き起こしてから選択」の**チャンク書き起こし**（`input_audio`）に使用。

モデル ID・課金は **[阿里雲百錬（大モデルサービスプラットフォーム）](https://help.aliyun.com/zh/model-studio/)** のドキュメントに従います。

### プライバシーとデータの流れ

- **スライス・トランスコード・書き出し**：常に **ローカルパス**上の素材に対し、マシン上の **FFmpeg** が実行。
- **千問呼び出し**：API に必要なペイロード（例：WAV の Base64、字幕テキスト、候補リスト）のみを **HTTPS** で上記百錬互換ホストに送信。長尺動画全体を公開 URL でアップロードする方式は使いません。

**メインプロセス**のコードを変更した場合は、ハイライト解析をやり直す前に **Electron を再起動**してください。

## 動作環境

- **Node.js** 18 以上（LTS 推奨）
- **npm** 9 以上
- `ffmpeg-static` と `@ffprobe-installer/ffprobe` が OS 向けバイナリを提供します。`npm install` 後に開発・実行できます。

## インストールと起動

```bash
npm install
```

- **一度ビルドして起動**

  ```bash
  npm start
  ```

- **開発**（Vite 開発サーバー + **React HMR**；メイン／preload をウォッチして Electron 起動）

  ```bash
  npm run dev
  ```

  ウィンドウは `http://127.0.0.1:5173` を読み込み、`src/renderer`（例：`App.tsx`）の変更は **ホットリロード** されます。`npm start` はビルド済み `dist/renderer` を `loadFile` で読み込み、**HMR はありません**。

  初回で `wait-on` が成果物を待てない場合は、先に `npm run build` を 1 回実行してください。

### VS Code デバッグ（`.vscode/launch.json`）

| 構成名 | 内容 |
|--------|------|
| **Electron: 开发 (Vite 热更新)** | 事前タスクで `dev:compile-once`（メイン + preload）の後、**Vite** をバックグラウンド起動。Electron に `ELECTRON_RENDERER_URL=http://127.0.0.1:5173` を設定し、**React HMR** が有効。 |
| **Electron: 主进程 (静态 dist，无热更新)** | 事前に `npm run build` 全体の後、`loadFile` で `dist` を読み込み、**HMR なし**。 |
| **Electron: 主进程 (仅构建渲染)** | 事前タスク **`npm: build:renderer`**（VS Code 上のラベル）= ターミナルで `npm run build:renderer`。`src/renderer` のみ Vite **本番ビルド** → `dist/renderer`。**HMR なし**。メインを再コンパイルしないとき用。 |
| **Electron: 主进程 (不执行 build)** | 事前ビルドなし。利用可能な `dist/` が既にあること。別ターミナルの `npm run dev` 等と併用することが多い。 |
| **Electron: 附加到渲染进程** | `--remote-debugging-port=9223` に Chrome デバッガをアタッチ（レンダラー側ブレークポイント用。上記いずれかで当該ポート付き Electron を先に起動）。 |

UI を触るときは **「Electron: 开发 (Vite 热更新)」** を選ぶとよいです。デバッグ停止後も **5173** が残る場合は、Vite のターミナルを終了してください。事前タスクは **`.vscode/tasks.json`**（例：`electron-dev: compile + vite`）に定義されています。

## npm スクリプト

| コマンド | 説明 |
|----------|------|
| `npm run build` | メイン（`tsconfig.main.json`）コンパイル、Vite でレンダラー、静的ファイルコピー、esbuild で preload |
| `npm run build:renderer` | Vite **本番ビルド**のみ：`src/renderer` → `dist/renderer`（開発サーバー・**HMR なし**） |
| `npm run build:preload` | preload のみ → `dist/preload/bundle.js` |
| `npm run copy:static` | `static/` を `dist/static` にコピー（`build` から実行） |
| `npm run watch` | メイン `tsc -w` + `vite build --watch` + preload ウォッチ（Electron は**起動しない**） |
| `npm run dev` | 開発：Vite 開発サーバー（HMR）+ メイン／preload ウォッチ + `cross-env` で `ELECTRON_RENDERER_URL` を付与して Electron |
| `npm run vite:dev` | Vite 開発サーバーのみ（`http://127.0.0.1:5173`）。通常は単独実行不要 |
| `npm run dev:compile-once` | メイン + preload を一度だけビルド（VS Code「開発 (Vite)」事前タスクなど） |
| `npm start` | フル `build` 後、静的 `dist/renderer` で起動（HMR なし） |
| `npm run pack` | `electron-builder --dir`（**実行中 OS** 向け、未パッケージディレクトリ） |
| `npm run dist` | **実行中 OS** 向けインストーラー → `release/` |
| `npm run dist:mac` | **macOS のみ**：`dmg` + `zip` |
| `npm run dist:win` | **Windows のみ**：NSIS インストーラー + `zip` |
| `npm run pack:mac` / `pack:win` | 各 OS の `--dir` で素早く確認 |

## macOS / Windows 向けパッケージング

**注意：** `electron-builder` はデフォルトで **ビルド実行マシンの OS** 向けのみ作成します（例：Mac 上の `npm run dist` は Mac 用のみ）。**Mac と Windows の両方**の成果物が欲しい場合は次のいずれかです。

### 1. OS ごとにローカルビルド

- **Mac：** `npm run dist:mac` → `release/`（例：`HighlightClip-0.1.0-mac-arm64.dmg` など。アーキテクチャや設定により変化）。
- **Windows：** `npm run dist:win` → `release/`（NSIS とポータブル `zip`）。

Mac から Windows 用を作るには Wine などが必要になりがちで、**CI の利用を推奨**します。

### 2. GitHub Actions で両プラットフォーム

ワークフロー：`.github/workflows/build-desktop.yml`

- **手動：** リポジトリ → **Actions** → **Build desktop** → **Run workflow**。
- **タグ：** `v0.1.0` のような `v*` タグの push でも起動します。

`macos-latest` と `windows-latest` でジョブが走ります。各ジョブの **Artifacts**（`HighlightClip-macos` / `HighlightClip-windows`）から `release/` 以下のインストーラーと zip を取得できます。

### 成果物のファイル名

`package.json` の `build.artifactName`：`${productName}-${version}-${os}-${arch}.${ext}`。

### Windows インストーラ（NSIS）

ワンクリックインストールではなく、インストール先の変更が可能（`build.nsis`）。コード署名や macOS の公証は別途 `electron-builder` と証明書の設定が必要です。

## アイコンと未パッケージ版

- アプリアイコン：`build/icon.png`（1024×1024 以上の正方形 PNG を推奨）。`package.json` の `build.icon` が参照します。
- **メインプロセス**または **preload** 変更後は **Electron の再起動**が必要です。**React**：**`npm run dev` / VS Code「开发 (Vite 热更新)」** で **HMR**。**`npm start`** や `dist` のみの場合は `build`（または `vite build`）の後に再読み込み／再起動。
- `npm run pack` / `pack:mac` / `pack:win`：未パッケージのアプリディレクトリで中身を確認できます。

## プロジェクト構成（概要）

```
src/
  main/           # Electron メイン：IPC、ハイライトエンジン、千問パイプライン（qwen*）、レンダージョブ、ライブラリ
  preload/        # contextBridge API（esbuild バンドル）
  renderer/       # React エントリ、App、スタイル、Vite の index.html
  shared/         # IPC 定数と共有型
dist/             # ビルド出力（メイン、preload、レンダラー）
build/            # electron-builder 用アセット（例：icon.png）
```

メインエントリ：`dist/main/main.js`（`package.json` の `main`）。

### ウィンドウの読み込み（開発 / 本番）

- **`npm start` または `ELECTRON_RENDERER_URL` 未設定**：メインプロセスが **`loadFile`** で `dist/renderer/index.html`（静的ビルド）を開く。
- **`npm run dev` または VS Code「Electron: 开发 (Vite 热更新)」**：環境変数 **`ELECTRON_RENDERER_URL`**（例：`http://127.0.0.1:5173`）があると **`loadURL`** で Vite に接続。**preload** は引き続き `dist/preload/bundle.js`。

## 技術スタック

- Electron 33、TypeScript 5、React 19、Vite 5  
- 設定とライブラリの永続化に `electron-store`  
- Windows でも `ELECTRON_RENDERER_URL` を渡すための `cross-env`  
- 任意：通義千問（`fetch` で百錬の **OpenAI 互換** API、`dashscope.aliyuncs.com`）  
- `electron-builder` の設定は `package.json` の `build` を参照

## ライセンス

MIT（`package.json` の `license` フィールドを参照）。
