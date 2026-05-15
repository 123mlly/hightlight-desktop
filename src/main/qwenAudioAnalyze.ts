import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import type { AnalyzeOptions, HighlightSegment } from "../shared/types";
import { runCmd } from "./ffmpegPaths";

const DASHSCOPE_COMPAT_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

/** 听音分析只截取片头，控制体积与 API 超时 */
const AUDIO_CLIP_SEC = 120;

export type QwenAudioParams = {
  apiKey: string;
  model: string;
  instruction: string;
  ffmpeg: string;
  inputPath: string;
  durationSec: number;
  opts: Pick<AnalyzeOptions, "maxSegments" | "targetDurationSec" | "segmentWindowSec">;
  tmpDir: string;
};

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

function toSegments(
  parsed: Record<string, unknown>,
  clipSec: number,
  opts: Pick<AnalyzeOptions, "maxSegments" | "targetDurationSec">
): HighlightSegment[] {
  const raw = parsed.segments;
  if (!Array.isArray(raw)) throw new Error('JSON 缺少 "segments" 数组');
  const out: HighlightSegment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const start = Number(o.startSec ?? o.start);
    const end = Number(o.endSec ?? o.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start + 0.2) continue;
    const s = Math.max(0, start);
    const e = Math.min(clipSec, end);
    if (e <= s + 0.2) continue;
    out.push({
      startSec: s,
      endSec: e,
      score: 0.7,
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
 * 将片头音频以 WAV base64 送入百炼 OpenAI 兼容多模态接口，由模型直接给出高光时间段（秒，相对片头 0 秒）。
 */
export async function qwenAudioHighlightsFromDashScope(
  p: QwenAudioParams
): Promise<HighlightSegment[]> {
  const clipSec = Math.min(AUDIO_CLIP_SEC, Math.max(1, p.durationSec));
  const wavPath = path.join(p.tmpDir, `qwen_audio_${randomUUID()}.wav`);
  const { code, stderr } = await runCmd(p.ffmpeg, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    p.inputPath,
    "-t",
    String(clipSec),
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    wavPath,
  ]);
  if (code !== 0) {
    throw new Error(`ffmpeg 导出听音片段失败: ${stderr}`);
  }

  let b64: string;
  try {
    const buf = await readFile(wavPath);
    b64 = buf.toString("base64");
  } finally {
    try {
      await unlink(wavPath);
    } catch {
      /* ignore */
    }
  }

  const hint = p.instruction.trim();
  const userText = `你是专业短视频剪辑师。下面这段 WAV 音频对应视频从 0 秒到约 ${clipSec.toFixed(1)} 秒（仅片头，超出部分你听不到）。
请根据听感（节奏、情绪、信息密度、是否像「金句/爆点/梗」等）选出适合作为「高光」的时间区间。
硬性约束：
- 每条片段 startSec/endSec 必须落在 [0, ${clipSec}] 内，且 endSec > startSec 至少 0.5 秒；
- 全部片段累计时长不得超过 ${p.opts.targetDurationSec} 秒；
- 片段条数不得超过 ${p.opts.maxSegments}；
- 单条时长建议接近 ${p.opts.segmentWindowSec} 秒量级（可略浮动）。
只输出一个 JSON 对象，不要其它文字，格式：
{"segments":[{"startSec":数字,"endSec":数字}, ...]}
${hint ? `用户偏好说明：${hint}` : ""}`;

  const res = await fetch(DASHSCOPE_COMPAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${p.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: p.model,
      temperature: 0.3,
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "input_audio",
              input_audio: { data: b64, format: "wav" },
            },
            { type: "text", text: userText },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(180_000),
  });

  const rawText = await res.text();
  if (!res.ok) {
    throw new Error(
      `百炼多模态接口请求失败 HTTP ${res.status}: ${rawText.slice(0, 800)}`
    );
  }

  const data = JSON.parse(rawText) as Record<string, unknown>;
  const choices = data.choices as unknown;
  const first =
    Array.isArray(choices) && choices.length > 0
      ? (choices[0] as Record<string, unknown>)
      : null;
  const msg = first?.message as Record<string, unknown> | undefined;
  let content = "";
  if (typeof msg?.content === "string") {
    content = msg.content;
  } else if (Array.isArray(msg?.content)) {
    const parts = msg!.content as { type?: string; text?: string }[];
    content = parts
      .filter((x) => x && x.type === "text" && typeof x.text === "string")
      .map((x) => x.text!)
      .join("\n");
  }
  if (!content) {
    throw new Error("模型未返回文本内容");
  }

  const parsed = extractJsonObject(content);
  return toSegments(parsed, clipSec, p.opts);
}
