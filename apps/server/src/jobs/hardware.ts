// Created by The Angelo Umali.
// The Render screen's hardware panel: the probed backend's encoder and chunk count, plus live utilization.
import { execFile } from "node:child_process";
import { cpus } from "node:os";
import { promisify } from "node:util";
import type { Hardware } from "@zks/shared";

type RenderProfile = Hardware["profile"];

const execFileAsync = promisify(execFile);
const CPU_SAMPLE_MS = 250;
const NVIDIA_SMI_TIMEOUT_MS = 2000;

// Mirrors the engine's backends/*.py (probe_encoder, jobs). RENDER_JOBS is not passed to the engine, so it is not read here.
const BACKENDS: Readonly<Record<RenderProfile, { readonly encoder: string; readonly chunks: (cores: number) => number }>> = {
  nvidia: { encoder: "hevc_nvenc", chunks: () => 4 },
  cpu: { encoder: "libx265", chunks: (cores) => Math.max(1, Math.floor(cores / 4)) },
  qsv: { encoder: "hevc_qsv", chunks: () => 2 },
  amf: { encoder: "hevc_amf", chunks: () => 2 },
  vaapi: { encoder: "hevc_vaapi", chunks: () => 2 },
  videotoolbox: { encoder: "hevc_videotoolbox", chunks: () => 2 },
};

export interface HardwareMeterReaders {
  readonly readCpuPercent: () => Promise<number>;
  /** Undefined when nvidia-smi is missing or unreadable. */
  readonly readNvidiaUtilization: () => Promise<{ gpu: number; encoder: number } | undefined>;
}

export const SYSTEM_METER_READERS: HardwareMeterReaders = { readCpuPercent, readNvidiaUtilization };

export async function describeHardware(profile: RenderProfile, readers: HardwareMeterReaders): Promise<Hardware> {
  const backend = BACKENDS[profile];
  const cpuMeter = { label: "CPU", pct: await readers.readCpuPercent() };
  const base = { profile, encoder: backend.encoder, chunks: backend.chunks(cpus().length) };
  if (profile === "cpu") return { ...base, meters: [cpuMeter, { label: "GPU", pct: null }] };
  // Only NVIDIA exposes utilization portably; other GPUs show the CPU alone rather than a made-up figure.
  const nvidia = profile === "nvidia" ? await readers.readNvidiaUtilization() : undefined;
  const gpuMeters =
    nvidia === undefined
      ? []
      : [
          { label: "GPU", pct: nvidia.gpu },
          { label: "Encoder", pct: nvidia.encoder },
        ];
  return { ...base, meters: [...gpuMeters, cpuMeter] };
}

function cpuTimes(): { idle: number; total: number } {
  return cpus().reduce((sum, { times }) => ({ idle: sum.idle + times.idle, total: sum.total + times.user + times.nice + times.sys + times.idle + times.irq }), {
    idle: 0,
    total: 0,
  });
}

async function readCpuPercent(): Promise<number> {
  const before = cpuTimes();
  await new Promise((resolve) => setTimeout(resolve, CPU_SAMPLE_MS));
  const after = cpuTimes();
  const total = after.total - before.total;
  return total <= 0 ? 0 : clampPercent(100 * (1 - (after.idle - before.idle) / total));
}

async function readNvidiaUtilization(): Promise<{ gpu: number; encoder: number } | undefined> {
  const query = ["--query-gpu=utilization.gpu,utilization.encoder", "--format=csv,noheader,nounits"];
  const result = await execFileAsync("nvidia-smi", query, { timeout: NVIDIA_SMI_TIMEOUT_MS, windowsHide: true }).catch(() => undefined);
  const [gpu, encoder] = (result?.stdout.split("\n")[0] ?? "").split(",").map((field) => Number.parseFloat(field));
  if (gpu === undefined || encoder === undefined || Number.isNaN(gpu) || Number.isNaN(encoder)) return undefined;
  return { gpu: clampPercent(gpu), encoder: clampPercent(encoder) };
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}
