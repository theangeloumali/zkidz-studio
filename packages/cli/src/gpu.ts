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
const TEST_SOURCE = "testsrc2=size=320x240:rate=30:duration=1";

export interface EncodeAttempt {
  backend: GpuBackend;
  encoder: string;
  ok: boolean;
}

export function listsEncoder(encoderListing: string, encoder: string): boolean {
  return new RegExp(`\\s${encoder}\\s`).test(encoderListing);
}

/** Every listed encoder in probe order, paired with its backend. */
function listedEncoders(encoderListing: string): { backend: GpuBackend; encoder: string }[] {
  return PROBE_ORDER.flatMap(({ backend, encoders }) => encoders.filter((name) => listsEncoder(encoderListing, name)).map((encoder) => ({ backend, encoder })));
}

export function testEncodeArgs(backend: GpuBackend, encoder: string, source = TEST_SOURCE, frames?: number): string[] {
  const isVaapi = backend === "vaapi";
  return [
    ...["-hide_banner", "-loglevel", "error", "-nostdin"],
    ...(isVaapi ? ["-vaapi_device", VAAPI_RENDER_NODE] : []),
    ...["-f", "lavfi", "-i", source],
    ...(isVaapi ? ["-vf", "format=nv12,hwupload"] : ["-pix_fmt", "yuv420p"]),
    ...["-c:v", encoder, ...(frames ? ["-frames:v", String(frames)] : []), "-f", "null", "-"],
  ];
}

/** `doctor --render`: test-encodes every listed encoder, since a render may ask for any of them. */
export function probeEveryEncoder(ffmpegPath: string, encoderListing: string, run: CommandRunner): EncodeAttempt[] {
  return listedEncoders(encoderListing).map(({ backend, encoder }) => ({ backend, encoder, ok: testEncode(ffmpegPath, backend, encoder, run) }));
}

function testEncode(ffmpegPath: string, backend: GpuBackend, encoder: string, run: CommandRunner): boolean {
  return run(ffmpegPath, testEncodeArgs(backend, encoder), TEST_ENCODE_TIMEOUT_MS).code === 0;
}
