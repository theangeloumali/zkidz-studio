// Created by The Angelo Umali.
import type { CommandRunner } from "./exec.ts";

export type GpuBackend = "nvidia" | "videotoolbox" | "qsv" | "amf" | "vaapi" | "cpu";

const PROBE_ORDER: readonly { backend: GpuBackend; encoders: readonly string[] }[] = [
  { backend: "nvidia", encoders: ["hevc_nvenc", "h264_nvenc"] },
  { backend: "videotoolbox", encoders: ["hevc_videotoolbox"] },
  { backend: "qsv", encoders: ["hevc_qsv"] },
  { backend: "amf", encoders: ["hevc_amf"] },
  { backend: "vaapi", encoders: ["hevc_vaapi"] },
  { backend: "cpu", encoders: ["libx265", "libx264"] },
];
const VAAPI_RENDER_NODE = "/dev/dri/renderD128";
const TEST_ENCODE_TIMEOUT_MS = 20_000;

export interface EncodeAttempt {
  backend: GpuBackend;
  encoder: string;
  ok: boolean;
}
export interface GpuProbe {
  backend: GpuBackend | "none";
  encoder?: string;
  attempts: EncodeAttempt[];
}

export function listsEncoder(encoderListing: string, encoder: string): boolean {
  return new RegExp(`\\s${encoder}\\s`).test(encoderListing);
}

function testEncodeArgs(backend: GpuBackend, encoder: string): string[] {
  const isVaapi = backend === "vaapi";
  return [
    ...["-hide_banner", "-loglevel", "error", "-nostdin"],
    ...(isVaapi ? ["-vaapi_device", VAAPI_RENDER_NODE] : []),
    ...["-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30:duration=1"],
    ...(isVaapi ? ["-vf", "format=nv12,hwupload"] : ["-pix_fmt", "yuv420p"]),
    ...["-c:v", encoder, "-f", "null", "-"],
  ];
}

/** A listed encoder proves nothing (no driver, no device), so a backend counts only after a 1-second test encode. */
export function probeGpuBackend(ffmpegPath: string, encoderListing: string, run: CommandRunner): GpuProbe {
  const attempts: EncodeAttempt[] = [];
  for (const { backend, encoders } of PROBE_ORDER) {
    for (const encoder of encoders.filter((name) => listsEncoder(encoderListing, name))) {
      const ok = run(ffmpegPath, testEncodeArgs(backend, encoder), TEST_ENCODE_TIMEOUT_MS).code === 0;
      attempts.push({ backend, encoder, ok });
      if (ok) return { backend, encoder, attempts };
    }
  }
  return { backend: "none", attempts };
}
