// Created by The Angelo Umali.
// The studio's own pinned binaries; ffmpeg or Chrome from PATH would make renders machine-dependent.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

export function pinnedToolPath(envName: string, toolName: string): string {
  const fromEnv = process.env[envName];
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  return execFileSync("pnpm", ["-s", "zks", "tools", "path", toolName], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}
