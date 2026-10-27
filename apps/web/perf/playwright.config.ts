// Created by The Angelo Umali.
// `pnpm -F @zks/web perf`: every plan §9.5 budget. watch-build's catch-up and timeline tests run as they stand on the e2e
// harness; the budget checks get a second harness, because connecting Claude there would change watch-build's editor.
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
import e2eConfig from "../playwright.config.ts";
import { findFreePorts } from "../e2e/support/free-ports.ts";

const LOOPBACK = "127.0.0.1";
const WEB_DIR = fileURLToPath(new URL("../", import.meta.url));
const watchBuildProject = e2eConfig.projects?.find((project) => project.name === "watch-build");
if (watchBuildProject === undefined) throw new Error("perf expects the e2e config's watch-build project");

// Workers re-evaluate this file, so the ports are picked once and handed down through the environment.
if (process.env["ZKS_PERF_PORT"] === undefined || process.env["ZKS_PERF_PREVIEW_PORT"] === undefined) {
  // Exclude the e2e harness's two ports, picked a moment earlier by the imported config and already released.
  const taken = new Set([process.env["ZKS_E2E_PORT"], process.env["ZKS_E2E_PREVIEW_PORT"]]);
  const [budgetsAppPort, budgetsPreview] = (await findFreePorts(4)).filter((port) => !taken.has(String(port)));
  process.env["ZKS_PERF_PORT"] ??= String(budgetsAppPort);
  process.env["ZKS_PERF_PREVIEW_PORT"] ??= String(budgetsPreview);
}
const budgetsPort = process.env["ZKS_PERF_PORT"];
const budgetsPreviewPort = process.env["ZKS_PERF_PREVIEW_PORT"];
const budgetsOrigin = `http://${LOOPBACK}:${budgetsPort}`;

const e2eServer = e2eConfig.webServer;
if (e2eServer === undefined || Array.isArray(e2eServer)) throw new Error("perf expects the e2e config to start one harness");
const watchBuildServer = { ...e2eServer, cwd: WEB_DIR };
const budgetsServer = {
  ...watchBuildServer,
  url: `${budgetsOrigin}/`,
  env: { ZKS_E2E_PORT: budgetsPort, ZKS_E2E_PREVIEW_PORT: budgetsPreviewPort },
};

export default defineConfig({
  ...e2eConfig,
  testDir: ".",
  reporter: [["list"], ["./budget-reporter.ts"]],
  webServer: [watchBuildServer, budgetsServer],
  projects: [
    { ...watchBuildProject, testDir: `${WEB_DIR}e2e`, grep: [/the preview catches up within 3 s/, /a 2,000-cue timeline/] },
    { name: "budgets", testMatch: "*.perf.ts", use: { baseURL: budgetsOrigin, launchOptions: watchBuildProject.use?.launchOptions } },
  ],
});
