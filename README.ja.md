# HighlightClip

**Languages:** [简体中文](README.md) · [English](README.en.md) · [日本語](README.ja.md)

**ローカル動画ライブラリ**、**キーワード検索**、**自動ハイライト検出**、**FFmpeg による書き出し**を行うデスクトップアプリです。**Electron** ベースで、UI は **React + Vite** です。メインプロセスが解析・エンコード・ネイティブダイアログを担当し、レンダラーは **preload** が公開する **`window.api`** 経由で通信します。

## 機能概要

- **ライブラリ**：ローカル動画のインポート（複数選択）、タイトル／メモのメタデータ、タイトル・メモ・パスによる検索。
- **ハイライト解析**：目標総尺、最大セグメント数、ハイライト窓（1 クリップあたりの長さ）、シーン閾値、モーションサンプリングなどを設定可能。解析中は進捗と「解析中」表示。
- **書き出し**：検出された候補区間をつなげて MP4 出力（ラウドネス正規化、クリップ間クロスフェードはオプション）。
- **複数素材の結合**：複数チェック後、リスト順にそれぞれ解析して 1 本のリールに結合。
- **設定**：任意の `ffmpeg` / `ffprobe` パス。空欄なら依存パッケージ同梱のバイナリを使用（パッケージ時は `asarUnpack` 済み）。通常は **システムに FFmpeg を別途入れる必要はありません**。

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

- **開発**（メイン／レンダラー／preload をウォッチして Electron 起動）

  ```bash
  npm run dev
  ```

  初回で `wait-on` が成果物を待てない場合は、先に `npm run build` を 1 回実行してください。

## npm スクリプト

| コマンド | 説明 |
|----------|------|
| `npm run build` | メイン（`tsconfig.main.json`）コンパイル、Vite でレンダラー、静的ファイルコピー、esbuild で preload |
| `npm run build:renderer` | Vite のみ：`src/renderer` → `dist/renderer` |
| `npm run build:preload` | preload のみ → `dist/preload/bundle.js` |
| `npm run watch` | メイン／レンダラー／preload をウォッチ（Electron は起動しません） |
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
- **メインプロセス**の変更後は **Electron の再起動**が必要です。React のみの変更は `vite build --watch` で反映（起動方法による）。
- `npm run pack` / `pack:mac` / `pack:win`：未パッケージのアプリディレクトリで中身を確認できます。

## プロジェクト構成（概要）

```
src/
  main/           # Electron メイン：IPC、ハイライトエンジン、レンダージョブ、ライブラリ
  preload/        # contextBridge API（esbuild バンドル）
  renderer/       # React エントリ、App、スタイル、Vite の index.html
  shared/         # IPC 定数と共有型
dist/             # ビルド出力（メイン、preload、レンダラー）
build/            # electron-builder 用アセット（例：icon.png）
```

メインエントリ：`dist/main/main.js`（`package.json` の `main`）。ウィンドウは `dist/renderer/index.html` を読み込みます。

## 技術スタック

- Electron 33、TypeScript 5、React 19、Vite 5  
- 設定とライブラリの永続化に `electron-store`  
- `electron-builder` の設定は `package.json` の `build` を参照

## ライセンス

MIT（`package.json` の `license` フィールドを参照）。
