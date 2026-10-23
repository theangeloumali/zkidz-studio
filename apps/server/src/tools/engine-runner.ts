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

export function createCliEngineRunner(options: CliEngineOptions): EngineRunner {
  return {
    run: async ({ command, args, workDir, inPlacePaths = [] }) => {
      const argv = [...options.prefixArgs, command, "--json", ...args];
      const env = { ...buildEngineEnv(options), ZKS_HOME: options.studioHome, ZKS_WORK: workDir, ZKS_INPLACE: inPlacePaths.join(delimiter) };
      try {
        const { stdout } = await runFile(options.executable, argv, { cwd: workDir, env, maxBuffer: MAX_REPORT_BYTES, shell: false });
        return JSON.parse(stdout) as unknown;
      } catch (error) {
        throw new Error(`zks-engine ${command} failed: ${failureMessage(error)}`, { cause: error });
      }
    },
  };
}

const ChildOutputSchema = z.object({ stdout: z.string().default(""), stderr: z.string().default("") });
const EngineErrorReportSchema = z.object({ error: z.object({ message: z.string().min(1) }) });

/** The engine's own JSON error when it printed one; stderr is progress lines, so it is only the fallback. */
function failureMessage(error: unknown): string {
  const output = ChildOutputSchema.safeParse(error);
  if (!output.success) return String(error);
  const reported = EngineErrorReportSchema.safeParse(parseJsonOrNull(output.data.stdout));
  if (reported.success) return reported.data.error.message;
  return output.data.stderr.slice(-STDERR_TAIL_CHARS).trim() || String(error);
}

function parseJsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function buildEngineEnv(options: Pick<CliEngineOptions, "proxyOptIn" | "parentEnv">): Record<string, string> {
  const parentEnv = options.parentEnv ?? process.env;
  const localeNames = Object.keys(parentEnv).filter((name) => name.startsWith("LC_"));
  const names = [...OS_BASICS, ...localeNames, ...ENGINE_OVERRIDES, ...(options.proxyOptIn === true ? PROXY_VARS : [])];
  return Object.fromEntries(names.flatMap((name) => (parentEnv[name] ? [[name, parentEnv[name]]] : [])));
}
