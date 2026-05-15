import type { AnalyzeOptions, HighlightSegment } from "../shared/types";
import { getFfmpegPath, runCmd, runCmdBinary } from "./ffmpegPaths";
import { ffprobeJson } from "./probe";

const ANALYZE_MAX_SEC = 900;

function parseSceneTimes(stderr: string): number[] {
  const times: number[] = [];
  const re = /pts_time:([\d.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stderr)) !== null) {
    times.push(parseFloat(m[1]));
  }
  return times;
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.min(
    s.length - 1,
    Math.max(0, Math.floor((p / 100) * (s.length - 1)))
  );
  return s[idx] ?? 0;
}

function normalizeSeries(values: Float64Array): Float64Array {
  const copy = new Float64Array(values.length);
  const pos = Array.from(values).filter((v) => v > 0);
  const cap = percentile(pos, 95) || 1;
  for (let i = 0; i < values.length; i++) {
    copy[i] = Math.min(1, values[i] / cap);
  }
  return copy;
}

async function extractAudioRmsBins(
  ffmpeg: string,
  input: string,
  durationSec: number,
  binSec: number
): Promise<Float64Array> {
  const dur = Math.min(durationSec, ANALYZE_MAX_SEC);
  const { code, stdout, stderr } = await runCmdBinary(ffmpeg, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-t",
    String(dur),
    "-i",
    input,
    "-ac",
    "1",
    "-ar",
    "8000",
    "-f",
    "f32le",
    "-",
  ]);
  if (code !== 0) {
    throw new Error(`ffmpeg audio extract failed: ${stderr}`);
  }
  const buf = stdout;
  const nFloats = Math.floor(buf.byteLength / 4);
  const floats = new Float32Array(nFloats);
  for (let i = 0; i < nFloats; i++) {
    floats[i] = buf.readFloatLE(i * 4);
  }
  const bins = Math.max(1, Math.ceil(dur / binSec));
  const rms = new Float64Array(bins);
  const spb = Math.max(1, Math.floor(8000 * binSec));
  for (let b = 0; b < bins; b++) {
    const start = b * spb;
    const end = Math.min(floats.length, start + spb);
    if (start >= floats.length) break;
    let sum = 0;
    for (let i = start; i < end; i++) {
      const v = floats[i];
      sum += v * v;
    }
    rms[b] = Math.sqrt(sum / Math.max(1, end - start));
  }
  return rms;
}

async function extractMotionPerFrame(
  ffmpeg: string,
  input: string,
  durationSec: number,
  fps: number,
  scaleW: number,
  srcW: number,
  srcH: number
): Promise<{ times: Float64Array; motion: Float64Array }> {
  const dur = Math.min(durationSec, ANALYZE_MAX_SEC);
  const scaledH = Math.max(
    2,
    2 * Math.round(((srcH * scaleW) / Math.max(1, srcW)) / 2)
  );
  const frameSize = scaleW * scaledH;
  const vf = `fps=${fps},scale=${scaleW}:${scaledH},format=gray`;
  const { code, stdout, stderr } = await runCmdBinary(ffmpeg, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-t",
    String(dur),
    "-i",
    input,
    "-vf",
    vf,
    "-an",
    "-f",
    "rawvideo",
    "-",
  ]);
  if (code !== 0) {
    throw new Error(`ffmpeg motion extract failed: ${stderr}`);
  }
  const buf = stdout;
  const nFrames = Math.floor(buf.length / frameSize);
  const outLen = Math.max(0, nFrames - 1);
  const times = new Float64Array(outLen);
  const motion = new Float64Array(outLen);
  let prev = new Uint8Array(buf.subarray(0, frameSize));
  for (let i = 1; i < nFrames; i++) {
    const cur = new Uint8Array(buf.subarray(i * frameSize, (i + 1) * frameSize));
    let acc = 0;
    for (let j = 0; j < frameSize; j++) {
      acc += Math.abs(cur[j] - prev[j]);
    }
    motion[i - 1] = acc / frameSize / 255;
    times[i - 1] = i / fps;
    prev = cur;
  }
  return { times, motion };
}

async function detectSceneCuts(
  ffmpeg: string,
  input: string,
  durationSec: number,
  threshold: number
): Promise<number[]> {
  const dur = Math.min(durationSec, ANALYZE_MAX_SEC);
  const { code, stderr } = await runCmd(ffmpeg, [
    "-hide_banner",
    "-loglevel",
    "info",
    "-t",
    String(dur),
    "-i",
    input,
    "-filter:v",
    `select='gt(scene,${threshold})',showinfo`,
    "-f",
    "null",
    "-",
  ]);
  void code;
  return parseSceneTimes(stderr);
}

function valueAtTime(
  binSec: number,
  series: Float64Array,
  t: number
): number {
  const i = Math.floor(t / binSec);
  return series[Math.min(series.length - 1, Math.max(0, i))] ?? 0;
}

function motionMaxInRange(
  times: Float64Array,
  motionNorm: Float64Array,
  start: number,
  end: number
): number {
  let m = 0;
  for (let i = 0; i < times.length; i++) {
    const tt = times[i];
    if (tt >= start && tt <= end) m = Math.max(m, motionNorm[i] ?? 0);
  }
  return m;
}

function sceneScore(cuts: number[], start: number, end: number): number {
  let s = 0;
  for (const c of cuts) {
    if (c >= start && c <= end) s += 1;
  }
  return Math.min(1, s * 0.35);
}

function nmsSegments(
  candidates: HighlightSegment[],
  minGap: number
): HighlightSegment[] {
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const picked: HighlightSegment[] = [];
  for (const c of sorted) {
    const overlap = picked.some(
      (p) => !(c.endSec + minGap <= p.startSec || c.startSec - minGap >= p.endSec)
    );
    if (!overlap) picked.push(c);
  }
  return picked.sort((a, b) => a.startSec - b.startSec);
}

export async function analyzeHighlights(
  ffprobePath: string,
  ffmpegPathOverride: string | undefined,
  input: string,
  opts: AnalyzeOptions
): Promise<{ segments: HighlightSegment[]; durationSec: number }> {
  const ffmpeg = getFfmpegPath(ffmpegPathOverride);
  const probe = await ffprobeJson(ffprobePath, input);
  if (probe.durationSec <= 0) {
    throw new Error("Could not read media duration");
  }

  const binSec = 0.25;
  const [cuts, audioBins, motionData] = await Promise.all([
    detectSceneCuts(ffmpeg, input, probe.durationSec, opts.sceneThreshold),
    probe.hasAudio
      ? extractAudioRmsBins(ffmpeg, input, probe.durationSec, binSec)
      : new Float64Array(1),
    extractMotionPerFrame(
      ffmpeg,
      input,
      probe.durationSec,
      opts.motionFps,
      opts.motionScaleWidth,
      probe.width,
      probe.height
    ),
  ]);

  const audioNorm = probe.hasAudio
    ? normalizeSeries(audioBins)
    : new Float64Array(1);

  const motionNorm = normalizeSeries(motionData.motion);

  const winRaw = Number(opts.segmentWindowSec);
  const window = Math.min(
    120,
    Math.max(1.5, Number.isFinite(winRaw) ? winRaw : 2.5)
  );
  const step = Math.max(0.2, Math.min(1.2, window * 0.18));
  const nmsGap = Math.max(0.2, Math.min(1.5, window * 0.14));
  const candidates: HighlightSegment[] = [];
  const dur = Math.min(probe.durationSec, ANALYZE_MAX_SEC);
  for (let t = 0; t + window <= dur; t += step) {
    const start = t;
    const end = t + window;
    const a = valueAtTime(binSec, audioNorm, start + window / 2);
    const m = motionMaxInRange(
      motionData.times,
      motionNorm,
      start,
      end
    );
    const sc = sceneScore(cuts, start, end);
    const score = 0.45 * m + 0.4 * a + 0.25 * sc;
    candidates.push({
      startSec: start,
      endSec: end,
      score,
      motion: m,
      audio: a,
      scene: sc,
    });
  }

  const picked = nmsSegments(candidates, nmsGap);
  const byScore = [...picked].sort((a, b) => b.score - a.score);
  const chosen: HighlightSegment[] = [];
  let total = 0;
  for (const seg of byScore) {
    if (chosen.length >= opts.maxSegments) break;
    if (total + (seg.endSec - seg.startSec) > opts.targetDurationSec + 1e-6) {
      continue;
    }
    chosen.push(seg);
    total += seg.endSec - seg.startSec;
  }
  chosen.sort((a, b) => a.startSec - b.startSec);
  return { segments: chosen, durationSec: probe.durationSec };
}
