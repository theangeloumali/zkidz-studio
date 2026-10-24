// Created by The Angelo Umali.
import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { defineConfig } from "@playwright/test";

const LOOPBACK = "127.0.0.1";

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer().once("error", reject);
    probe.listen(0, LOOPBACK, () => {
      const address = probe.address();
      probe.close(() => (typeof address === "object" && address !== null ? resolve(address.port) : reject(new Error("no port"))));
    });
  });
}

// Workers re-evaluate this file, so the ports are picked once and handed down through the environment.
process.env["ZKS_E2E_PORT"] ??= String(await findFreePort());
process.env["ZKS_E2E_PREVIEW_PORT"] ??= String(await findFreePort());
const appOrigin = `http://${LOOPBACK}:${process.env["ZKS_E2E_PORT"]}`;
const zksToolPath = (tool: string) =>
  execFileSync("pnpm", ["-s", "zks", "tools", "path", tool], { encoding: "utf8", cwd: new URL("../../..", import.meta.url) })
    .trim()
    .split("\n")
    .at(-1);
const chromePath = zksToolPath("chrome-headless-shell");
// The harness encodes its proxy videos with the pinned ffmpeg.
process.env["ZKS_FFMPEG"] ??= zksToolPath("ffmpeg");

export default defineConfig({
  testDir: ".",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  use: { baseURL: appOrigin, launchOptions: { executablePath: chromePath } },
  webServer: { command: "node harness/serve.ts", url: `${appOrigin}/`, timeout: 300_000, reuseExistingServer: false, stdout: "pipe" },
});
