// Created by The Angelo Umali.
// The engine CLI as an EngineRunner: argv only, never a shell, JSON report on stdout (plan D8).
import { execFile } from "node:child_process";
import { delimiter } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { EngineRunner } from "./engine-jobs.ts";

const runFile = promisify(execFile);
const MAX_REPORT_BYTES = 64 * 1024 * 1024;
const STDERR_TAIL_CHARS = 2000;
// An allowlist, not a denylist: the server's env carries Claude, cloud and database credentials (plan §11).
const OS_BASICS = ["PATH", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TMP", "TEMP", "TMPDIR", "SystemRoot", "ComSpec", "PATHEXT", "LANG"];
// ZKS_BACKEND pins the engine's backend: the GPU probe can pass on a host whose Vulkan (libplacebo) still fails.
const ENGINE_OVERRIDES = ["ZKS_BACKEND", "ZKS_FFMPEG", "ZKS_FFPROBE", "ZKS_CHROME", "ZKS_JOBS", "XDG_CACHE_HOME", "XDG_DATA_HOME"];
const PROXY_VARS = ["HTTPS_PROXY", "NO_PROXY", "NODE_EXTRA_CA_CERTS"];

export interface CliEngineOptions {
  /** `uv` in production, with prefixArgs `run --project <engine dir> zks-engine`. */
  readonly executable: string;
  readonly prefixArgs: readonly string[];
  readonly studioHome: string;
  readonly proxyOptIn?: boolean;
  /** Defaults to process.env; injectable so tests can hand in a hostile parent. */
  readonly parentEnv?: Readonly<Record<string, string | undefined>>;
}

/** The engine refused the input and said why on stdout (`{"error": {code, message}}`); the message is safe to show Claude. */
export class EngineReportedError extends Error {
  override readonly name = "EngineReportedError";
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const EngineErrorReportSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

function engineErrorReport(error: unknown): { code: string; message: string } | undefined {
  if (typeof error !== "object" || error === null || !("stdout" in error)) return undefined;
  try {
    const parsed = EngineErrorReportSchema.safeParse(JSON.parse(String(error.stdout)));
    return parsed.success ? parsed.data.error : undefined;
  } catch {
    return undefined; // stdout was not a report; the stderr path below explains the failure
  }
}

export function createCliEngineRunner(options: CliEngineOptions): EngineRunner {
  return {
    run: async ({ command, args, workDir, inPlacePaths = [] }) => {
      const argv = [...options.prefixArgs, command, "--json", ...args];
      const env = { ...buildEngineEnv(options), ZKS_HOME: options.studioHome, ZKS_WORK: workDir, ZKS_INPLACE: inPlacePaths.join(delimiter) };
      try {
        const { stdout } = await runFile(options.executable, argv, { cwd: workDir, env, maxBuffer: MAX_REPORT_BYTES, shell: false });
        return JSON.parse(stdout) as unknown;
      } catch (error) {
        const report = engineErrorReport(error);
        if (report !== undefined) throw new EngineReportedError(report.code, report.message);
        const stderr = typeof error === "object" && error !== null && "stderr" in error ? String(error.stderr) : "";
        throw new Error(`zks-engine ${command} failed: ${stderr.slice(-STDERR_TAIL_CHARS).trim() || String(error)}`, { cause: error });
      }
    },
  };
}

export function buildEngineEnv(options: Pick<CliEngineOptions, "proxyOptIn" | "parentEnv">): Record<string, string> {
  const parentEnv = options.parentEnv ?? process.env;
  const localeNames = Object.keys(parentEnv).filter((name) => name.startsWith("LC_"));
  const names = [...OS_BASICS, ...localeNames, ...ENGINE_OVERRIDES, ...(options.proxyOptIn === true ? PROXY_VARS : [])];
  return Object.fromEntries(names.flatMap((name) => (parentEnv[name] ? [[name, parentEnv[name]]] : [])));
}
