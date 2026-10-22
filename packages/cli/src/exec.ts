// Created by The Angelo Umali.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

export interface CommandOutput {
  code: number | null;
  stdout: string;
  stderr: string;
}
export type CommandRunner = (command: string, args: string[], timeoutMs?: number) => CommandOutput;

const DEFAULT_TIMEOUT_MS = 30_000;
const isWindows = process.platform === "win32";

export const runCommand: CommandRunner = (command, args, timeoutMs = DEFAULT_TIMEOUT_MS) => {
  // pnpm and claude are .cmd shims on Windows, which only start through a shell; args here are constants, never user input.
  const needsShell = isWindows && !path.isAbsolute(command);
  const child = spawnSync(command, args, { encoding: "utf8", timeout: timeoutMs, windowsHide: true, shell: needsShell });
  return { code: child.error ? null : child.status, stdout: child.stdout ?? "", stderr: child.stderr ?? "" };
};

export function findOnPath(name: string, extraDirs: string[] = []): string | undefined {
  const extensions = isWindows ? (process.env.PATHEXT ?? ".EXE;.CMD").split(";").concat("") : [""];
  const searchDirs = [...extraDirs, ...(process.env.PATH ?? "").split(path.delimiter).filter(Boolean)];
  for (const dir of searchDirs) {
    for (const extension of extensions) {
      const candidate = path.join(dir, name + extension.toLowerCase());
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

/** Versioned bootstrap dirs that setup.sh / setup.ps1 create under ZKS_HOME/tools/<name>/<version>. */
export function bootstrapDirs(toolsDir: string, name: string): string[] {
  const root = path.join(toolsDir, name);
  if (!existsSync(root)) return [];
  return readdirSync(root).map((version) => path.join(root, version));
}
