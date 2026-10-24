// Created by The Angelo Umali.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ENV, STUDIO_TOOLS } from "@zks/shared";
import { findOnPath } from "@zks/shared/node";
import type { CheckResult } from "./checks.ts";
import type { ZksContext } from "./context.ts";
import { bootstrapDirs, runCommand, type CommandRunner } from "./exec.ts";
import { toolExecutablePath } from "./tools.ts";

export const ENGINE_DIR = fileURLToPath(new URL("../../engine", import.meta.url));
const SETUP_FIX = "run: pnpm zks setup";
// Six backends at up to 20 s per probe step, plus a cold uv sync on a slow disk.
const ENGINE_TIMEOUT_MS = 600_000;

interface EncodeAttempt {
  backend: string;
  encoder: string;
  ok: boolean;
}
interface EngineReport {
  capabilities?: unknown;
  attempts?: EncodeAttempt[];
  error?: { message: string };
}

function parseReport(stdout: string): EngineReport | undefined {
  try {
    return JSON.parse(stdout) as EngineReport;
  } catch {
    return undefined;
  }
}

function failed(detail: string, fix?: string): CheckResult {
  return { id: "gpu", status: "fail", required: true, detail, ...(fix ? { fix } : {}) };
}

/** The engine's own probe (plan §7.2) writes ZKS_HOME/capabilities.json; doctor reports the profile it chose. */
export function checkCapabilities(
  context: ZksContext,
  ffmpegPath: string,
  run: CommandRunner = runCommand,
  uv = findOnPath("uv", bootstrapDirs(context.toolsDir, "uv")),
): CheckResult {
  // Doctor never creates ZKS_HOME: setup makes it owner-only first.
  if (!existsSync(context.home)) return failed("ZKS_HOME does not exist yet", SETUP_FIX);
  if (!uv) return failed("uv not found, so the engine cannot run", "run: ./setup.sh (or setup.cmd on Windows)");
  const chromePath = toolExecutablePath(context, "chrome-headless-shell");
  const env = { [ENV.home]: context.home, [ENV.ffmpeg]: ffmpegPath, ...(chromePath && existsSync(chromePath) ? { [ENV.chrome]: chromePath } : {}) };
  const output = run(uv, ["run", "--project", ENGINE_DIR, "zks-engine", "capabilities", "--json"], ENGINE_TIMEOUT_MS, env);
  const report = parseReport(output.stdout);
  const capabilities = STUDIO_TOOLS.get_capabilities.output.safeParse(report?.capabilities);
  if (output.code !== 0 || !capabilities.success) {
    const reason = report?.error?.message ?? (output.stderr.trim().split(/\r?\n/).at(-1) || "no report");
    return failed(`zks-engine capabilities: ${reason}`, SETUP_FIX);
  }
  const attempts = report?.attempts ?? [];
  const { profile } = capabilities.data;
  const data = { attempts, capabilities: capabilities.data };
  if (!attempts.some((attempt) => attempt.ok)) return { ...failed("no encoder passed a test encode, CPU included", SETUP_FIX), data };
  const encoder = attempts.find((attempt) => attempt.backend === profile)?.encoder ?? "";
  const detail = `${profile} (${encoder}), capabilities.json written`;
  if (profile === "cpu") return { id: "gpu", status: "warn", required: false, detail, fix: "no GPU encoder passed a test encode; renders use the CPU", data };
  return { id: "gpu", status: "ok", required: false, detail, data };
}
