import { runCmd } from "./ffmpegPaths";

export type ProbeInfo = {
  durationSec: number;
  width: number;
  height: number;
  hasAudio: boolean;
};

export async function ffprobeJson(
  ffprobePath: string,
  input: string
): Promise<ProbeInfo> {
  const { code, stdout, stderr } = await runCmd(ffprobePath, [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    input,
  ]);
  if (code !== 0) {
    throw new Error(`ffprobe failed: ${stderr || stdout}`);
  }
  const j = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{
      codec_type?: string;
      width?: number;
      height?: number;
    }>;
  };
  const duration = parseFloat(j.format?.duration ?? "0") || 0;
  const v = j.streams?.find((s) => s.codec_type === "video");
  const a = j.streams?.find((s) => s.codec_type === "audio");
  return {
    durationSec: duration,
    width: v?.width ?? 0,
    height: v?.height ?? 0,
    hasAudio: Boolean(a),
  };
}
