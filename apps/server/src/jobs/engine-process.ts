// Created by The Angelo Umali.
// The only engine runner: spawn with its own process group, so a cancel kills the engine's ffmpeg and Chrome children.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { ENV, redactText } from "@zks/shared";
import { loadToolsLock, pinnedExecutablePath, platformKey, type ToolName } from "@zks/shared/node";
import { z } from "zod";
import { inheritedParentEnv } from "../security/parent-env.ts";
import { activeSpecSnapshotDir } from "./spec-snapshot.ts";

const STDERR_TAIL_CHARS = 2000;
const DEFAULT_KILL_GRACE_MS = 5000;
const ENGINE_DIR_PLACEHOLDER = "<engine>";
const SETUP_HINT = "Run: pnpm zks setup";
// ZKS_BACKEND pins the engine's backend: the GPU probe can pass on a host whose Vulkan (libplacebo) still fails. The runner
// overrides ZKS_FFMPEG and ZKS_CHROME with the pinned tools; the demo runner passes them through.
const ENGINE_OVERRIDES = ["ZKS_BACKEND", "ZKS_FFMPEG", "ZKS_FFPROBE", "ZKS_CHROME", "ZKS_JOBS", "XDG_CACHE_HOME", "XDG_DATA_HOME"];

export interface PinnedEngineTools {
  readonly ffmpegPath: string;
  readonly chromePath: string;
}

export interface EngineProcessOptions {
  /** `uv` in production, with prefixArgs `run --project <engine dir> zks-engine`. */
  readonly executable: string;
  readonly prefixArgs: readonly string[];
  readonly studioHome: string;
  readonly tools: PinnedEngineTools;
  readonly proxyOptIn?: boolean;
  /** How long a cancelled engine gets to exit on SIGTERM before SIGKILL. */
  readonly killGraceMs?: number;
  readonly parentEnv?: Readonly<Record<string, string | undefined>>;
}

export interface EngineProcessRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly workDir: string;
  /** In-place files the command reads; the engine refuses any other input outside the project. */
  readonly inPlacePaths?: readonly string[];
  readonly signal?: AbortSignal;
}

/** The engine refused the input and said why on stdout (`{"error": {code, message}}`); `reason` is safe to show Claude. */
export class EngineReportedError extends Error {
  override readonly name = "EngineReportedError";
  readonly code: string;
  readonly reason: string;
  constructor(command: string, code: string, reason: string) {
    super(`zks-engine ${command} failed: ${reason}`);
    this.code = code;
    this.reason = reason;
  }
}

/** Method syntax keeps the tools layer's EngineRunner assignable both ways; its requests simply carry no signal. */
export interface EngineProcessRunner {
  run(request: EngineProcessRequest): Promise<unknown>;
}

/** The pinned ffmpeg and Chrome the engine must use; an env override wins, and PATH is never a fallback. */
export function pinnedEngineTools(env: Readonly<Record<string, string | undefined>>, studioHome: string): PinnedEngineTools {
  return {
    ffmpegPath: env[ENV.ffmpeg] || installedTool(studioHome, "ffmpeg"),
    chromePath: env[ENV.chrome] || installedTool(studioHome, "chrome-headless-shell"),
  };
}

function installedTool(studioHome: string, toolName: ToolName): string {
  const toolPath = pinnedExecutablePath({ toolsDir: join(studioHome, "tools"), platform: platformKey(), lock: loadToolsLock() }, toolName);
  if (toolPath === undefined || !existsSync(toolPath)) throw new Error(`${toolName} is not installed. ${SETUP_HINT}`);
  return toolPath;
}

export function createEngineProcessRunner(options: EngineProcessOptions): EngineProcessRunner {
  const maskHostPaths = hostPathMasker(options);
  return {
    run: ({ command, args, workDir, inPlacePaths = [], signal }) => {
      const argv = [...options.prefixArgs, command, "--json", ...args];
      const env = { ...engineParentEnv(options), ...pinnedEnv(options, workDir, inPlacePaths) };
      const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
      return runToReport({ executable: options.executable, argv, workDir, env, signal, command, killGraceMs, maskHostPaths });
    },
  };
}

/** What an engine process inherits from the server; the demo runner spawns the engine's Python with it too. */
export function engineParentEnv(options: Pick<EngineProcessOptions, "proxyOptIn" | "parentEnv">): Record<string, string> {
  return inheritedParentEnv({ proxyOptIn: options.proxyOptIn === true, extraNames: ENGINE_OVERRIDES, parentEnv: options.parentEnv });
}

/** Set last, so a parent's ZKS_FFMPEG, ZKS_CHROME or ZKS_INPLACE can never widen what the engine runs or reads. */
function pinnedEnv(options: EngineProcessOptions, workDir: string, inPlacePaths: readonly string[]): Record<string, string> {
  const specsDir = activeSpecSnapshotDir();
  const pinned = {
    [ENV.ffmpeg]: options.tools.ffmpegPath,
    [ENV.chrome]: options.tools.chromePath,
    [ENV.home]: options.studioHome,
    ZKS_WORK: workDir,
    ZKS_INPLACE: inPlacePaths.join(delimiter),
  };
  return specsDir === undefined ? pinned : { ...pinned, ZKS_SPECS: specsDir };
}

/** Job errors reach the UI and the agent: the engine's install dir and ZKS_HOME must not leak the user's folders. */
function hostPathMasker(options: EngineProcessOptions): (text: string) => string {
  const engineDirs = options.prefixArgs.filter((arg) => isAbsolute(arg));
  return (text) =>
    redactText(
      engineDirs.reduce((masked, engineDir) => masked.split(engineDir).join(ENGINE_DIR_PLACEHOLDER), text),
      { zksHome: options.studioHome },
    );
}

interface SpawnRequest {
  readonly executable: string;
  readonly argv: readonly string[];
  readonly workDir: string;
  readonly env: Record<string, string>;
  readonly signal: AbortSignal | undefined;
  readonly command: string;
  readonly killGraceMs: number;
  readonly maskHostPaths: (text: string) => string;
}

function runToReport(request: SpawnRequest): Promise<unknown> {
  const { promise, resolve, reject } = Promise.withResolvers<unknown>();
  // Its own process group on POSIX, so a cancel reaches the ffmpeg and Chrome the engine started.
  const child = spawn(request.executable, request.argv, { cwd: request.workDir, env: request.env, shell: false, detached: process.platform !== "win32" });
  const stdoutChunks: Buffer[] = [];
  let stderrTail = "";
  child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString("utf8")).slice(-STDERR_TAIL_CHARS);
  });
  let escalation: NodeJS.Timeout | undefined;
  const killTree = () => {
    killProcessTree(child, "SIGTERM");
    escalation = setTimeout(() => killProcessTree(child, "SIGKILL"), request.killGraceMs);
  };
  request.signal?.addEventListener("abort", killTree, { once: true });
  if (request.signal?.aborted) killTree();
  child.on("error", (error) => reject(new Error(`zks-engine ${request.command} failed: ${request.maskHostPaths(error.message)}`, { cause: error })));
  child.on("close", (exitCode) => {
    request.signal?.removeEventListener("abort", killTree);
    const stdout = Buffer.concat(stdoutChunks).toString("utf8");
    if (request.signal?.aborted) {
      // The group may still hold children that outlived the engine itself.
      killProcessTree(child, "SIGKILL");
      clearTimeout(escalation);
      return reject(new Error(`zks-engine ${request.command} cancelled`));
    }
    if (exitCode !== 0) {
      const report = engineErrorReport(stdout);
      if (report !== undefined) return reject(new EngineReportedError(request.command, report.code, request.maskHostPaths(report.message)));
      const reason = lastStderrLine(stderrTail) ?? `exit code ${exitCode}`;
      return reject(new Error(`zks-engine ${request.command} failed: ${request.maskHostPaths(reason)}`));
    }
    try {
      resolve(JSON.parse(stdout));
    } catch (error) {
      reject(new Error(`zks-engine ${request.command} printed a report that is not JSON`, { cause: error }));
    }
  });
  return promise;
}

const EngineErrorReportSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

/** The engine's own `{"error": {code, message}}` on stdout says what failed better than its stderr does. */
function engineErrorReport(stdout: string): { code: string; message: string } | undefined {
  try {
    const parsed = EngineErrorReportSchema.safeParse(JSON.parse(stdout));
    return parsed.success ? parsed.data.error : undefined;
  } catch {
    return undefined; // not a report; the stderr tail explains the failure
  }
}

/** A Python traceback's last line names the exception; the frames above it only list host paths. */
function lastStderrLine(stderrTail: string): string | undefined {
  const lines = stderrTail.trim().split(/\r?\n/);
  return lines.at(-1) || undefined;
}

function killProcessTree(child: ChildProcess, signal: "SIGTERM" | "SIGKILL"): void {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    // taskkill /F is already forceful, so it runs once.
    if (signal === "SIGTERM") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", shell: false });
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    // The group already exited.
  }
}
