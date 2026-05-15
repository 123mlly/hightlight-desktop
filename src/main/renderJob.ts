import { mkdirSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import path from "node:path";
import type { HighlightSegment, RenderOptions } from "../shared/types";
import { getFfmpegPath, runCmd } from "./ffmpegPaths";
import { ffprobeJson } from "./probe";

async function segmentDuration(
  ffprobePath: string,
  file: string
): Promise<number> {
  const p = await ffprobeJson(ffprobePath, file);
  return p.durationSec;
}

export type RenderCallbacks = {
  onProgress: (p: { phase: string; message: string; percent: number }) => void;
};

type SegmentAudioMode = "audio" | "none" | "silent";

async function encodeSegmentToMp4(
  ffmpeg: string,
  input: string,
  startSec: number,
  durationSec: number,
  outPath: string,
  mode: SegmentAudioMode
): Promise<void> {
  if (mode === "audio") {
    const r = await runCmd(ffmpeg, [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      input,
      "-ss",
      String(startSec),
      "-t",
      String(durationSec),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      outPath,
    ]);
    if (r.code !== 0) {
      throw new Error(`Segment encode failed: ${r.stderr}`);
    }
    return;
  }
  if (mode === "none") {
    const r = await runCmd(ffmpeg, [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      input,
      "-ss",
      String(startSec),
      "-t",
      String(durationSec),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-an",
      outPath,
    ]);
    if (r.code !== 0) {
      throw new Error(`Segment encode failed: ${r.stderr}`);
    }
    return;
  }
  const r = await runCmd(ffmpeg, [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    input,
    "-ss",
    String(startSec),
    "-t",
    String(durationSec),
    "-f",
    "lavfi",
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=48000",
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-shortest",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    outPath,
  ]);
  if (r.code !== 0) {
    throw new Error(`Segment encode failed: ${r.stderr}`);
  }
}

export type MultiSourceSlice = {
  inputPath: string;
  segments: HighlightSegment[];
  hasAudio: boolean;
};

async function mergeSegmentPathsToOutput(params: {
  ffmpeg: string;
  ffprobePath: string;
  segPaths: string[];
  jobId: string;
  tmpDir: string;
  render: RenderOptions;
  hasAudio: boolean;
  outputPath: string;
  onProgress: (p: { phase: string; message: string; percent: number }) => void;
}): Promise<{ mergedPath: string; finalPath: string; concatListPath: string | null }> {
  const mergedPath = path.join(params.tmpDir, `${params.jobId}_merged.mp4`);
  let concatListPath: string | null = null;

  if (params.render.useXfade && params.segPaths.length >= 2) {
    await xfadeMerge({
      ffmpeg: params.ffmpeg,
      ffprobePath: params.ffprobePath,
      segPaths: params.segPaths,
      mergedPath,
      xfadeSec: params.render.xfadeSec,
      hasAudio: params.hasAudio,
      onProgress: params.onProgress,
    });
  } else {
    concatListPath = path.join(params.tmpDir, `${params.jobId}_concat.txt`);
    const body = params.segPaths
      .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
      .join("\n");
    writeFileSync(concatListPath, body, "utf8");
    const r = await runCmd(params.ffmpeg, [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatListPath,
      "-c",
      "copy",
      mergedPath,
    ]);
    if (r.code !== 0) {
      throw new Error(`Concat failed: ${r.stderr}`);
    }
  }

  let finalPath = mergedPath;
  if (params.render.loudnorm && params.hasAudio) {
    const lnPath = path.join(params.tmpDir, `${params.jobId}_loudnorm.mp4`);
    params.onProgress({
      phase: "encode",
      message: "Loudness normalization",
      percent: 85,
    });
    const r = await runCmd(params.ffmpeg, [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      mergedPath,
      "-af",
      "loudnorm=I=-16:TP=-1.5:LRA=11",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      lnPath,
    ]);
    if (r.code !== 0) {
      throw new Error(`Loudnorm failed: ${r.stderr}`);
    }
    finalPath = lnPath;
  }

  params.onProgress({ phase: "encode", message: "Writing output", percent: 95 });
  const r = await runCmd(params.ffmpeg, [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    finalPath,
    "-c",
    "copy",
    params.outputPath,
  ]);
  if (r.code !== 0) {
    throw new Error(`Final copy failed: ${r.stderr}`);
  }

  return { mergedPath, finalPath, concatListPath };
}

function cleanupMergeTemps(
  segPaths: string[],
  concatListPath: string | null,
  mergedPath: string,
  finalPath: string,
  outputPath: string
): void {
  for (const p of segPaths) {
    try {
      if (existsSync(p)) unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
  if (concatListPath) {
    try {
      if (existsSync(concatListPath)) unlinkSync(concatListPath);
    } catch {
      /* ignore */
    }
  }
  for (const extra of [mergedPath, finalPath !== mergedPath ? finalPath : null]) {
    if (extra && existsSync(extra) && extra !== outputPath) {
      try {
        unlinkSync(extra);
      } catch {
        /* ignore */
      }
    }
  }
}

export async function renderHighlightReel(options: {
  ffmpegPath?: string;
  ffprobePath: string;
  input: string;
  segments: HighlightSegment[];
  outputPath: string;
  tmpDir: string;
  render: RenderOptions;
  hasAudio: boolean;
  callbacks: RenderCallbacks;
}): Promise<{ edlPath: string; jsonPath: string }> {
  const ffmpeg = getFfmpegPath(options.ffmpegPath);
  mkdirSync(options.tmpDir, { recursive: true });
  const jobId = `job_${Date.now()}`;
  const segPaths: string[] = [];

  options.callbacks.onProgress({
    phase: "encode",
    message: "Extracting segments",
    percent: 5,
  });

  const mode: SegmentAudioMode = options.hasAudio ? "audio" : "none";
  for (let i = 0; i < options.segments.length; i++) {
    const s = options.segments[i]!;
    const dur = s.endSec - s.startSec;
    const out = path.join(options.tmpDir, `${jobId}_seg_${i}.mp4`);
    await encodeSegmentToMp4(
      ffmpeg,
      options.input,
      s.startSec,
      dur,
      out,
      mode
    );
    segPaths.push(out);
    options.callbacks.onProgress({
      phase: "encode",
      message: `Segment ${i + 1}/${options.segments.length}`,
      percent: 5 + (70 * (i + 1)) / Math.max(1, options.segments.length),
    });
  }

  const { mergedPath, finalPath, concatListPath } = await mergeSegmentPathsToOutput({
    ffmpeg,
    ffprobePath: options.ffprobePath,
    segPaths,
    jobId,
    tmpDir: options.tmpDir,
    render: options.render,
    hasAudio: options.hasAudio,
    outputPath: options.outputPath,
    onProgress: options.callbacks.onProgress,
  });

  const edlPath = options.outputPath.replace(/\.[^/.]+$/, "") + ".edl";
  const jsonPath = options.outputPath.replace(/\.[^/.]+$/, "") + ".meta.json";
  writeEdl(edlPath, options.input, options.segments);
  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        source: options.input,
        segments: options.segments,
        hasAudio: options.hasAudio,
        loudnorm: options.render.loudnorm,
        xfade: options.render.useXfade,
      },
      null,
      2
    ),
    "utf8"
  );

  cleanupMergeTemps(segPaths, concatListPath, mergedPath, finalPath, options.outputPath);

  options.callbacks.onProgress({ phase: "done", message: "Done", percent: 100 });
  return { edlPath, jsonPath };
}

export async function renderMultiSourceReel(options: {
  ffmpegPath?: string;
  ffprobePath: string;
  sources: MultiSourceSlice[];
  outputPath: string;
  tmpDir: string;
  render: RenderOptions;
  callbacks: RenderCallbacks;
}): Promise<{ edlPath: string; jsonPath: string }> {
  const ffmpeg = getFfmpegPath(options.ffmpegPath);
  mkdirSync(options.tmpDir, { recursive: true });
  const jobId = `multi_${Date.now()}`;
  const segPaths: string[] = [];
  const multiFile = options.sources.length >= 2;
  const padSilent =
    multiFile && options.sources.some((s) => s.hasAudio);

  let segIndex = 0;
  const totalSegs = options.sources.reduce((n, s) => n + s.segments.length, 0);

  options.callbacks.onProgress({
    phase: "encode",
    message: "Extracting segments",
    percent: 5,
  });

  for (const src of options.sources) {
    const mode: SegmentAudioMode = src.hasAudio
      ? "audio"
      : padSilent
        ? "silent"
        : "none";
    for (const seg of src.segments) {
      const dur = seg.endSec - seg.startSec;
      const out = path.join(options.tmpDir, `${jobId}_seg_${segIndex}.mp4`);
      await encodeSegmentToMp4(
        ffmpeg,
        src.inputPath,
        seg.startSec,
        dur,
        out,
        mode
      );
      segPaths.push(out);
      segIndex++;
      options.callbacks.onProgress({
        phase: "encode",
        message: `片段 ${segIndex}/${totalSegs}`,
        percent: 5 + (70 * segIndex) / Math.max(1, totalSegs),
      });
    }
  }

  const hasAudioMerge =
    options.sources.some((s) => s.hasAudio) ||
    (padSilent && options.sources.some((s) => !s.hasAudio));

  const { mergedPath, finalPath, concatListPath } = await mergeSegmentPathsToOutput({
    ffmpeg,
    ffprobePath: options.ffprobePath,
    segPaths,
    jobId,
    tmpDir: options.tmpDir,
    render: options.render,
    hasAudio: hasAudioMerge,
    outputPath: options.outputPath,
    onProgress: options.callbacks.onProgress,
  });

  const edlPath = options.outputPath.replace(/\.[^/.]+$/, "") + ".edl";
  const jsonPath = options.outputPath.replace(/\.[^/.]+$/, "") + ".meta.json";
  writeEdlMulti(edlPath, options.sources);
  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        mode: "multi_source",
        sources: options.sources.map((s) => ({
          path: s.inputPath,
          segments: s.segments,
          hasAudio: s.hasAudio,
        })),
        loudnorm: options.render.loudnorm,
        xfade: options.render.useXfade,
      },
      null,
      2
    ),
    "utf8"
  );

  cleanupMergeTemps(segPaths, concatListPath, mergedPath, finalPath, options.outputPath);

  options.callbacks.onProgress({ phase: "done", message: "Done", percent: 100 });
  return { edlPath, jsonPath };
}

function writeEdl(
  edlPath: string,
  source: string,
  segments: HighlightSegment[]
): void {
  const lines: string[] = ["TITLE: HighlightClip", `FCM: NON-DROP FRAME`, ""];
  let seq = 1;
  for (const s of segments) {
    const start = formatEdlTime(s.startSec);
    const end = formatEdlTime(s.endSec);
    lines.push(
      `${String(seq).padStart(3, "0")}  AX       V     C        ${start} ${start} ${end} ${start}`
    );
    lines.push(`* FROM CLIP NAME: ${path.basename(source)}`);
    lines.push(`* SRC: ${source}`);
    lines.push(
      `* RANGE: ${s.startSec.toFixed(3)} - ${s.endSec.toFixed(3)} score=${s.score.toFixed(3)}`
    );
    lines.push("");
    seq++;
  }
  writeFileSync(edlPath, lines.join("\n"), "utf8");
}

function writeEdlMulti(edlPath: string, sources: MultiSourceSlice[]): void {
  const lines: string[] = ["TITLE: HighlightClip (multi)", `FCM: NON-DROP FRAME`, ""];
  let seq = 1;
  for (const src of sources) {
    for (const s of src.segments) {
      const start = formatEdlTime(s.startSec);
      const end = formatEdlTime(s.endSec);
      lines.push(
        `${String(seq).padStart(3, "0")}  AX       V     C        ${start} ${start} ${end} ${start}`
      );
      lines.push(`* FROM CLIP NAME: ${path.basename(src.inputPath)}`);
      lines.push(`* SRC: ${src.inputPath}`);
      lines.push(
        `* RANGE: ${s.startSec.toFixed(3)} - ${s.endSec.toFixed(3)} score=${s.score.toFixed(3)}`
      );
      lines.push("");
      seq++;
    }
  }
  writeFileSync(edlPath, lines.join("\n"), "utf8");
}

function formatEdlTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const f = Math.floor((s % 1) * 30);
  const S = Math.floor(s);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(S).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
}

async function xfadeMerge(params: {
  ffmpeg: string;
  ffprobePath: string;
  segPaths: string[];
  mergedPath: string;
  xfadeSec: number;
  hasAudio: boolean;
  onProgress: (p: { phase: string; message: string; percent: number }) => void;
}): Promise<void> {
  const durs: number[] = [];
  for (const p of params.segPaths) {
    durs.push(await segmentDuration(params.ffprobePath, p));
  }
  const fade = Math.min(params.xfadeSec, Math.min(...durs) * 0.4);
  const inputs: string[] = [];
  for (const p of params.segPaths) {
    inputs.push("-i", p);
  }
  let vLabel = "0:v";
  let aLabel = "0:a";
  let cum = durs[0]!;
  const parts: string[] = [];
  for (let i = 1; i < params.segPaths.length; i++) {
    const offset = Math.max(0, cum - fade);
    const outV = i === params.segPaths.length - 1 ? "vout" : `v${i}`;
    parts.push(
      `[${vLabel}][${i}:v]xfade=transition=fade:duration=${fade.toFixed(3)}:offset=${offset.toFixed(3)}[${outV}]`
    );
    vLabel = outV;
    if (params.hasAudio) {
      const outA = i === params.segPaths.length - 1 ? "aout" : `a${i}`;
      parts.push(
        `[${aLabel}][${i}:a]acrossfade=d=${fade.toFixed(3)}[${outA}]`
      );
      aLabel = outA;
    }
    cum = cum + durs[i]! - fade;
  }
  const fc = parts.join(";");
  const args = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    ...inputs,
    "-filter_complex",
    fc,
    "-map",
    "[vout]",
  ];
  if (params.hasAudio) {
    args.push("-map", "[aout]");
  }
  args.push(
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p"
  );
  if (params.hasAudio) {
    args.push("-c:a", "aac", "-b:a", "192k");
  }
  args.push(params.mergedPath);
  params.onProgress({ phase: "encode", message: "Crossfade merge", percent: 78 });
  const r = await runCmd(params.ffmpeg, args);
  if (r.code !== 0) {
    throw new Error(`Xfade merge failed: ${r.stderr}`);
  }
}
