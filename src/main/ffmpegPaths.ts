import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { app } from "electron";
import ffmpegStatic from "ffmpeg-static";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";

function resolveBundled(tool: "ffmpeg" | "ffprobe"): string | null {
  if (tool === "ffmpeg") {
    const p = ffmpegStatic as unknown as string | null;
    return p && existsSync(p) ? p : null;
  }
  const p = ffprobeInstaller.path;
  return p && existsSync(p) ? p : null;
}

export function getFfmpegPath(custom?: string): string {
  if (custom && existsSync(custom)) return custom;
  const bundled = resolveBundled("ffmpeg");
  if (bundled) return bundled;
  return "ffmpeg";
}

export function getFfprobePath(custom?: string): string {
  if (custom && existsSync(custom)) return custom;
  const bundled = resolveBundled("ffprobe");
  if (bundled) return bundled;
  return "ffprobe";
}

export function tmpDir(): string {
  return path.join(app.getPath("userData"), "tmp");
}

export type SpawnResult = { code: number; stdout: string; stderr: string };
export type SpawnResultBin = { code: number; stdout: Buffer; stderr: string };

export function runCmd(
  cmd: string,
  args: string[],
  options?: { cwd?: string; maxBufferMb?: number }
): Promise<SpawnResult> {
  return runCmdInternal(cmd, args, { ...options, binaryStdout: false }) as Promise<SpawnResult>;
}

export function runCmdBinary(
  cmd: string,
  args: string[],
  options?: { cwd?: string; maxBufferMb?: number }
): Promise<SpawnResultBin> {
  return runCmdInternal(cmd, args, { ...options, binaryStdout: true }) as Promise<SpawnResultBin>;
}

function runCmdInternal(
  cmd: string,
  args: string[],
  options?: { cwd?: string; maxBufferMb?: number; binaryStdout?: boolean }
): Promise<SpawnResult | SpawnResultBin> {
  return new Promise((resolve, reject) => {
    const chunksOut: Buffer[] = [];
    const chunksErr: Buffer[] = [];
    const max = (options?.maxBufferMb ?? 120) * 1024 * 1024;
    const binaryStdout = options?.binaryStdout ?? false;
    const child = spawn(cmd, args, {
      cwd: options?.cwd,
      windowsHide: true,
    });
    child.stdout.on("data", (d) => {
      chunksOut.push(d as Buffer);
      if (Buffer.concat(chunksOut).length > max) {
        child.kill("SIGKILL");
        reject(new Error("stdout buffer exceeded"));
      }
    });
    child.stderr.on("data", (d) => {
      chunksErr.push(d as Buffer);
      if (Buffer.concat(chunksErr).length > max) {
        child.kill("SIGKILL");
        reject(new Error("stderr buffer exceeded"));
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const out = Buffer.concat(chunksOut);
      const err = Buffer.concat(chunksErr).toString("utf8");
      if (binaryStdout) {
        resolve({ code: code ?? -1, stdout: out, stderr: err });
      } else {
        resolve({ code: code ?? -1, stdout: out.toString("utf8"), stderr: err });
      }
    });
  });
}
