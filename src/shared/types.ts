export type LibraryItem = {
  id: string;
  path: string;
  title: string;
  notes: string;
  addedAt: number;
};

export type HighlightSegment = {
  startSec: number;
  endSec: number;
  score: number;
  motion: number;
  audio: number;
  scene: number;
};

export type AnalyzeOptions = {
  targetDurationSec: number;
  maxSegments: number;
  /** 每个高光候选片段的时长（秒），越大单段越长 */
  segmentWindowSec: number;
  sceneThreshold: number;
  motionFps: number;
  motionScaleWidth: number;
};

export type RenderOptions = {
  outputPath: string;
  useXfade: boolean;
  xfadeSec: number;
  loudnorm: boolean;
};

export type RenderProgress = {
  jobId: string;
  phase: "probe" | "analyze" | "encode" | "done" | "error";
  message: string;
  percent: number;
};

export type CompileReelPayload = {
  jobId: string;
  paths: string[];
  analyzeOptions: AnalyzeOptions;
  render: RenderOptions;
  outputPath: string;
};
