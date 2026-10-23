// Created by The Angelo Umali.
// The ingest job's engine argv: the project's ingest mode before the clips, and in-place files handed to the engine.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mediaAssets } from "@zks/db/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { writeProjectTemplate } from "../../src/onboarding/project-template.ts";
import { STUDIO_TOOLS_BY_NAME } from "../../src/tools/catalog.ts";
import { registerEngineJobHandlers, type EngineRequest } from "../../src/tools/engine-jobs.ts";
import { createTestServer, type TestServer } from "../support/test-server.ts";
import { createToolFixture, insertCameraAsset, JOINED_SOURCE_PROBE, type ToolFixture } from "./tool-fixtures.ts";

let server: TestServer;
const engineRequests: EngineRequest[] = [];
beforeAll(async () => {
  server = await createTestServer();
  registerEngineJobHandlers(server.jobRunner, {
    db: server.database.db,
    studioHome: server.studioHome,
    engine: {
      run: async (request) => {
        engineRequests.push(request);
        await writeFile(join(request.workDir, "sources", "v1.mkv"), "joined");
        return { sourcePath: "sources/v1.mkv", frames: 900, joins: [{ clip: 0, at: 0 }] };
      },
    },
    probeSource: () => Promise.resolve(JOINED_SOURCE_PROBE),
  });
});
afterAll(async () => {
  await server.close();
});

async function ingest(fixture: ToolFixture, input: unknown): Promise<EngineRequest> {
  const ingestTool = STUDIO_TOOLS_BY_NAME.get("ingest");
  if (ingestTool === undefined) throw new Error("no ingest tool");
  const queued = await ingestTool.run(input, fixture.context);
  const jobId = queued.structuredContent?.jobId;
  if (typeof jobId !== "string") throw new Error(JSON.stringify(queued.content));
  const waitTool = STUDIO_TOOLS_BY_NAME.get("job_wait");
  const waited = await waitTool?.run({ jobId, timeoutS: 10 }, fixture.context);
  expect(waited?.structuredContent).toMatchObject({ status: "succeeded" });
  const request = engineRequests.at(-1);
  if (request === undefined) throw new Error("the engine never ran");
  return request;
}

function modeOf(request: EngineRequest): string | undefined {
  return request.args[request.args.indexOf("--mode") + 1];
}

describe("ingest --mode", () => {
  it("comes before the clips, so the last argument stays a clip", async () => {
    const fixture = await createToolFixture(server);
    const asset = await insertCameraAsset(fixture);
    const request = await ingest(fixture, { clips: [{ assetId: asset.id }] });
    expect(request.args.indexOf("--mode")).toBeLessThan(request.args.indexOf("--clip"));
    expect(modeOf(request)).toBe("single");
  });

  it("is join for several clips when the project has no template", async () => {
    const fixture = await createToolFixture(server);
    const [first, second] = [await insertCameraAsset(fixture), await insertCameraAsset(fixture)];
    expect(modeOf(await ingest(fixture, { clips: [{ assetId: first.id }, { assetId: second.id }] }))).toBe("join");
  });

  it("is showcase when the clip has inserts", async () => {
    const fixture = await createToolFixture(server);
    const [camera, screen] = [await insertCameraAsset(fixture), await insertCameraAsset(fixture)];
    const request = await ingest(fixture, { clips: [{ assetId: camera.id }], inserts: [{ at: 0, end: 5, srcAssetId: screen.id, srcAt: 0 }] });
    expect(modeOf(request)).toBe("showcase");
  });

  it("is the mode stored with the project's template", async () => {
    const fixture = await createToolFixture(server);
    await writeProjectTemplate(server.database.db, fixture.context.projectId, { templateId: "multi-clip", ingestMode: "join" });
    const asset = await insertCameraAsset(fixture);
    expect(modeOf(await ingest(fixture, { clips: [{ assetId: asset.id }] }))).toBe("join");
  });

  it("gives way to the footage when the stored mode cannot take it, since the engine would reject the job", async () => {
    const fixture = await createToolFixture(server);
    await writeProjectTemplate(server.database.db, fixture.context.projectId, { templateId: "talking-head", ingestMode: "single" });
    const [first, second] = [await insertCameraAsset(fixture), await insertCameraAsset(fixture)];
    expect(modeOf(await ingest(fixture, { clips: [{ assetId: first.id }, { assetId: second.id }] }))).toBe("join");
  });
});

describe("ingest in-place files", () => {
  it("lists every in-place clip the engine reads, since it refuses inputs outside the project otherwise", async () => {
    const fixture = await createToolFixture(server);
    const uploaded = await insertCameraAsset(fixture);
    const inPlacePath = join(server.studioHome, "elsewhere", "camera.mp4");
    const [inPlace] = await server.database.db
      .insert(mediaAssets)
      .values({ projectId: fixture.context.projectId, kind: "camera", name: "camera.mp4", inPlacePath, bytes: 16, mtimeMs: 0, durationS: 30 })
      .returning();
    if (inPlace === undefined) throw new Error("asset insert returned no row");
    const request = await ingest(fixture, { clips: [{ assetId: uploaded.id }, { assetId: inPlace.id }] });
    expect(request.inPlacePaths).toEqual([inPlacePath]);
  });
});
