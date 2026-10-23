// Created by The Angelo Umali.
// The real demo render: opt-in, since it needs the GPU ffmpeg and Chrome from `pnpm -s zks tools path`.
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { ReportProgress } from "../../src/jobs/job-runner.ts";
import { createDemoRunner, watchDemoStages } from "../../src/onboarding/demo-runner.ts";

const ENGINE_DIR = fileURLToPath(new URL("../../../../packages/engine", import.meta.url));
const DEMO_SCRIPT = fileURLToPath(new URL("../../../../examples/demo/make_demo.py", import.meta.url));
const RENDER_TIMEOUT_MS = 10 * 60 * 1000;
const hasRenderTools = Boolean(process.env["ZKS_FFMPEG"] && process.env["ZKS_CHROME"]);

const TEST_POLL_MS = 5;
type JobProgress = Parameters<ReportProgress>[0];

describe("demo stage watcher", () => {
  it("reports each make_demo.py stage once, in order, as its marker file appears", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "zks-demo-stages-"));
    const reports: JobProgress[] = [];
    const watcher = watchDemoStages(projectRoot, (progress) => Promise.resolve(void reports.push(progress)), TEST_POLL_MS);
    try {
      for (const marker of ["work/cues/v1.json", "work/edl/v1.json", "work/audio/v1_edit.wav"]) {
        const reportsBefore = reports.length;
        await vi.waitFor(() => expect(reports.length).toBe(reportsBefore + 1));
        await mkdir(join(projectRoot, marker, ".."), { recursive: true });
        await writeFile(join(projectRoot, marker), "");
      }
      await vi.waitFor(() => expect(reports).toHaveLength(4));
    } finally {
      await watcher.stop();
      await rm(projectRoot, { recursive: true, force: true });
    }
    expect(reports).toEqual([
      { stage: "generating clip", pct: 0 },
      { stage: "preparing", pct: 25 },
      { stage: "mixing audio", pct: 50 },
      { stage: "rendering", pct: 75 },
    ]);
  });

  it("surfaces a failed report when stopped", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "zks-demo-stages-"));
    const watcher = watchDemoStages(projectRoot, () => Promise.reject(new Error("database gone")), TEST_POLL_MS);
    try {
      await expect(watcher.stop()).rejects.toThrow("database gone");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!hasRenderTools)("demo runner", () => {
  it(
    "renders the demo master into a project folder that has no footage",
    async () => {
      const studioHome = await mkdtemp(join(tmpdir(), "zks-demo-"));
      const projectRoot = join(studioHome, "projects", "demo");
      try {
        await createDemoRunner({ engineDir: ENGINE_DIR, demoScript: DEMO_SCRIPT, studioHome }).run(await emptyDemoProject(projectRoot), () =>
          Promise.resolve(),
        );
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
