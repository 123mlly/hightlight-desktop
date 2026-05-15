import type { AnalyzeOptions, HighlightSegment } from "../shared/types";
import { getFfmpegPath } from "./ffmpegPaths";
import { analyzeHighlights } from "./highlightEngine";
import { ffprobeJson, type ProbeInfo } from "./probe";
import { qwenAudioHighlightsFromDashScope } from "./qwenAudioAnalyze";
import { qwenRerankSegments } from "./qwenRerank";
import { qwenTranscriptHighlightPipeline } from "./qwenTranscriptPipeline";
import type { AppSettings } from "./settingsStore";

type QwenMode = "none" | "rerank" | "audio" | "transcript";

function resolveQwenMode(s: AppSettings & { qwenRerankEnabled?: boolean }): QwenMode {
  const m = s.qwenHighlightMode;
  if (m === "rerank" || m === "audio" || m === "transcript") return m;
  if (s.qwenRerankEnabled === true) return "rerank";
  return "none";
}

/**
 * 单次素材高光：算法必选路径之一；在设置开启时可叠加千问重排、听音直出或「转字幕再选」。
 */
export async function computeHighlights(
  s: AppSettings,
  ffprobe: string,
  inputPath: string,
  opts: AnalyzeOptions,
  workTmpDir: string
): Promise<{ segments: HighlightSegment[]; durationSec: number }> {
  const mode = resolveQwenMode(s);
  const ffmpegOverride = s.ffmpegPath || undefined;
  const ffmpeg = getFfmpegPath(ffmpegOverride);

  let probeCache: ProbeInfo | null = null;
  const getProbe = async () => {
    if (!probeCache) probeCache = await ffprobeJson(ffprobe, inputPath);
    return probeCache;
  };

  if (mode === "transcript" && s.qwenApiKey?.trim()) {
    try {
      const probe = await getProbe();
      const segs = await qwenTranscriptHighlightPipeline({
        apiKey: s.qwenApiKey.trim(),
        audioModel: (s.qwenAudioModel || "qwen3-omni-flash").trim(),
        textModel: (s.qwenModel || "qwen3.6-plus").trim(),
        instruction: s.qwenInstruction || "",
        ffmpeg,
        inputPath,
        durationSec: probe.durationSec,
        hasAudio: probe.hasAudio,
        opts,
        tmpDir: workTmpDir,
      });
      if (segs.length > 0) {
        return { segments: segs, durationSec: probe.durationSec };
      }
    } catch (e) {
      console.error("[qwen transcript highlight]", e);
    }
  }

  if (mode === "audio" && s.qwenApiKey?.trim()) {
    try {
      const probe = await getProbe();
      const segs = await qwenAudioHighlightsFromDashScope({
        apiKey: s.qwenApiKey.trim(),
        model: (s.qwenAudioModel || "qwen3-omni-flash").trim(),
        instruction: s.qwenInstruction || "",
        ffmpeg,
        inputPath,
        durationSec: probe.durationSec,
        opts,
        tmpDir: workTmpDir,
      });
      if (segs.length > 0) {
        return { segments: segs, durationSec: probe.durationSec };
      }
    } catch (e) {
      console.error("[qwen audio highlight]", e);
    }
  }

  const raw = await analyzeHighlights(ffprobe, ffmpegOverride, inputPath, opts);
  let { segments } = raw;
  if (mode === "rerank" && s.qwenApiKey?.trim()) {
    segments = await qwenRerankSegments(segments, opts, {
      apiKey: s.qwenApiKey,
      model: (s.qwenModel || "qwen3.6-plus").trim(),
      instruction: s.qwenInstruction || "",
    });
  }
  return { segments, durationSec: raw.durationSec };
}
