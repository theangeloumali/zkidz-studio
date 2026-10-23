// Created by The Angelo Umali.
import { existsSync, mkdtempSync, readFileSync, rmSync, statfsSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { APP_PORT, ENV, LOOPBACK_HOST } from "@zks/shared";
import { findOnPath } from "@zks/shared/node";
import type { ZksContext } from "./context.ts";
import { sha256File } from "./download.ts";
import { bootstrapDirs, runCommand, type CommandRunner } from "./exec.ts";
import { listsEncoder, probeGpuBackend } from "./gpu.ts";
import { listModels } from "./models.ts";
import { isWslDrvfsPath } from "./platform.ts";
import { toolExecutablePath } from "./tools.ts";

type CheckStatus = "ok" | "warn" | "fail";
export interface CheckResult {
  id: string;
  status: CheckStatus;
  required: boolean;
  detail: string;
  fix?: string;
  data?: Record<string, unknown>;
}

const SETUP_FIX = "run: pnpm zks setup";
const MIN_NODE = [24, 11] as const;
const MIN_FREE_GB = 20;
const BYTES_PER_GB = 1024 ** 3;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const RENDER_TIMEOUT_MS = 60_000;
// 2.1.295 added onFailure on HTTP hooks, which terminal mode relies on (plan §6.3).
const MIN_CLAUDE_VERSION = [2, 1, 295] as const;
const CLAUDE_INSTALL_URL = "https://code.claude.com/docs/en/setup";
const CLAUDE_UPDATE_FIX = `terminal mode needs Claude Code ${MIN_CLAUDE_VERSION.join(".")}+: run claude update`;
const HEVC_FAMILY = ["hevc_nvenc", "h264_nvenc", "hevc_videotoolbox", "hevc_qsv", "hevc_amf", "hevc_vaapi", "libx265", "libx264"];

function firstLine(text: string): string {
  return text.trim().split(/\r?\n/)[0] ?? "";
}

export function checkNode(): CheckResult {
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  const isSupported = major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1]);
  return {
    id: "node",
    status: isSupported ? "ok" : "fail",
    required: true,
    detail: `v${process.versions.node}`,
    ...(isSupported ? {} : { fix: "run through pnpm so devEngines supplies Node >=24.11: pnpm zks doctor" }),
  };
}

/** pnpm and uv come from PATH or the bootstrap copies setup.sh / setup.ps1 put in ZKS_HOME/tools. */
export function checkBootstrapTool(context: ZksContext, name: "pnpm" | "uv"): CheckResult {
  const executable = findOnPath(name, bootstrapDirs(context.toolsDir, name));
  const version = executable ? runCommand(executable, ["--version"]) : undefined;
  if (!executable || version?.code !== 0)
    return { id: name, status: "fail", required: true, detail: "not found", fix: "run: ./setup.sh (or setup.cmd on Windows)" };
  return { id: name, status: "ok", required: true, detail: firstLine(version.stdout), data: { path: executable } };
}

// --no-cache: uv would otherwise create UV_CACHE_DIR, and doctor must not create ZKS_HOME before setup does (0700).
export function checkPython(context: ZksContext): CheckResult {
  const uv = findOnPath("uv", bootstrapDirs(context.toolsDir, "uv"));
  const found = uv ? runCommand(uv, ["python", "find", "--no-cache"]) : undefined;
  if (!found || found.code !== 0) return { id: "python", status: "fail", required: true, detail: "no Python found by uv", fix: "run: uv python install" };
  const version = runCommand(firstLine(found.stdout), ["--version"]);
  return { id: "python", status: "ok", required: true, detail: firstLine(version.stdout), data: { path: firstLine(found.stdout) } };
}

export async function checkFfmpeg(context: ZksContext): Promise<CheckResult[]> {
  const executable = toolExecutablePath(context, "ffmpeg");
  const version = executable && existsSync(executable) ? runCommand(executable, ["-hide_banner", "-version"]) : undefined;
  if (!executable || version?.code !== 0) {
    const fix = process.env[ENV.ffmpeg] ? `${ENV.ffmpeg} does not run; unset it or point it at a working ffmpeg` : SETUP_FIX;
    return [{ id: "ffmpeg", status: "fail", required: true, detail: "not installed", fix }];
  }
  const encoderListing = runCommand(executable, ["-hide_banner", "-encoders"]).stdout;
  const hwaccels = runCommand(executable, ["-hide_banner", "-hwaccels"])
    .stdout.split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean);
  const ffmpegCheck: CheckResult = {
    id: "ffmpeg",
    status: "ok",
    required: true,
    detail: firstLine(version.stdout),
    data: {
      path: executable,
      sha256: await sha256File(executable),
      encoders: HEVC_FAMILY.filter((encoder) => listsEncoder(encoderListing, encoder)),
      hwaccels,
    },
  };
  const probe = probeGpuBackend(executable, encoderListing, runCommand);
  const gpuCheck: CheckResult =
    probe.backend === "none"
      ? {
          id: "gpu",
          status: "fail",
          required: true,
          detail: "no encoder passed a test encode, CPU included",
          fix: SETUP_FIX,
          data: { attempts: probe.attempts },
        }
      : {
          id: "gpu",
          status: probe.backend === "cpu" ? "warn" : "ok",
          required: false,
          detail: `${probe.backend} (${probe.encoder})`,
          ...(probe.backend === "cpu" ? { fix: "no GPU encoder passed a test encode; renders use the CPU" } : {}),
          data: { attempts: probe.attempts },
        };
  return [ffmpegCheck, gpuCheck];
}

export function checkWhisper(context: ZksContext): CheckResult {
  const executable = toolExecutablePath(context, "whisper-cpp");
  const isRunnable = !!executable && existsSync(executable) && runCommand(executable, ["--help"]).code === 0;
  if (!isRunnable) return { id: "whisper-cpp", status: "fail", required: true, detail: "not installed", fix: SETUP_FIX };
  return { id: "whisper-cpp", status: "ok", required: true, detail: context.lock.tools["whisper-cpp"].version, data: { path: executable } };
}

/** Renders a real page to PNG: a binary that starts but cannot draw (missing libs) fails here. */
export function checkChromeRender(context: ZksContext, executable = toolExecutablePath(context, "chrome-headless-shell")): CheckResult {
  if (!executable || !existsSync(executable)) return { id: "chrome", status: "fail", required: true, detail: "not installed", fix: SETUP_FIX };
  const scratchDir = mkdtempSync(path.join(os.tmpdir(), "zks-doctor-"));
  const screenshotPath = path.join(scratchDir, "render.png");
  try {
    // Same flag as the HyperFrames renderer, which always launches without the sandbox: Ubuntu 23.10+ blocks it via AppArmor.
    const render = runCommand(
      executable,
      ["--no-sandbox", `--user-data-dir=${scratchDir}`, `--screenshot=${screenshotPath}`, "--window-size=64,64", "data:text/html,<p>zks</p>"],
      RENDER_TIMEOUT_MS,
    );
    const isPng = existsSync(screenshotPath) && readFileSync(screenshotPath).subarray(0, 4).equals(PNG_SIGNATURE);
    if (render.code !== 0 || !isPng)
      return { id: "chrome", status: "fail", required: true, detail: firstLine(render.stderr) || "render produced no PNG", fix: SETUP_FIX };
    return {
      id: "chrome",
      status: "ok",
      required: true,
      detail: `chrome-headless-shell ${context.lock.tools["chrome-headless-shell"].version} rendered a page`,
    };
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
  }
}

export function checkModels(context: ZksContext): CheckResult {
  const models = listModels(context);
  const missing = models.filter((model) => model.fetchOnSetup && !model.installed).map((model) => model.name);
  const installed = models.filter((model) => model.installed).map((model) => model.name);
  if (missing.length > 0) return { id: "models", status: "fail", required: true, detail: `missing ${missing.join(", ")}`, fix: SETUP_FIX };
  return { id: "models", status: "ok", required: true, detail: installed.join(", ") };
}

/** Version only: auth state belongs to the user's Claude Code login, never to doctor output. */
export function checkClaude(runner: CommandRunner = runCommand): CheckResult {
  const version = runner("claude", ["--version"]);
  if (version.code !== 0)
    return {
      id: "claude",
      status: "warn",
      required: false,
      detail: "claude not found",
      fix: `needed only for terminal mode; install Claude Code: ${CLAUDE_INSTALL_URL}`,
    };
  const detail = firstLine(version.stdout);
  const installed = parseVersion(detail);
  if (!installed) return { id: "claude", status: "warn", required: false, detail: `unrecognised version: ${detail}`, fix: CLAUDE_UPDATE_FIX };
  if (compareVersions(installed, MIN_CLAUDE_VERSION) < 0)
    return { id: "claude", status: "warn", required: false, detail: `${installed.join(".")} is below ${MIN_CLAUDE_VERSION.join(".")}`, fix: CLAUDE_UPDATE_FIX };
  return { id: "claude", status: "ok", required: false, detail };
}

function parseVersion(text: string): number[] | undefined {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(text);
  return match ? match.slice(1).map(Number) : undefined;
}

function compareVersions(left: readonly number[], right: readonly number[]): number {
  for (const [index, part] of left.entries()) if (part !== right[index]) return part - (right[index] ?? 0);
  return 0;
}

export interface NodePtyCheckOptions {
  loadNodePty?: () => unknown;
  platform?: NodeJS.Platform;
}

// node-pty is the server's dependency, so it is resolved from there; it ships prebuilds for win32 and darwin only.
const requireFromServer = createRequire(new URL("../../../apps/server/package.json", import.meta.url));

const NOT_INSTALLED = "node-pty is not installed";
const REINSTALL_FIX = "terminal mode needs node-pty: run pnpm install";
const TOOLCHAIN_FIX =
  "terminal mode needs a C++ toolchain to build node-pty: sudo apt install build-essential python3 (or your distro's equivalent), then pnpm rebuild node-pty";

function exposesSpawn(module: unknown): boolean {
  return typeof module === "object" && module !== null && "spawn" in module && typeof module.spawn === "function";
}

export function checkNodePty({
  loadNodePty = (): unknown => requireFromServer("node-pty"),
  platform = process.platform,
}: NodePtyCheckOptions = {}): CheckResult {
  let failure: string;
  try {
    if (exposesSpawn(loadNodePty())) return { id: "node-pty", status: "ok", required: false, detail: "loads (terminal mode available)" };
    failure = "loaded without a spawn function";
  } catch (error) {
    const message = firstLine(error instanceof Error ? error.message : String(error));
    failure = message === "Cannot find module 'node-pty'" ? NOT_INSTALLED : message;
  }
  // Only a missing native build on Linux needs the toolchain; elsewhere a reinstall fetches the prebuild.
  const fix = platform === "linux" && failure !== NOT_INSTALLED ? TOOLCHAIN_FIX : REINSTALL_FIX;
  return { id: "node-pty", status: "warn", required: false, detail: failure, fix };
}

/** ZKS_HOME does not exist before setup, but the disk it will land on does. */
function nearestExistingDir(candidate: string): string {
  let current = path.resolve(candidate);
  while (!existsSync(current) && path.dirname(current) !== current) current = path.dirname(current);
  return current;
}

export function checkDisk({ home }: Pick<ZksContext, "home">): CheckResult {
  const stats = statfsSync(nearestExistingDir(home));
  const freeGb = Math.floor((stats.bavail * stats.bsize) / BYTES_PER_GB);
  const isLow = freeGb < MIN_FREE_GB;
  return {
    id: "disk",
    status: isLow ? "warn" : "ok",
    required: false,
    detail: `${freeGb} GB free`,
    ...(isLow ? { fix: `free space: renders need at least ${MIN_FREE_GB} GB` } : {}),
  };
}

export async function checkPort(): Promise<CheckResult> {
  const port = Number(process.env[ENV.port] ?? APP_PORT);
  const isFree = await new Promise<boolean>((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, LOOPBACK_HOST, () => probe.close(() => resolve(true)));
  });
  if (isFree) return { id: "port", status: "ok", required: false, detail: `${port} free` };
  return { id: "port", status: "warn", required: false, detail: `${port} in use`, fix: `stop the other process or set ${ENV.port}` };
}

export function checkWslMount(context: ZksContext): CheckResult | undefined {
  const isWsl = process.platform === "linux" && existsSync("/proc/version") && /microsoft/i.test(readFileSync("/proc/version", "utf8"));
  if (!isWsl) return undefined;
  const onWindowsDrive = [process.cwd(), context.home].some(isWslDrvfsPath);
  if (!onWindowsDrive) return { id: "wsl", status: "ok", required: false, detail: "repo and ZKS_HOME on the Linux filesystem" };
  return {
    id: "wsl",
    status: "warn",
    required: false,
    detail: "repo or ZKS_HOME is under /mnt",
    fix: "clone into ~ and keep ZKS_HOME there: /mnt is several times slower",
  };
}
