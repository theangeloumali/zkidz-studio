// Created by The Angelo Umali.
// The real demo render: opt-in, since it needs the GPU ffmpeg and Chrome from `pnpm -s zks tools path`.
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createDemoRunner } from "../../src/onboarding/demo-runner.ts";

const ENGINE_DIR = fileURLToPath(new URL("../../../../packages/engine", import.meta.url));
const DEMO_SCRIPT = fileURLToPath(new URL("../../../../examples/demo/make_demo.py", import.meta.url));
const RENDER_TIMEOUT_MS = 10 * 60 * 1000;
const hasRenderTools = Boolean(process.env["ZKS_FFMPEG"] && process.env["ZKS_CHROME"]);

describe.skipIf(!hasRenderTools)("demo runner", () => {
  it(
    "renders the demo master into a project folder that has no footage",
    async () => {
      const studioHome = await mkdtemp(join(tmpdir(), "zks-demo-"));
      const projectRoot = join(studioHome, "projects", "demo");
      try {
        await createDemoRunner({ engineDir: ENGINE_DIR, demoScript: DEMO_SCRIPT, studioHome }).run(await emptyDemoProject(projectRoot));
        expect((await stat(join(projectRoot, "work", "out", "v1.mp4"))).size).toBeGreaterThan(0);
      } finally {
        await rm(studioHome, { recursive: true, force: true });
      }
    },
    RENDER_TIMEOUT_MS,
  );
});

async function emptyDemoProject(projectRoot: string): Promise<string> {
  await mkdir(join(projectRoot, "media"), { recursive: true });
  await writeFile(join(projectRoot, ".zks-demo"), "");
  return projectRoot;
}
