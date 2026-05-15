# HighlightClip

**Languages:** [简体中文](README.md) · [English](README.en.md) · [日本語](README.ja.md)

本地视频素材库 + 关键词筛选 + 自动高光分析 + FFmpeg 导出。桌面端基于 **Electron**，界面为 **React + Vite**，主进程负责分析、编码与文件对话框；渲染进程通过 **preload** 暴露的 `window.api` 与主进程通信。

## 功能概览

- **素材库**：导入本地视频（多选），标题 / 备注元数据，按标题、备注或路径搜索。
- **高光分析**：可配置目标总时长、最多片段数、高光窗长（单段时长）、场景阈值、运动采样等；分析时显示进度与「正在分析」状态。
- **导出成片**：按分析得到的候选片段拼接导出 MP4（可选响度归一、片段间交叉淡化）。
- **多素材合成**：勾选多条素材后按列表顺序分别分析高光，再合并为一条成片。
- **设置**：可指定自定义 `ffmpeg` / `ffprobe` 路径；留空则使用依赖内置的二进制（打包时已配置 `asarUnpack`）。默认**无需**在系统里单独安装 FFmpeg。

## 环境要求

- **Node.js** 18+（建议 LTS）
- **npm** 9+
- 依赖中的 `ffmpeg-static`、`@ffprobe-installer/ffprobe` 会提供对应平台的二进制；开发时 `npm install` 后即可使用。

## 安装与运行

```bash
npm install
```

- **一次性构建并启动应用**

  ```bash
  npm start
  ```

- **开发（监听主进程、渲染、preload 并启动 Electron）**

  ```bash
  npm run dev
  ```

  首次若 `wait-on` 未等到产物，可先执行一次 `npm run build`。

## 常用脚本

| 命令 | 说明 |
|------|------|
| `npm run build` | 编译主进程（`tsconfig.main.json`）、Vite 打包渲染进程、复制静态资源、esbuild 打包 preload |
| `npm run build:renderer` | 仅 Vite 构建 `src/renderer` → `dist/renderer` |
| `npm run build:preload` | 仅打包 preload → `dist/preload/bundle.js` |
| `npm run watch` | 主进程 / 渲染 / preload 监听构建（不自动拉起 Electron） |
| `npm run pack` | 构建后 `electron-builder --dir`（当前系统平台，未压缩目录） |
| `npm run dist` | 构建后打当前系统对应平台的安装包（输出在 `release/`） |
| `npm run dist:mac` | 仅在 **macOS** 上打 mac 包（`dmg` + `zip`） |
| `npm run dist:win` | 仅在 **Windows** 上打 Windows 包（`nsis` 安装程序 + `zip`） |
| `npm run pack:mac` / `pack:win` | 对应平台 `--dir` 解包目录，便于快速验证 |

## 打包 macOS / Windows

**说明**：`electron-builder` 在**本机默认只打当前操作系统**的安装包（例如在 Mac 上执行 `npm run dist` 只会得到 Mac 产物）。要同时拿到 **mac + win** 的安装包，常见做法是下面两种之一。

### 1. 本机分别打包

- 在 **Mac** 上：`npm run dist:mac`，产物在 `release/`（如 `HighlightClip-0.1.0-mac-arm64.dmg` 等，随架构与配置变化）。
- 在 **Windows** 上：`npm run dist:win`，产物在 `release/`（如 NSIS 安装包与便携 `zip`）。

在 Mac 上强行打 Windows 包需要额外环境（如 Wine），一般不推荐；用 CI 更省事。

### 2. GitHub Actions 一次产出双平台

已配置工作流 `.github/workflows/build-desktop.yml`：

- **手动运行**：仓库 → **Actions** → **Build desktop** → **Run workflow**。
- **打 tag 推送**：推送符合 `v*` 的标签（例如 `v0.1.0`）也会触发。

两个 Job 分别跑在 `macos-latest` 与 `windows-latest`，构建完成后在对应 Job 里下载 **Artifacts**（`HighlightClip-macos` / `HighlightClip-windows`），内含 `release/` 目录下的安装包与压缩包。

### 产物命名

`package.json` 中 `build.artifactName` 为：`${productName}-${version}-${os}-${arch}.${ext}`，便于区分平台与架构。

### Windows 安装程序

使用 NSIS：**非一键安装**，可改安装目录（见 `build.nsis`）。若需代码签名 / macOS 公证，需在 `electron-builder` 的 `mac` / `win` 下另行配置证书环境。

## 图标与本地调试包

- 应用图标：`build/icon.png`（建议 ≥1024×1024 方形 PNG）。`package.json` 的 `build.icon` 已指向该文件。
- 修改**主进程**逻辑后需**重启 Electron** 才会生效；仅改 React 时由 `vite build --watch` 刷新即可（视启动方式而定）。
- `npm run pack` / `pack:mac` / `pack:win`：生成未封装的应用目录，便于本地验证安装包内容。

## 项目结构（简要）

```
src/
  main/           # Electron 主进程：IPC、高光引擎、渲染任务、素材库
  preload/        # contextBridge 暴露 API（经 esbuild 打 bundle）
  renderer/       # React 入口、App、样式、Vite 用 index.html
  shared/         # IPC 常量、与前后端共用的类型
dist/             # 构建产物（主进程、preload、渲染）
build/            # 应用图标等 electron-builder 资源（如 icon.png）
```

主进程入口：`dist/main/main.js`（由 `package.json` 的 `main` 指定）。窗口加载 `dist/renderer/index.html`。

## 技术栈

- Electron 33、TypeScript 5、React 19、Vite 5  
- `electron-store` 持久化设置与素材库列表  
- `electron-builder` 分发配置见 `package.json` → `build`

## 许可证

MIT（见 `package.json` 中 `license` 字段）。
