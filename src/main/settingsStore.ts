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
  const s = settingsStore.get("settings");
  return { ...defaults, ...s };
}

export function setSettings(partial: Partial<AppSettings>): AppSettings {
  const cur = getSettings();
  const next = { ...cur, ...partial };
  settingsStore.set("settings", next);
  return next;
}
