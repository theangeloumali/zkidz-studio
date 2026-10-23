// Created by The Angelo Umali.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createProjectDirs, projectDir } from "../../src/config.ts";
import { createCompositionBuilder } from "../../src/preview/composition-builder.ts";
import { createPreviewOrigin } from "../../src/preview/preview-origin.ts";
import { createTestServer, insertProject, type TestServer } from "../support/test-server.ts";

// The engine's real preview worker, as main.ts runs it.
const PREVIEW_WORKER = fileURLToPath(new URL("../../../../packages/engine/hf/preview/worker.js", import.meta.url));
const FAKE_WORKER = fileURLToPath(new URL("./fake-preview-worker.mjs", import.meta.url));
const FRAMES = 300;
const EDL = { fps_num: 30, fps_den: 1, frames: FRAMES, reel: false, segments: [{ in: 0, out: FRAMES, target: 0 }], bleeps: [], cutaways: [] };

let server: TestServer;
let project: { id: string; slug: string };
let projectRoot: string;
beforeAll(async () => {
  server = await createTestServer();
  project = await insertProject(server);
  await createProjectDirs(server.studioHome, project.slug);
  projectRoot = projectDir(server.studioHome, project.slug);
});
afterAll(async () => {
  await server.close();
});

async function seedWork(relPath: string, content: unknown) {
  await mkdir(dirname(join(projectRoot, relPath)), { recursive: true });
  await writeFile(join(projectRoot, relPath), JSON.stringify(content));
}

describe("the composition builder", () => {
  it("builds the engine's preview and the preview origin serves it", async () => {
    await seedWork("work/edl/v1.json", EDL);
    await seedWork("work/cues/v1.json", [{ kind: "keyword", at: 3, end: 5, text: "word" }]);
    const buildComposition = createCompositionBuilder({ workerScriptPath: PREVIEW_WORKER, studioHome: server.studioHome });

    await buildComposition({ projectRoot, videoId: "v1" });
    buildComposition.close();

    const origin = createPreviewOrigin({ database: server.database.db, studioHome: server.studioHome, appPort: 4317, previewPort: 4318 });
    const response = await origin.request(`/compositions/${project.id}/v1/index.html`, { headers: { host: "127.0.0.1:4318" } });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('class="clip"');
  }, 30_000);

  it("rejects with the engine's message when the build fails", async () => {
    const buildComposition = createCompositionBuilder({ workerScriptPath: PREVIEW_WORKER, studioHome: server.studioHome });
    await expect(buildComposition({ projectRoot, videoId: "v9" })).rejects.toThrow(/preview build failed: .*ENOENT/);
    buildComposition.close();
  }, 30_000);

  // A fresh node per build spent ~1.9 s loading modules for ~80 ms of work, past the 3 s preview budget.
  it("keeps one warm worker across builds and replaces it when it dies", async () => {
    const pidLog = join(projectRoot, "worker-pids.log");
    vi.stubEnv("FAKE_WORKER_PID_LOG", pidLog);
    const buildComposition = createCompositionBuilder({ workerScriptPath: FAKE_WORKER, studioHome: server.studioHome, inheritEnv: ["FAKE_WORKER_PID_LOG"] });
    try {
      for (const videoId of ["v1", "v2", "v3"]) await buildComposition({ projectRoot, videoId });
      await expect(buildComposition({ projectRoot, videoId: "bad" })).rejects.toThrow("preview build failed: no cues for bad");
      expect((await readFile(pidLog, "utf8")).trim().split("\n")).toHaveLength(1);

      await expect(buildComposition({ projectRoot, videoId: "crash" })).rejects.toThrow(/preview worker exited/);
      await buildComposition({ projectRoot, videoId: "v1" });
      expect((await readFile(pidLog, "utf8")).trim().split("\n")).toHaveLength(2);
    } finally {
      buildComposition.close();
      vi.unstubAllEnvs();
    }
  }, 30_000);
});
