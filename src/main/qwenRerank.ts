import type { AnalyzeOptions, HighlightSegment } from "../shared/types";

const DASHSCOPE_COMPAT_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

export type QwenRerankSettings = {
  apiKey: string;
  model: string;
  instruction: string;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

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
        /* continue */
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

/**
 * 在本地 FFmpeg 启发式高光结果之上，调用阿里云百炼（OpenAI 兼容模式）千问接口，
 * 按「成片播放顺序」重排并裁剪片段（不改变每段的 start/end，只调整入选集合与顺序）。
 */
export async function qwenRerankSegments(
  segments: HighlightSegment[],
  analyzeOpts: Pick<AnalyzeOptions, "maxSegments" | "targetDurationSec">,
  qwen: QwenRerankSettings
): Promise<HighlightSegment[]> {
  const key = qwen.apiKey.trim();
  if (segments.length === 0 || !key) return segments;

  const n = segments.length;
  const candidates = segments.map((seg, i) => ({
    i,
    startSec: round2(seg.startSec),
    endSec: round2(seg.endSec),
    durationSec: round2(seg.endSec - seg.startSec),
    score: round2(seg.score),
    motion: round2(seg.motion),
    audio: round2(seg.audio),
    scene: round2(seg.scene),
  }));

  const userHint = qwen.instruction.trim();
  const system = `你是视频剪辑助手。用户已用算法得到若干「高光候选」时间片，每个带有启发式分数（motion=运动强度, audio=音量能量, scene=镜头切换密度）。
你必须只输出一个 JSON 对象，不要其它说明文字。格式严格为：
{"indices":[整数, ...]}
其中 indices 为 0 到 ${n - 1} 的下标组成的列表，表示**建议成片播放顺序**（先播放在前）。列表中每个下标最多出现一次。
在满足下面约束的前提下，尽量把更符合用户意图、更适合成片节奏的片段排在前面，并**可以省略**不想要的下标：
- 按 indices 顺序依次选取片段，累计时长（各段 durationSec 之和）不得超过 targetDurationSec；
- 下标个数不得超过 maxSegments。
若无法判断，可保持按 score 从高到低优先。`;

  const user = JSON.stringify(
    {
      candidates,
      constraints: {
        maxSegments: analyzeOpts.maxSegments,
        targetDurationSec: analyzeOpts.targetDurationSec,
      },
      userInstruction: userHint || undefined,
    },
    null,
    2
  );

  const model = qwen.model.trim() || "qwen3.6-plus";

  const res = await fetch(DASHSCOPE_COMPAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 1024,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: `${user}\n\n请只输出 JSON 对象 {"indices":[...]}。`,
        },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  });

  const rawText = await res.text();
  if (!res.ok) {
    throw new Error(
      `百炼接口请求失败 HTTP ${res.status}: ${rawText.slice(0, 500)}`
    );
  }

  let data: unknown;
  try {
    data = JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    throw new Error("百炼接口响应不是合法 JSON");
  }

  const root = data as Record<string, unknown>;
  const choices = root.choices as unknown;
  const first =
    Array.isArray(choices) && choices.length > 0
      ? (choices[0] as Record<string, unknown>)
      : null;
  const msg = first?.message as Record<string, unknown> | undefined;
  const content =
    typeof msg?.content === "string"
      ? msg.content
      : typeof first?.text === "string"
        ? (first.text as string)
        : "";
  if (!content) {
    throw new Error("百炼接口响应缺少 choices[0].message.content");
  }

  const parsed = extractJsonObject(content);
  const indicesRaw = parsed.indices;
  if (!Array.isArray(indicesRaw)) {
    throw new Error('JSON 中缺少 "indices" 数组');
  }

  const seen = new Set<number>();
  const ordered: HighlightSegment[] = [];
  let totalDur = 0;
  for (const v of indicesRaw) {
    const idx = typeof v === "number" ? v : parseInt(String(v), 10);
    if (!Number.isInteger(idx) || idx < 0 || idx >= n || seen.has(idx)) continue;
    seen.add(idx);
    const seg = segments[idx]!;
    const d = seg.endSec - seg.startSec;
    if (ordered.length >= analyzeOpts.maxSegments) break;
    if (totalDur + d > analyzeOpts.targetDurationSec + 1e-6) break;
    ordered.push(seg);
    totalDur += d;
  }

  if (ordered.length === 0) return segments;
  return ordered;
}
