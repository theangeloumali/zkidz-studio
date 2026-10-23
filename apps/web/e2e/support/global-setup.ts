// Created by The Angelo Umali.
// The server serves apps/web/dist, so the specs run against a fresh production build.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export default function buildWebApp(): void {
  execFileSync("pnpm", ["exec", "vite", "build"], { cwd: fileURLToPath(new URL("../../", import.meta.url)), stdio: "inherit" });
}
