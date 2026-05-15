import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from "electron";
import { IPC } from "../shared/ipc";
import type {
  AnalyzeOptions,
  CompileReelPayload,
  HighlightSegment,
  LibraryItem,
  RenderOptions,
} from "../shared/types";
import { getFfprobePath, tmpDir } from "./ffmpegPaths";
import {
  libraryAdd,
  libraryList,
  libraryRemove,
  librarySearch,
  libraryUpdateMeta,
} from "./library";
import { JobQueue } from "./jobQueue";
import { ffprobeJson } from "./probe";
import { renderHighlightReel, renderMultiSourceReel, type MultiSourceSlice } from "./renderJob";
import { computeHighlights } from "./highlightPipeline";
import { getSettings, setSettings } from "./settingsStore";

const queue = new JobQueue();

function resolveWindowIcon(): string | undefined {
  const fromDistMain = path.join(__dirname, "../../build/icon.png");
  if (existsSync(fromDistMain)) return fromDistMain;
  const fromApp = path.join(app.getAppPath(), "build", "icon.png");
  if (existsSync(fromApp)) return fromApp;
  return undefined;
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1120,
    height: 780,
    icon: resolveWindowIcon(),
    webPreferences: {
      preload: path.join(__dirname, "../preload/bundle.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const rendererUrl = process.env.ELECTRON_RENDERER_URL?.trim();
  if (rendererUrl) {
    void win.loadURL(rendererUrl);
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  return win;
}

app.whenReady().then(() => {
  mkdirSync(tmpDir(), { recursive: true });
  const iconPath = resolveWindowIcon();
  if (iconPath && process.platform === "darwin") {
    try {
      app.dock.setIcon(nativeImage.createFromPath(iconPath));
    } catch {
      /* ignore invalid icon */
    }
  }
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

function broadcastProgress(
  win: BrowserWindow | null,
  payload: { jobId: string; phase: string; message: string; percent: number }
): void {
  win?.webContents.send(IPC.RENDER_PROGRESS, payload);
}

ipcMain.handle(IPC.LIBRARY_LIST, (): LibraryItem[] => libraryList());

ipcMain.handle(IPC.LIBRARY_ADD, async (): Promise<LibraryItem[]> => {
  const r = await dialog.showOpenDialog({
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Video", extensions: ["mp4", "mov", "mkv", "webm", "m4v"] }],
  });
  if (r.canceled || r.filePaths.length === 0) return [];
  return r.filePaths.map((p) => libraryAdd(p));
});

ipcMain.handle(
  IPC.LIBRARY_REMOVE,
  (_e, id: string): void => {
    libraryRemove(id);
  }
);

ipcMain.handle(
  IPC.LIBRARY_UPDATE_META,
  (_e, id: string, patch: Partial<Pick<LibraryItem, "title" | "notes">>) => {
    return libraryUpdateMeta(id, patch);
  }
);

ipcMain.handle(
  IPC.LIBRARY_SEARCH,
  (_e, query: string): LibraryItem[] => librarySearch(query)
);

ipcMain.handle(IPC.SETTINGS_GET, () => getSettings());

ipcMain.handle(IPC.SETTINGS_SET, (_e, partial: Record<string, unknown>) => {
  return setSettings(partial as Parameters<typeof setSettings>[0]);
});

ipcMain.handle(IPC.PICK_FILE, async (): Promise<string | null> => {
  const r = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "Video", extensions: ["mp4", "mov", "mkv", "webm", "m4v"] }],
  });
  if (r.canceled || r.filePaths.length === 0) return null;
  return r.filePaths[0] ?? null;
});

ipcMain.handle(IPC.PICK_SAVE, async (): Promise<string | null> => {
  const r = await dialog.showSaveDialog({
    defaultPath: "highlight_reel.mp4",
    filters: [{ name: "MP4", extensions: ["mp4"] }],
  });
  if (r.canceled || !r.filePath) return null;
  return r.filePath;
});

ipcMain.handle(
  IPC.ANALYZE,
  async (
    _e,
    payload: { inputPath: string; options: AnalyzeOptions }
  ): Promise<{ segments: HighlightSegment[]; durationSec: number }> => {
    const s = getSettings();
    const ffprobe = getFfprobePath(s.ffprobePath || undefined);
    return computeHighlights(s, ffprobe, payload.inputPath, payload.options, tmpDir());
  }
);

ipcMain.handle(
  IPC.COMPILE_REEL,
  async (
    event,
    payload: CompileReelPayload
  ): Promise<{ edlPath: string; jsonPath: string }> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const s = getSettings();
    const ffprobe = getFfprobePath(s.ffprobePath || undefined);
    const ffmpegO = s.ffmpegPath || undefined;
    const n = payload.paths.length;
    if (n === 0) {
      throw new Error("请至少选择一个素材");
    }
    const perDur = Math.max(5, payload.analyzeOptions.targetDurationSec / n);
    const perSeg = Math.max(1, Math.ceil(payload.analyzeOptions.maxSegments / n));
    const perOpts: AnalyzeOptions = {
      ...payload.analyzeOptions,
      targetDurationSec: perDur,
      maxSegments: perSeg,
    };

    const sources: MultiSourceSlice[] = [];
    for (let pi = 0; pi < payload.paths.length; pi++) {
      const p = payload.paths[pi]!;
      broadcastProgress(win ?? null, {
        jobId: payload.jobId,
        phase: "analyze",
        message: `分析素材 ${pi + 1}/${n}`,
        percent: Math.round((pi / n) * 48),
      });
      let { segments } = await computeHighlights(s, ffprobe, p, perOpts, tmpDir());
      const probe = await ffprobeJson(ffprobe, p);
      if (segments.length > 0) {
        sources.push({ inputPath: p, segments, hasAudio: probe.hasAudio });
      }
    }
    if (sources.length === 0) {
      throw new Error("所选素材均未得到高光片段，请调低阈值或延长目标时长后重试");
    }

    broadcastProgress(win ?? null, {
      jobId: payload.jobId,
      phase: "analyze",
      message: "分析完成，开始编码",
      percent: 50,
    });

    return queue.enqueue(() =>
      renderMultiSourceReel({
        ffmpegPath: ffmpegO,
        ffprobePath: ffprobe,
        sources,
        outputPath: payload.outputPath,
        tmpDir: tmpDir(),
        render: payload.render,
        callbacks: {
          onProgress: (prog) => {
            broadcastProgress(win ?? null, {
              jobId: payload.jobId,
              phase: prog.phase,
              message: prog.message,
              percent: Math.min(100, 50 + Math.round(prog.percent * 0.5)),
            });
          },
        },
      })
    );
  }
);

ipcMain.handle(
  IPC.RENDER,
  async (
    event,
    payload: {
      jobId: string;
      inputPath: string;
      segments: HighlightSegment[];
      outputPath: string;
      render: RenderOptions;
    }
  ): Promise<{ edlPath: string; jsonPath: string }> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const s = getSettings();
    const ffprobe = getFfprobePath(s.ffprobePath || undefined);
    const probe = await ffprobeJson(ffprobe, payload.inputPath);
    return queue.enqueue(() =>
      renderHighlightReel({
        ffmpegPath: s.ffmpegPath || undefined,
        ffprobePath: ffprobe,
        input: payload.inputPath,
        segments: payload.segments,
        outputPath: payload.outputPath,
        tmpDir: tmpDir(),
        render: payload.render,
        hasAudio: probe.hasAudio,
        callbacks: {
          onProgress: (p) => {
            broadcastProgress(win ?? null, {
              jobId: payload.jobId,
              phase: p.phase,
              message: p.message,
              percent: p.percent,
            });
          },
        },
      })
    );
  }
);

ipcMain.handle("shell:openExternal", async (_e, url: string) => {
  if (typeof url !== "string" || !/^https:\/\//i.test(url)) {
    throw new Error("Only https URLs are allowed");
  }
  await shell.openExternal(url);
});
