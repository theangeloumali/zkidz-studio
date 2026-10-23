// Created by The Angelo Umali.
// Resolves the user's `claude` once at startup (plan §6.3): an absolute path, so pty-host can pin every spawn to it.
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const VERSION_TIMEOUT_MS = 10_000;
const VERSION_PATTERN = /^\d+\.\d+\.\d+\S*/;

type Environment = Readonly<Record<string, string | undefined>>;

/** Null when no executable claude is on PATH; relative PATH entries are skipped so cwd can never pick the binary. */
export async function resolveClaudePath(env: Environment, platform: NodeJS.Platform = process.platform): Promise<string | null> {
  const fileNames = platform === "win32" ? ["claude.exe", "claude.cmd"] : ["claude"];
  const dirs = (env["PATH"] ?? env["Path"] ?? "").split(delimiter).filter((dir) => isAbsolute(dir));
  for (const dir of dirs) {
    for (const fileName of fileNames) {
      const candidate = join(dir, fileName);
      if (await isExecutable(candidate)) return candidate;
    }
  }
  return null;
}

/** The connect screen's version; null when claude is missing or does not answer. */
export async function readClaudeVersion(claudePath: string | null): Promise<string | null> {
  if (claudePath === null) return null;
  try {
    const { stdout } = await runFile(claudePath, ["--version"], { timeout: VERSION_TIMEOUT_MS, shell: false });
    return VERSION_PATTERN.exec(stdout.trim())?.[0] ?? null;
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
