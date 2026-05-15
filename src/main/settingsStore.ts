import type { LibraryItem } from "../shared/types";
import Store from "electron-store";

export type AppSettings = {
  targetDurationSec: number;
  maxSegments: number;
  segmentWindowSec: number;
  sceneThreshold: number;
  motionFps: number;
  motionScaleWidth: number;
  loudnorm: boolean;
  useXfade: boolean;
  xfadeSec: number;
  ffmpegPath: string;
  ffprobePath: string;
  /** 阿里云百炼 API Key（sk-…），用于通义千问；走兼容模式请求 dashscope.aliyuncs.com */
  qwenApiKey: string;
  /** 兼容模式文本模型，用于「重排」与字幕选段：如 qwen3.6-plus、qwen-turbo */
  qwenModel: string;
  /** none=仅算法；rerank=算法后千问重排；audio=听片头约 2 分钟直出；transcript=分块转写后文本模型选段 */
  qwenHighlightMode: "none" | "rerank" | "audio" | "transcript";
  /** 听音高光使用的多模态模型，如 qwen3-omni-flash */
  qwenAudioModel: string;
  /** 传给千问的额外中文偏好说明 */
  qwenInstruction: string;
  /** @deprecated 读取旧配置用，勿在新代码写入 */
  qwenRerankEnabled?: boolean;
};

const defaults: AppSettings = {
  targetDurationSec: 60,
  maxSegments: 8,
  segmentWindowSec: 2.5,
  sceneThreshold: 0.32,
  motionFps: 2,
  motionScaleWidth: 160,
  loudnorm: true,
  useXfade: false,
  xfadeSec: 0.45,
  ffmpegPath: "",
  ffprobePath: "",
  qwenApiKey: "",
  qwenModel: "qwen3.6-plus",
  qwenHighlightMode: "none",
  qwenAudioModel: "qwen3-omni-flash",
  qwenInstruction: "",
};

type StoreSchema = {
  settings: AppSettings;
  library: LibraryItem[];
};

export const settingsStore = new Store<StoreSchema>({
  defaults: {
    settings: { ...defaults },
    library: [],
  },
});

export function getSettings(): AppSettings {
  const raw = settingsStore.get("settings") as Record<string, unknown>;
  const migrated = { ...raw };
  if (
    migrated.qwenRerankEnabled === true &&
    (migrated.qwenHighlightMode === undefined || migrated.qwenHighlightMode === null)
  ) {
    migrated.qwenHighlightMode = "rerank";
  }
  return { ...defaults, ...migrated } as AppSettings;
}

export function setSettings(partial: Partial<AppSettings>): AppSettings {
  const cur = getSettings();
  const next = { ...cur, ...partial };
  settingsStore.set("settings", next);
  return next;
}
