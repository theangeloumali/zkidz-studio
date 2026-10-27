// Created by The Angelo Umali.
// `zks doctor --bench`: measures the server and each working encoder against the plan §9.5 budgets.
import { existsSync } from "node:fs";
import os from "node:os";
import { redactReport, redactText, type PathRoots } from "@zks/shared";
import { benchServer, type ServerBench } from "./bench-server.ts";
import type { ZksContext } from "./context.ts";
import { reportRoots } from "./doctor.ts";
import { runCommand, type CommandRunner } from "./exec.ts";
import { probeEveryEncoder, testEncodeArgs, type GpuBackend } from "./gpu.ts";
import { toolExecutablePath } from "./tools.ts";

type BudgetStatus = "pass" | "warn";
interface EncoderBench {
  backend: GpuBackend;
  encoder: string;
  frames: number;
  seconds: number;
  /** Absent when the timed encode failed after the test encode passed. */
  fps?: number;
}
type BenchReport = ReturnType<typeof buildBenchReport>;

const REPORT_SCHEMA = 1;
const READY_BUDGET_MS = 2000;
const IDLE_RSS_BUDGET_MB = 600;
const BENCH_FRAMES = 120;
const BENCH_SOURCE = "testsrc2=size=1920x1080:rate=30";
const BENCH_ENCODE_TIMEOUT_MS = 120_000;
const BYTES_PER_GB = 1024 ** 3;

export function budgetStatus(value: number | undefined, budget: number): BudgetStatus {
  return value !== undefined && value <= budget ? "pass" : "warn";
}

/** Wall clock per encode, process start included: what a short render actually waits for. */
export function benchEncoders(ffmpegPath: string, encoderListing: string, run: CommandRunner = runCommand, now = () => performance.now()): EncoderBench[] {
  return probeEveryEncoder(ffmpegPath, encoderListing, run)
    .filter((attempt) => attempt.ok)
    .map(({ backend, encoder }) => {
      const startedAt = now();
      const outcome = run(ffmpegPath, testEncodeArgs(backend, encoder, BENCH_SOURCE, BENCH_FRAMES), BENCH_ENCODE_TIMEOUT_MS);
      const seconds = (now() - startedAt) / 1000;
      const fps = outcome.code === 0 && seconds > 0 ? Math.round(BENCH_FRAMES / seconds) : undefined;
      return { backend, encoder, frames: BENCH_FRAMES, seconds: Math.round(seconds * 100) / 100, ...(fps === undefined ? {} : { fps }) };
    });
}

// Hardware facts only (no hostname, user or path): reports are posted publicly.
export function buildBenchReport(server: ServerBench, encoders: EncoderBench[]) {
  return {
    schema: REPORT_SCHEMA,
    ok: server.status === "ok" && encoders.some((result) => result.fps !== undefined),
    machine: {
      platform: process.platform,
      os: os.release(),
      arch: process.arch,
      cpuModel: os.cpus()[0]?.model.trim() ?? "unknown",
      cpuCount: os.availableParallelism(),
      memoryGb: Math.round(os.totalmem() / BYTES_PER_GB),
      node: process.versions.node,
    },
    server: {
      status: server.status,
      firstStartMs: server.firstStartMs,
      readyMs: server.readyMs,
      readyBudgetMs: READY_BUDGET_MS,
      ready: budgetStatus(server.readyMs, READY_BUDGET_MS),
      idleRssMb: server.idleRssMb,
      idleRssBudgetMb: IDLE_RSS_BUDGET_MB,
      idleRss: budgetStatus(server.idleRssMb, IDLE_RSS_BUDGET_MB),
      peakRssMb: server.peakRssMb,
      ...(server.error ? { error: server.error } : {}),
    },
    encoders: encoders.map(({ backend, encoder, frames, seconds, fps }) => ({ backend, encoder, frames, seconds, fps })),
  };
}

export async function runBench(context: ZksContext): Promise<BenchReport> {
  const ffmpegPath = toolExecutablePath(context, "ffmpeg");
  if (!ffmpegPath || !existsSync(ffmpegPath)) return buildBenchReport({ status: "fail", error: "ffmpeg not installed: run pnpm zks setup" }, []);
  const server = await benchServer({ ffmpegPath });
  const encoderListing = runCommand(ffmpegPath, ["-hide_banner", "-encoders"]).stdout;
  return buildBenchReport(server, benchEncoders(ffmpegPath, encoderListing));
}

export function formatBenchJson(report: BenchReport, roots: PathRoots = reportRoots()): string {
  return JSON.stringify(redactReport(report, roots), null, 2);
}

export function formatBenchText(report: BenchReport, roots: PathRoots = reportRoots()): string {
  const { server } = report;
  const mark = (status: BudgetStatus): string => (status === "pass" ? "ok  " : "WARN");
  const lines =
    server.status === "fail"
      ? [`FAIL server       ${server.error ?? "did not start"}`]
      : [
          `     first start  ${server.firstStartMs ?? "?"} ms (creates the home, no budget)`,
          `${mark(server.ready)} ready        ${server.readyMs} ms (budget ${server.readyBudgetMs} ms) ${server.ready}`,
          `${mark(server.idleRss)} idle RSS     ${server.idleRssMb ?? "?"} MB (budget ${server.idleRssBudgetMb} MB) ${server.idleRss}, startup peak ${server.peakRssMb ?? "?"} MB`,
        ];
  for (const { backend, encoder, frames, seconds, fps } of report.encoders)
    lines.push(
      fps === undefined
        ? `FAIL ${encoder.padEnd(12)} timed encode failed`
        : `ok   ${encoder.padEnd(12)} ${fps} fps (${backend}, ${frames} frames of 1080p in ${seconds} s)`,
    );
  if (report.encoders.length === 0) lines.push("FAIL encode       no encoder passed a test encode");
  return redactText(lines.join("\n"), roots);
}
