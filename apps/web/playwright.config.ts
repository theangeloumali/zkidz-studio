// Created by The Angelo Umali.
import { defineConfig, devices } from "@playwright/test";
import { findFreePorts } from "./e2e/support/free-ports.ts";
import { pinnedToolPath } from "./e2e/support/pinned-tools.ts";

const LOOPBACK = "127.0.0.1";

// Workers re-evaluate this file, so the harness ports are picked once and handed down through the environment.
if (process.env.ZKS_E2E_PORT === undefined || process.env.ZKS_E2E_PREVIEW_PORT === undefined) {
  const [appPort, previewPort] = await findFreePorts(2);
  process.env.ZKS_E2E_PORT ??= String(appPort);
  process.env.ZKS_E2E_PREVIEW_PORT ??= String(previewPort);
}
const harnessOrigin = `http://${LOOPBACK}:${process.env.ZKS_E2E_PORT}`;
// The spawned servers inherit these, so their renders and proxy videos use the pinned ffmpeg too.
process.env.ZKS_FFMPEG = pinnedToolPath("ZKS_FFMPEG", "ffmpeg");
process.env.ZKS_CHROME = pinnedToolPath("ZKS_CHROME", "chrome-headless-shell");
const launchOptions = { executablePath: process.env.ZKS_CHROME };

export default defineConfig({
  // The servers serve apps/web/dist, built by the e2e script: Playwright starts webServer before any globalSetup.
  testDir: "e2e",
  // One studio server and one GPU-free render at a time keeps the run deterministic.
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: [["list"]],
  use: { trace: "retain-on-failure" },
  projects: [
    // Phase 4: the editor against the in-process harness below, which plays the agent through /__control/*.
    { name: "watch-build", testMatch: /watch-build\.spec\.ts$/, timeout: 120_000, use: { baseURL: harnessOrigin, launchOptions } },
    // Phase 5: each worker spawns its own studio server (e2e/support/studio-fixture.ts).
    { name: "render", testMatch: /render(-frozen)?\.spec\.ts$/, use: { ...devices["Desktop Chrome"], launchOptions } },
  ],
  webServer: { command: "node e2e/harness/serve.ts", url: `${harnessOrigin}/`, timeout: 300_000, reuseExistingServer: false, stdout: "pipe" },
});
