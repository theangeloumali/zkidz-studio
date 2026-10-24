// Created by The Angelo Umali.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createCompositionBuilder } from "../../src/preview/composition-builder.ts";
import { createPreviewService } from "../../src/preview/preview-service.ts";
import { writeAgentSpec } from "../../src/tools/spec-store.ts";
import { createTestServer, getRequest, type TestServer } from "../support/test-server.ts";
import { createToolFixture, cutSpecFor, insertCameraAsset } from "../tools/tool-fixtures.ts";

const PREVIEW_ENTRY = fileURLToPath(new URL("../../../../packages/engine/hf/preview/worker.js", import.meta.url));

let server: TestServer;
beforeAll(async () => {
  server = await createTestServer((base) => ({
    previewService: createPreviewService({
      database: base.database.db,
      studioHome: base.studioHome,
      eventBus: base.eventBus,
      logger: base.logger,
      previewPort: 4318,
      buildComposition: createCompositionBuilder({ workerScriptPath: PREVIEW_ENTRY, studioHome: base.studioHome }),
    }),
  }));
});
afterAll(async () => {
  await server.close();
});

const clipStartsIn = (html: string) => [...html.matchAll(/class="clip" data-start="([\d.]+)"/g)].map((match) => Number(match[1]));

describe("the live preview loop, on the real engine build", () => {
  it("moves a cue's clip on the edited timeline when set_cuts removes footage before it", async () => {
    const fixture = await createToolFixture(server);
    const asset = await insertCameraAsset(fixture);
    await writeAgentSpec(fixture.context, { videoId: "v1", kind: "cuts" }, cutSpecFor(asset.id));
    await writeAgentSpec(fixture.context, { videoId: "v1", kind: "cues" }, [{ id: "c1", kind: "keyword", at: 12, end: 14, text: "word" }]);
    const readyCount = () => fixture.events.filter((event) => event.type === "preview.ready").length;
    const indexHtml = () => readFile(join(fixture.projectRoot, "work/preview/v1/index.html"), "utf8");

    await getRequest(server, `/api/projects/${fixture.context.projectId}/videos/v1/edl`);
    await vi.waitFor(() => expect(readyCount()).toBe(1), { timeout: 20_000 });
    const [startBefore] = clipStartsIn(await indexHtml());

    await writeAgentSpec(fixture.context, { videoId: "v1", kind: "cuts" }, cutSpecFor(asset.id, [{ at: 2, end: 4, reason: "false start" }]));
    await vi.waitFor(() => expect(readyCount()).toBe(2), { timeout: 20_000 });
    const [startAfter] = clipStartsIn(await indexHtml());

    expect(startBefore).toBeCloseTo(12, 1);
    expect(startAfter).toBeCloseTo(10, 1);
  }, 60_000);
});
