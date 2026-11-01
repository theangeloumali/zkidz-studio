// Created by The Angelo Umali.
// Finds an agent CLI, claude included: absolute PATH dirs only, so cwd can never pick the binary.
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, extname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const VERSION_TIMEOUT_MS = 10_000;
// Unanchored: codex prints "codex-cli 0.164.0", opencode a bare "2.2.0".
const VERSION_PATTERN = /\d+\.\d+\.\d+\S*/;

type Environment = Readonly<Record<string, string | undefined>>;

/** Null when none of the names is an executable file on PATH. */
export async function resolveAgentBinary(
  binaryNames: readonly string[],
  env: Environment,
  platform: NodeJS.Platform = process.platform,
): Promise<string | null> {
  const fileNames = binaryNames.filter((name) => (platform === "win32") === (extname(name) !== ""));
  const dirs = (env["PATH"] ?? env["Path"] ?? "").split(delimiter).filter((dir) => isAbsolute(dir));
  for (const dir of dirs) {
    for (const fileName of fileNames) {
      const candidate = join(dir, fileName);
      if (await isExecutable(candidate)) return candidate;
    }
  }
  return null;
}

/** Null when the binary is missing, does not answer, or prints no version. */
export async function readAgentVersion(binaryPath: string | null, versionArgs: readonly string[]): Promise<string | null> {
  if (binaryPath === null) return null;
  try {
    const { stdout } = await runFile(binaryPath, [...versionArgs], { timeout: VERSION_TIMEOUT_MS, shell: false });
    return VERSION_PATTERN.exec(stdout)?.[0] ?? null;
  } catch {
    return null;
  }
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
