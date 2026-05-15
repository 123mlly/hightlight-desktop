# HighlightClip

**Languages:** [简体中文](README.md) · [English](README.en.md) · [日本語](README.ja.md)

本地视频素材库 + 关键词筛选 + 自动高光分析 + FFmpeg 导出。桌面端基于 **Electron**，界面为 **React + Vite**，主进程负责分析、编码与文件对话框；渲染进程通过 **preload** 暴露的 `window.api` 与主进程通信。

## 功能概览

- **素材库**：导入本地视频（多选），标题 / 备注元数据，按标题、备注或路径搜索。
- **高光分析**：可配置目标总时长、最多片段数、高光窗长（单段时长）、场景阈值、运动采样等；分析时显示进度与「正在分析」状态。
- **导出成片**：按分析得到的候选片段拼接导出 MP4（可选响度归一、片段间交叉淡化）。
- **多素材合成**：勾选多条素材后按列表顺序分别分析高光，再合并为一条成片。
- **设置**：可指定自定义 `ffmpeg` / `ffprobe` 路径；留空则使用依赖内置的二进制（打包时已配置 `asarUnpack`）。默认**无需**在系统里单独安装 FFmpeg。
- **通义千问（可选）**：在设置中配置 **[阿里云百炼](https://bailian.console.aliyun.com/)** 的 API Key（`sk-…`）后，可选用「仅算法」「算法 + 文本重排」「听音直出」「先转字幕再选」等高光策略；**实际裁切与导出仍由本地 FFmpeg 完成**。详见下文。

## 通义千问（阿里云百炼，可选）

在应用内 **设置 → 通义千问（阿里云百炼）** 填写 **百炼 API Key**（`sk-…`，在[百炼控制台](https://bailian.console.aliyun.com/)创建）。密钥由 `electron-store` 保存在本机，**勿**将 Key 写入仓库或截图外泄。

应用使用百炼提供的 **OpenAI 兼容模式**，请求地址为：

`https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`

（与控制台申请的密钥对应；**无需**再单独使用「灵积」控制台。）

### 高光分析方式（设置中单选）

| 模式 | 行为概要 |
|------|----------|
| **仅本地算法** | 基于 FFmpeg 侧的运动、音量、镜头切换等启发式打分，**不联网**。 |
| **算法 + 千问文本重排** | 先有本地算法候选时间段，再用**文本模型**对片段做重排 / 筛选。 |
| **千问听音直出** | **多模态模型**直接听片头**约 2 分钟**内导出的 WAV，返回高光时间段；失败则回退本地算法。 |
| **先转字幕再选** | 本地按约 **48s** 分块用 FFmpeg 导出 WAV，多模态模型逐块**听写带时间轴的字幕**，再由**文本模型**根据合并字幕选出高光段；**转写最多覆盖前约 14 分钟**（更长视频后半段不参与转写）；失败则回退本地算法。 |

### 模型字段（设置中可改）

- **文本模型**（默认 `qwen3.6-plus`）：用于「重排」以及「先转字幕再选」的**选段**。
- **听音多模态模型**（默认 `qwen3-omni-flash`）：用于「听音直出」和「字幕再选」里的**分块听写**（请求中的 `input_audio`）。

具体可用型号与计费以 **[阿里云百炼](https://help.aliyun.com/zh/model-studio/)** 文档为准。

### 隐私与数据流

- **切片、转码、成片导出**：始终针对**本机路径**上的素材，由本地 **FFmpeg** 执行。
- **调用千问**：仅将接口所需内容（例如分段 WAV 的 Base64、字幕与候选列表等文本）经 **HTTPS** 发往上述百炼兼容域名；**不会**把整片视频做成公网 URL 再上传（与部分「文件 URL 识别」类 ASR 不同）。

修改**主进程**逻辑后需**重启 Electron** 后再做高光分析，改动才会生效。

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

- **开发（Vite 开发服务器 + React HMR；同时 watch 主进程与 preload 并启动 Electron）**

  ```bash
  npm run dev
  ```

  窗口会加载 `http://127.0.0.1:5173`，修改 `src/renderer`（如 `App.tsx`）后由 **Vite 热更新**，一般无需手动刷新。`npm start` 仍使用打包后的 `dist/renderer`（`loadFile`），**没有**热更新。

  首次若 `wait-on` 未等到产物，可先执行一次 `npm run build`。

### VS Code 调试（`.vscode/launch.json`）

| 配置名称 | 说明 |
|----------|------|
| **Electron: 开发 (Vite 热更新)** | 预任务依次执行 `dev:compile-once`（主进程 + preload）并后台启动 **Vite**；启动 Electron 时设置 `ELECTRON_RENDERER_URL=http://127.0.0.1:5173`，**React / `App.tsx` 可热更新**。 |
| **Electron: 主进程 (静态 dist，无热更新)** | 预任务为完整 `npm run build`，再用 `loadFile` 读 `dist`，**无 HMR**。 |
| **Electron: 主进程 (仅构建渲染)** | 预任务 **`npm: build:renderer`**（即 VS Code 里名为 `npm: build:renderer` 的任务）= 终端执行 `npm run build:renderer`，只把 `src/renderer` 打成 `dist/renderer`，**仍无热更新**，适合只验证打包后的界面且想略过主进程编译时。 |
| **Electron: 主进程 (不执行 build)** | 不跑预任务；需已存在可用的 `dist/`，常与终端里另开的 `npm run dev` / `vite` 配合使用。 |
| **Electron: 附加到渲染进程** | Chrome 调试器附加到 `--remote-debugging-port=9223`，用于在 VS Code 里对渲染层断点（需先已用上述任一带该端口的配置启动 Electron）。 |

请在运行和调试下拉里优先选 **「Electron: 开发 (Vite 热更新)」** 以调试界面。停止调试后若 **5173** 仍被占用，在终端面板结束残留 Vite 或关闭对应终端。预任务链见 **`.vscode/tasks.json`**（如 `electron-dev: compile + vite`、`vite: dev server`）。

## 常用脚本

| 命令 | 说明 |
|------|------|
| `npm run build` | 编译主进程（`tsconfig.main.json`）、Vite 打包渲染进程、复制静态资源、esbuild 打包 preload |
| `npm run build:renderer` | 仅 Vite **生产构建** `src/renderer` → `dist/renderer`（无开发服、无 HMR） |
| `npm run build:preload` | 仅 esbuild 打包 preload → `dist/preload/bundle.js` |
| `npm run copy:static` | 将 `static/` 复制到 `dist/static`（由 `build` 调用） |
| `npm run watch` | 主进程 `tsc -w` + `vite build --watch` + preload watch（**不**启动 Electron） |
| `npm run dev` | 开发：`vite` 开发服（HMR）+ 主进程与 preload watch + `cross-env` 设置 `ELECTRON_RENDERER_URL` 后启动 Electron |
| `npm run vite:dev` | 仅启动 Vite 开发服（默认 `http://127.0.0.1:5173`）；一般不必单独执行，除非自行配合 Electron |
| `npm run dev:compile-once` | 一次性编译主进程 + preload（VS Code「开发 (Vite)」预任务等使用） |
| `npm start` | 全量 `build` 后以静态 `dist/renderer` 启动（无 HMR） |
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
- 修改**主进程**或 **preload** 后需**重启 Electron**。改 **React**：用 **`npm run dev` / VS Code「开发 (Vite 热更新)」** 时为 **HMR**；用 **`npm start`** 或只依赖 `dist` 时，需重新 `build`（或 `vite build`）后再刷新或重启窗口。
- `npm run pack` / `pack:mac` / `pack:win`：生成未封装的应用目录，便于本地验证安装包内容。

## 项目结构（简要）

```
src/
  main/           # Electron 主进程：IPC、高光引擎、千问管线（qwen*）、渲染任务、素材库
  preload/        # contextBridge 暴露 API（经 esbuild 打 bundle）
  renderer/       # React 入口、App、样式、Vite 用 index.html
  shared/         # IPC 常量、与前后端共用的类型
dist/             # 构建产物（主进程、preload、渲染）
build/            # 应用图标等 electron-builder 资源（如 icon.png）
```

主进程入口：`dist/main/main.js`（由 `package.json` 的 `main` 指定）。

### 窗口加载（开发 / 生产）

- **`npm start` 或未设置 `ELECTRON_RENDERER_URL`**：主进程使用 **`loadFile`** 打开 `dist/renderer/index.html`（静态打包结果）。
- **`npm run dev` 或 VS Code「Electron: 开发 (Vite 热更新)」**：若设置了环境变量 **`ELECTRON_RENDERER_URL`**（如 `http://127.0.0.1:5173`），则使用 **`loadURL`** 连接 Vite 开发服；**preload** 仍从 `dist/preload/bundle.js` 注入。

## 技术栈

- Electron 33、TypeScript 5、React 19、Vite 5  
- `electron-store` 持久化设置与素材库列表  
- `cross-env`：在 Windows 上为 `npm run dev` 注入 `ELECTRON_RENDERER_URL`  
- 可选：通义千问（`fetch` 调用百炼 **OpenAI 兼容**接口，`dashscope.aliyuncs.com`）  
- `electron-builder` 分发配置见 `package.json` → `build`

## 许可证

MIT（见 `package.json` 中 `license` 字段）。
