import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import type { AnalyzeOptions, HighlightSegment } from "../shared/types";
import { runCmd } from "./ffmpegPaths";

const DASHSCOPE_COMPAT_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

/** 每段 WAV 时长（秒），控制单次多模态请求体积 */
const TRANSCRIBE_CHUNK_SEC = 48;
/** 字幕模式最多覆盖的视频时长（秒），避免过长视频请求过多 */
const TRANSCRIPT_MAX_COVER_SEC = 14 * 60;
/** 转写阶段最多块数 */
const MAX_TRANSCRIBE_CHUNKS = 20;
/** 送给「选段」模型的字幕文本上限（字符） */
const MAX_TRANSCRIPT_CHARS = 18_000;

export type QwenTranscriptParams = {
  apiKey: string;
  /** 多模态转写用 */
  audioModel: string;
  /** 文本选段用 */
  textModel: string;
  instruction: string;
  ffmpeg: string;
  inputPath: string;
  durationSec: number;
  hasAudio: boolean;
  opts: Pick<AnalyzeOptions, "maxSegments" | "targetDurationSec" | "segmentWindowSec">;
  tmpDir: string;
};

type Utterance = { startSec: number; endSec: number; text: string };

function extractJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const tryParse = (s: string) => JSON.parse(s) as Record<string, unknown>;
  try {
    return tryParse(trimmed);
  } catch {
    const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
    if (fence) {
      try {
        return tryParse(fence[1]!.trim());
      } catch {
        /* */
      }
    }
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return tryParse(trimmed.slice(start, end + 1));
    }
  }
  throw new Error("响应中未找到有效 JSON");
}

function messageContentToString(data: Record<string, unknown>): string {
  const choices = data.choices as unknown;
  const first =
    Array.isArray(choices) && choices.length > 0
      ? (choices[0] as Record<string, unknown>)
      : null;
  const msg = first?.message as Record<string, unknown> | undefined;
  if (typeof msg?.content === "string") return msg.content;
  if (Array.isArray(msg?.content)) {
    const parts = msg!.content as { type?: string; text?: string }[];
    return parts
      .filter((x) => x && x.type === "text" && typeof x.text === "string")
      .map((x) => x.text!)
      .join("\n");
  }
  return "";
}

async function dashscopeCompatChat(
  apiKey: string,
  body: Record<string, unknown>,
  timeoutMs: number
): Promise<string> {
  const res = await fetch(DASHSCOPE_COMPAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const rawText = await res.text();
  if (!res.ok) {
    throw new Error(
      `百炼接口请求失败 HTTP ${res.status}: ${rawText.slice(0, 800)}`
    );
  }
  const data = JSON.parse(rawText) as Record<string, unknown>;
  const content = messageContentToString(data);
  if (!content) throw new Error("模型未返回文本内容");
  return content;
}

function parseChunkUtterances(
  parsed: Record<string, unknown>,
  chunkT0: number,
  chunkDur: number
): Utterance[] {
  const raw =
    (parsed.utterances as unknown) ??
    (parsed.items as unknown) ??
    (parsed.lines as unknown);
  if (!Array.isArray(raw)) return [];
  const out: Utterance[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const rs = Number(o.start ?? o.start_sec ?? o.t0 ?? o.startSec ?? o.begin);
    const re = Number(o.end ?? o.end_sec ?? o.t1 ?? o.endSec ?? o.finish);
    const text = String(o.text ?? o.content ?? "").trim();
    if (!Number.isFinite(rs) || !Number.isFinite(re) || re <= rs + 0.05 || !text)
      continue;
    const loc0 = Math.max(0, Math.min(chunkDur, rs));
    const loc1 = Math.max(0, Math.min(chunkDur, re));
    if (loc1 <= loc0 + 0.05) continue;
    out.push({
      startSec: chunkT0 + loc0,
      endSec: chunkT0 + loc1,
      text,
    });
  }
  return out;
}

async function transcribeChunkWav(
  apiKey: string,
  audioModel: string,
  wavPath: string,
  chunkT0: number,
  chunkDur: number
): Promise<Utterance[]> {
  const buf = await readFile(wavPath);
  const b64 = buf.toString("base64");
  const prompt = `请听写下面这段 WAV 音频。该音频对应整段视频中的 [${chunkT0.toFixed(2)}s, ${(chunkT0 + chunkDur).toFixed(2)}s] 区间；你在 JSON 里给出的时间必须相对于**本段音频起点**（即从 0 到约 ${chunkDur.toFixed(1)} 秒）。
只输出一个 JSON 对象，不要其它文字，格式：
{"utterances":[{"start":数字,"end":数字,"text":"字幕文本"}, ...]}
要求：0 <= start < end <= ${chunkDur.toFixed(2)}；每行尽量是一句完整话；不要编造听不见的内容。`;

  const content = await dashscopeCompatChat(
    apiKey,
    {
      model: audioModel,
      temperature: 0,
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "input_audio",
              input_audio: { data: b64, format: "wav" },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
    },
    120_000
  );
  try {
    const parsed = extractJsonObject(content);
    return parseChunkUtterances(parsed, chunkT0, chunkDur);
  } catch {
    return [];
  }
}

function buildTranscriptForPicker(utterances: Utterance[]): string {
  const sorted = [...utterances].sort((a, b) => a.startSec - b.startSec);
  const lines = sorted.map(
    (u) =>
      `[${u.startSec.toFixed(2)}–${u.endSec.toFixed(2)}] ${u.text.replace(/\s+/g, " ")}`
  );
  let doc = lines.join("\n");
  if (doc.length > MAX_TRANSCRIPT_CHARS) {
    const head = Math.floor(MAX_TRANSCRIPT_CHARS * 0.55);
    const tail = MAX_TRANSCRIPT_CHARS - head - 20;
    doc = `${doc.slice(0, head)}\n……（中间省略）……\n${doc.slice(-tail)}`;
  }
  return doc;
}

function segmentsFromPickJson(
  parsed: Record<string, unknown>,
  durationSec: number,
  opts: Pick<AnalyzeOptions, "maxSegments" | "targetDurationSec" | "segmentWindowSec">
): HighlightSegment[] {
  const raw = parsed.segments;
  if (!Array.isArray(raw)) throw new Error('JSON 缺少 "segments" 数组');
  const out: HighlightSegment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const start = Number(o.startSec ?? o.start);
    const end = Number(o.endSec ?? o.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start + 0.2)
      continue;
    const s = Math.max(0, start);
    const e = Math.min(durationSec, end);
    if (e <= s + 0.2) continue;
    out.push({
      startSec: s,
      endSec: e,
      score: 0.75,
      motion: 0,
      audio: 0,
      scene: 0,
    });
  }
  out.sort((a, b) => a.startSec - b.startSec);
  const merged: HighlightSegment[] = [];
  const gap = 0.15;
  for (const seg of out) {
    const last = merged[merged.length - 1];
    if (last && seg.startSec < last.endSec + gap) {
      last.endSec = Math.max(last.endSec, seg.endSec);
      continue;
    }
    merged.push({ ...seg });
  }
  const chosen: HighlightSegment[] = [];
  let total = 0;
  for (const seg of merged) {
    if (chosen.length >= opts.maxSegments) break;
    const d = seg.endSec - seg.startSec;
    if (total + d > opts.targetDurationSec + 1e-6) break;
    chosen.push(seg);
    total += d;
  }
  return chosen;
}

/**
 * 分块提取音频 → 多模态模型转写（带大致时间）→ 文本模型根据字幕选高光时间段。
 */
export async function qwenTranscriptHighlightPipeline(
  p: QwenTranscriptParams
): Promise<HighlightSegment[]> {
  if (!p.hasAudio || !p.apiKey.trim()) return [];

  const cover = Math.min(p.durationSec, TRANSCRIPT_MAX_COVER_SEC);
  if (cover < 1) return [];

  const all: Utterance[] = [];
  let offset = 0;
  let chunkIndex = 0;
  while (offset < cover && chunkIndex < MAX_TRANSCRIBE_CHUNKS) {
    const len = Math.min(TRANSCRIBE_CHUNK_SEC, cover - offset);
    const wavPath = path.join(p.tmpDir, `qwen_asr_${randomUUID()}.wav`);
    const { code, stderr } = await runCmd(p.ffmpeg, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-ss",
      String(offset),
      "-i",
      p.inputPath,
      "-t",
      String(len),
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      wavPath,
    ]);
    if (code !== 0) {
      try {
        await unlink(wavPath);
      } catch {
        /* */
      }
      throw new Error(`ffmpeg 导出转写片段失败: ${stderr}`);
    }
    try {
      const part = await transcribeChunkWav(
        p.apiKey,
        p.audioModel,
        wavPath,
        offset,
        len
      );
      all.push(...part);
    } finally {
      try {
        await unlink(wavPath);
      } catch {
        /* */
      }
    }
    offset += len;
    chunkIndex += 1;
    await new Promise((r) => setTimeout(r, 220));
  }

  if (all.length === 0) return [];

  const doc = buildTranscriptForPicker(all);
  const hint = p.instruction.trim();
  const pickPrompt = `你是短视频剪辑师。下面是一条视频在前 ${cover.toFixed(0)} 秒内的自动转写字幕（时间单位为秒，相对整片起点 0）。请根据语义、节奏、信息密度与「爆点/金句」潜力，选出适合作为高光集锦的连续时间区间。
硬性约束（必须遵守）：
- 每条片段 startSec/endSec 相对整片起点，且落在 [0, ${p.durationSec.toFixed(2)}] 内；
- endSec > startSec 至少 0.5 秒；
- 片段总条数 ≤ ${p.opts.maxSegments}；
- 所有片段累计时长 ≤ ${p.opts.targetDurationSec} 秒；
- 单条时长尽量接近 ${p.opts.segmentWindowSec} 秒（可略浮动）。
只输出一个 JSON 对象，不要其它文字：
{"segments":[{"startSec":数字,"endSec":数字}, ...]}

--- 字幕 ---
${doc}
${hint ? `\n用户偏好：${hint}` : ""}`;

  const pickContent = await dashscopeCompatChat(
    p.apiKey,
    {
      model: p.textModel,
      temperature: 0.2,
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: pickPrompt,
        },
      ],
    },
    120_000
  );
  const parsed = extractJsonObject(pickContent);
  return segmentsFromPickJson(parsed, p.durationSec, p.opts);
}
