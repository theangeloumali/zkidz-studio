// Created by The Angelo Umali.
// Boots the server the way `pnpm start` does (the esbuild bundle) and measures its ready time and idle RSS.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { ENV, LOOPBACK_HOST } from "@zks/shared";
import { runCommand } from "./exec.ts";

export interface ServerBench {
  status: "ok" | "fail";
  /** The home-creating start: migrations included, so it carries no budget. */
  firstStartMs?: number;
  readyMs?: number;
  idleRssMb?: number;
  peakRssMb?: number;
  error?: string;
  /** Lets a test prove the scratch home is gone; never copied into the report. */
  scratchHome?: string;
}

const READY_TIMEOUT_MS = 60_000;
const READY_POLL_MS = 25;
const REQUEST_TIMEOUT_MS = 1000;
// A start that migrates leaves ~250 MB a GC frees 10-20 s later; idle is the last sample, so a late GC never counts.
const SETTLE_MS = 30_000;
const RSS_SAMPLE_MS = 1000;
const STOP_TIMEOUT_MS = 10_000;
const KB_PER_MB = 1024;
const STDERR_TAIL_CHARS = 4096;
const BUILD_TIMEOUT_MS = 300_000;
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SERVER_DIR = path.join(REPO_ROOT, "apps", "server");
const BUILD_SCRIPT = path.join(SERVER_DIR, "build.mjs");
const SERVER_BUNDLE = path.join(SERVER_DIR, "dist", "main.mjs");
// Everything esbuild inlines into the bundle: the server, its workspace deps, the build script and the lockfile.
const BUNDLE_INPUTS = [
  path.join(SERVER_DIR, "src"),
  BUILD_SCRIPT,
  path.join(REPO_ROOT, "packages", "shared", "src"),
  path.join(REPO_ROOT, "packages", "db", "src"),
  path.join(REPO_ROOT, "pnpm-lock.yaml"),
];

export function parseRssKb(platform: NodeJS.Platform, output: string): number | undefined {
  const match =
    platform === "linux" ? /^VmRSS:\s+(\d+)\s*kB/m.exec(output) : platform === "win32" ? /"([^"]+)\s*K"\s*$/m.exec(output) : /^\s*(\d+)\s*$/m.exec(output);
  const digits = match?.[1]?.replace(/\D/g, "");
  return digits ? Number(digits) : undefined;
}

function readRssKb(pid: number): number | undefined {
  if (process.platform === "linux") return parseRssKb("linux", readFileSync(`/proc/${pid}/status`, "utf8"));
  const listing =
    process.platform === "win32" ? runCommand("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]) : runCommand("ps", ["-o", "rss=", "-p", String(pid)]);
  return parseRssKb(process.platform, listing.stdout);
}

function newestMtimeMs(target: string): number {
  if (!existsSync(target)) return 0;
  const stats = statSync(target);
  if (!stats.isDirectory()) return stats.mtimeMs;
  return Math.max(stats.mtimeMs, ...readdirSync(target).map((entry) => newestMtimeMs(path.join(target, entry))));
}

export function bundleIsStale(bundle: string, inputs: string[]): boolean {
  return !existsSync(bundle) || Math.max(...inputs.map(newestMtimeMs)) > statSync(bundle).mtimeMs;
}

/** Runs the server package's own build (`node build.mjs`, what `pnpm start` runs) only when dist is missing or stale. */
function ensureServerBundle(): string | undefined {
  if (!bundleIsStale(SERVER_BUNDLE, BUNDLE_INPUTS)) return undefined;
  const build = runCommand(process.execPath, [BUILD_SCRIPT], BUILD_TIMEOUT_MS);
  return build.code === 0 ? undefined : `server build failed: ${build.stderr.trim().split(/\r?\n/).at(-1) ?? "no output"}`;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, LOOPBACK_HOST, () => {
      const address = probe.address();
      probe.close(() => (typeof address === "object" && address ? resolve(address.port) : reject(new Error("no free port"))));
    });
  });
}

/** Any HTTP answer counts as ready: the guard may refuse the request, but the server is serving. */
async function answers(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    return true;
  } catch {
    return false;
  }
}

/** The server logs one JSON object per line; the last one says why it stopped. */
function lastLogMessage(stderr: string): string {
  const lastLine = stderr.trim().split(/\r?\n/).at(-1) ?? "";
  try {
    const entry = JSON.parse(lastLine) as { msg?: unknown; error?: unknown };
    if (typeof entry.msg !== "string") return lastLine;
    return typeof entry.error === "string" ? `${entry.msg}: ${entry.error}` : entry.msg;
  } catch {
    return lastLine || "no output";
  }
}

interface RunningServer {
  readyMs?: number;
  /** Why the start failed, with the scratch home already masked. */
  error?: string;
  pid?: number;
  isRunning: () => boolean;
  failure: (when: string) => string;
  stop: () => Promise<void>;
}

/** Spawns the bundle and polls until it answers; `stop()` must always be called. */
async function startServer(env: NodeJS.ProcessEnv, port: number, scratchHome: string): Promise<RunningServer> {
  const startedAt = performance.now();
  // cwd matches `pnpm -F @zks/server start`: static files resolve relative to it.
  const child = spawn(process.execPath, [SERVER_BUNDLE], { cwd: SERVER_DIR, env, stdio: ["ignore", "ignore", "pipe"] });
  let stderrTail = "";
  child.stderr.on("data", (chunk: Buffer) => (stderrTail = (stderrTail + chunk.toString()).slice(-STDERR_TAIL_CHARS)));
  // Read through a call: the exit callback sets it, which control-flow narrowing cannot see.
  let exitCode: number | null | undefined;
  const isRunning = (): boolean => exitCode === undefined;
  const exited = new Promise<void>((resolve) => child.once("exit", (code) => resolve(void (exitCode = code))));
  const failure = (when: string): string => `server exited (${String(exitCode)})${when}: ${lastLogMessage(stderrTail)}`.split(scratchHome).join("$ZKS_HOME");
  const stop = async (): Promise<void> => {
    if (!isRunning()) return;
    child.kill("SIGTERM");
    const stopped = await Promise.race([exited.then(() => true), sleep(STOP_TIMEOUT_MS).then(() => false)]);
    if (!stopped) child.kill("SIGKILL");
    await exited;
  };
  const handle = { pid: child.pid, isRunning, failure, stop };
  while (isRunning() && performance.now() - startedAt < READY_TIMEOUT_MS) {
    if (await answers(`http://${LOOPBACK_HOST}:${port}/api/projects`)) return { ...handle, readyMs: Math.round(performance.now() - startedAt) };
    await sleep(READY_POLL_MS);
  }
  return { ...handle, error: isRunning() ? `not ready within ${READY_TIMEOUT_MS} ms` : failure("") };
}

/** Last of 1 s samples over the settle window, plus the highest seen. */
async function settledRss(server: RunningServer, settleMs: number): Promise<Pick<ServerBench, "idleRssMb" | "peakRssMb">> {
  const samplesKb: number[] = [];
  for (let waited = 0; waited < settleMs && server.isRunning(); waited += RSS_SAMPLE_MS) {
    await sleep(Math.min(RSS_SAMPLE_MS, settleMs - waited));
    const rssKb = server.pid === undefined || !server.isRunning() ? undefined : readRssKb(server.pid);
    if (rssKb !== undefined) samplesKb.push(rssKb);
  }
  const toMb = (kb: number): number => Math.round(kb / KB_PER_MB);
  const idleKb = samplesKb.at(-1);
  return idleKb === undefined ? {} : { idleRssMb: toMb(idleKb), peakRssMb: toMb(Math.max(...samplesKb)) };
}

/**
 * A throwaway ZKS_HOME with PGlite, so the user's studio data is never opened. The first start creates and
 * migrates it (reported, unbudgeted); ready time and idle RSS come from the second, warm start (plan §9.5).
 */
export async function benchServer({ ffmpegPath, settleMs = SETTLE_MS }: { ffmpegPath: string; settleMs?: number }): Promise<ServerBench> {
  const buildError = ensureServerBundle();
  if (buildError) return { status: "fail", error: buildError };
  const scratchHome = mkdtempSync(path.join(os.tmpdir(), "zks-bench-"));
  const port = await freePort();
  let previewPort = await freePort();
  while (previewPort === port) previewPort = await freePort();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    [ENV.home]: scratchHome,
    [ENV.port]: String(port),
    [ENV.previewPort]: String(previewPort),
    [ENV.ffmpeg]: ffmpegPath,
  };
  delete env[ENV.databaseUrl];
  const fail = (error: string): ServerBench => ({ status: "fail", error, scratchHome });
  try {
    const cold = await startServer(env, port, scratchHome);
    await cold.stop();
    if (cold.readyMs === undefined) return fail(`first start: ${cold.error ?? "not ready"}`);
    const warm = await startServer(env, port, scratchHome);
    try {
      if (warm.readyMs === undefined) return fail(warm.error ?? "not ready");
      const rss = await settledRss(warm, settleMs);
      if (!warm.isRunning()) return fail(warm.failure(" while idle"));
      return { status: "ok", firstStartMs: cold.readyMs, readyMs: warm.readyMs, ...rss, scratchHome };
    } finally {
      await warm.stop();
    }
  } finally {
    rmSync(scratchHome, { recursive: true, force: true, maxRetries: 5 });
  }
}
