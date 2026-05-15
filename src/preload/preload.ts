import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "../shared/ipc";
import type {
  AnalyzeOptions,
  CompileReelPayload,
  HighlightSegment,
  LibraryItem,
  RenderOptions,
} from "../shared/types";

const api = {
  libraryList: (): Promise<LibraryItem[]> => ipcRenderer.invoke(IPC.LIBRARY_LIST),
  libraryAdd: (): Promise<LibraryItem[]> => ipcRenderer.invoke(IPC.LIBRARY_ADD),
  libraryRemove: (id: string): Promise<void> =>
    ipcRenderer.invoke(IPC.LIBRARY_REMOVE, id),
  libraryUpdateMeta: (
    id: string,
    patch: Partial<Pick<LibraryItem, "title" | "notes">>
  ): Promise<LibraryItem | null> =>
    ipcRenderer.invoke(IPC.LIBRARY_UPDATE_META, id, patch),
  librarySearch: (q: string): Promise<LibraryItem[]> =>
    ipcRenderer.invoke(IPC.LIBRARY_SEARCH, q),
  settingsGet: () => ipcRenderer.invoke(IPC.SETTINGS_GET),
  settingsSet: (partial: Record<string, unknown>) =>
    ipcRenderer.invoke(IPC.SETTINGS_SET, partial),
  pickFile: (): Promise<string | null> => ipcRenderer.invoke(IPC.PICK_FILE),
  pickSave: (): Promise<string | null> => ipcRenderer.invoke(IPC.PICK_SAVE),
  analyze: (
    inputPath: string,
    options: AnalyzeOptions
  ): Promise<{ segments: HighlightSegment[]; durationSec: number }> =>
    ipcRenderer.invoke(IPC.ANALYZE, { inputPath, options }),
  render: (payload: {
    jobId: string;
    inputPath: string;
    segments: HighlightSegment[];
    outputPath: string;
    render: RenderOptions;
  }): Promise<{ edlPath: string; jsonPath: string }> =>
    ipcRenderer.invoke(IPC.RENDER, payload),
  compileReel: (
    payload: CompileReelPayload
  ): Promise<{ edlPath: string; jsonPath: string }> =>
    ipcRenderer.invoke(IPC.COMPILE_REEL, payload),
  onRenderProgress: (
    cb: (p: {
      jobId: string;
      phase: string;
      message: string;
      percent: number;
    }) => void
  ): (() => void) => {
    const listener = (
      _e: Electron.IpcRendererEvent,
      p: { jobId: string; phase: string; message: string; percent: number }
    ) => cb(p);
    ipcRenderer.on(IPC.RENDER_PROGRESS, listener);
    return () => {
      ipcRenderer.removeListener(IPC.RENDER_PROGRESS, listener);
    };
  },
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke("shell:openExternal", url),
};

contextBridge.exposeInMainWorld("api", api);

export type DesktopApi = typeof api;

declare global {
  interface Window {
    api: DesktopApi;
  }
}

export {};
