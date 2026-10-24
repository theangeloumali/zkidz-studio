// Created by The Angelo Umali.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPreviewService, type PreviewBuildRequest } from "../../src/preview/preview-service.ts";
import { writeAgentSpec } from "../../src/tools/spec-store.ts";
import { createTestServer, getRequest, type TestServer } from "../support/test-server.ts";
import { createToolFixture, cutSpecFor, insertCameraAsset, type ToolFixture } from "../tools/tool-fixtures.ts";

const builds: PreviewBuildRequest[] = [];
// The engine EDL each build found on disk, keyed like the builds.
const edlsAtBuild: unknown[] = [];
let failingVideoId: string | null = null;
let server: TestServer;
beforeAll(async () => {
  server = await createTestServer((base) => ({
    previewService: createPreviewService({
      database: base.database.db,
      studioHome: base.studioHome,
      eventBus: base.eventBus,
      logger: base.logger,
      previewPort: 4318,
      buildComposition: async (request) => {
        builds.push(request);
        edlsAtBuild.push(JSON.parse(await readFile(join(request.projectRoot, "work/edl", `${request.videoId}.json`), "utf8")));
        if (request.videoId === failingVideoId) throw new Error("build failed");
      },
    }),
  }));
});
afterAll(async () => {
  await server.close();
});

async function fixtureWithCuts(): Promise<ToolFixture> {
  const fixture = await createToolFixture(server);
  const asset = await insertCameraAsset(fixture);
  const removals = [
    { at: 10, end: 12, reason: "um" },
    { at: 2, end: 4, reason: "false start" },
  ];
  await writeAgentSpec(fixture.context, { videoId: "v1", kind: "cuts" }, cutSpecFor(asset.id, removals));
  return fixture;
}

const edlPath = (fixture: ToolFixture, videoId = "v1") => `/api/projects/${fixture.context.projectId}/videos/${videoId}/edl`;

describe("the player EDL", () => {
  it("maps the kept source spans of the current cuts onto the edited timeline", async () => {
    const fixture = await fixtureWithCuts();

    const response = await getRequest(server, edlPath(fixture));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      videoId: "v1",
      cutsVersion: 1,
      durationS: 30,
      keptS: 26,
      preview: null,
      segments: [
        { sourceAtS: 0, sourceEndS: 2, editedAtS: 0 },
        { sourceAtS: 4, sourceEndS: 10, editedAtS: 2 },
        { sourceAtS: 12, sourceEndS: 30, editedAtS: 8 },
      ],
    });
  });

  it("is a 404 before the video has a cut spec", async () => {
    const fixture = await createToolFixture(server);
    const response = await getRequest(server, edlPath(fixture, "v7"));
    expect(response.status).toBe(404);
  });
});

describe("the composition rebuild", () => {
  it("rebuilds after a spec change and announces preview.ready on the preview origin", async () => {
    const fixture = await fixtureWithCuts();
    await getRequest(server, edlPath(fixture));

    await writeAgentSpec(fixture.context, { videoId: "v1", kind: "cues" }, { cues: [] });

    await vi.waitFor(() => expect(fixture.events.filter((event) => event.type === "preview.ready")).toHaveLength(2));
    const readyEvents = fixture.events.filter((event) => event.type === "preview.ready");
    expect(readyEvents.at(-1)).toMatchObject({ videoId: "v1", edlVersion: 1 });
    const compositionUrl = new URL(String(readyEvents.at(-1)?.type === "preview.ready" ? readyEvents.at(-1)?.compositionUrl : ""));
    expect(compositionUrl.origin).toBe("http://127.0.0.1:4318");
    expect(compositionUrl.pathname).toBe(`/compositions/${fixture.context.projectId}/v1/index.html`);
    expect(builds.filter((build) => build.projectRoot === fixture.projectRoot).map((build) => build.videoId)).toEqual(["v1", "v1"]);
  });

  it("hands a page opened after the build the composition it missed", async () => {
    const fixture = await fixtureWithCuts();
    await getRequest(server, edlPath(fixture));
    await vi.waitFor(() => expect(fixture.events.some((event) => event.type === "preview.ready")).toBe(true));
    const ready = fixture.events.find((event) => event.type === "preview.ready");

    const reopened = await getRequest(server, edlPath(fixture));

    expect(ready?.type).toBe("preview.ready");
    if (ready?.type !== "preview.ready") return;
    expect(await reopened.json()).toMatchObject({ preview: { compositionUrl: ready.compositionUrl, edlVersion: ready.edlVersion } });
  });

  it("announces nothing when the build fails", async () => {
    const fixture = await createToolFixture(server);
    const asset = await insertCameraAsset(fixture);
    failingVideoId = "v3";
    await writeAgentSpec(fixture.context, { videoId: "v3", kind: "cuts" }, cutSpecFor(asset.id));

    await getRequest(server, edlPath(fixture, "v3"));

    await vi.waitFor(() => expect(server.logLines.some((line) => line.includes("preview build failed"))).toBe(true));
    expect(fixture.events.some((event) => event.type === "preview.ready")).toBe(false);
    failingVideoId = null;
  });
});

describe("the engine EDL a build reads", () => {
  const edlBuiltFor = (fixture: ToolFixture) => edlsAtBuild.filter((_edl, index) => builds[index]?.projectRoot === fixture.projectRoot);

  it("is written from the current cuts, frame-snapped, before the build", async () => {
    const fixture = await fixtureWithCuts();

    await getRequest(server, edlPath(fixture));

    await vi.waitFor(() => expect(edlBuiltFor(fixture)).toHaveLength(1));
    expect(edlBuiltFor(fixture)[0]).toEqual({
      fps_num: 30000,
      fps_den: 1001,
      frames: 779,
      reel: false,
      segments: [
        { in: 0, out: 60, target: 0 },
        { in: 120, out: 300, target: 60 },
        { in: 360, out: 899, target: 240 },
      ],
      bleeps: [],
      cutaways: [],
    });
  });

  it("follows a set_cuts change into the rebuild", async () => {
    const fixture = await fixtureWithCuts();
    await getRequest(server, edlPath(fixture));
    await vi.waitFor(() => expect(edlBuiltFor(fixture)).toHaveLength(1));
    const asset = await insertCameraAsset(fixture);

    await writeAgentSpec(
      fixture.context,
      { videoId: "v1", kind: "cuts" },
      { ...cutSpecFor(asset.id, [{ at: 0, end: 20, reason: "intro" }]), bleeps: [{ at: 25, end: 26, x: 540, y: 960 }] },
    );

    await vi.waitFor(() => expect(edlBuiltFor(fixture)).toHaveLength(2));
    expect(edlBuiltFor(fixture)[1]).toMatchObject({ frames: 300, segments: [{ in: 599, out: 899, target: 0 }], bleeps: [{ at: 25, end: 26, x: 540, y: 960 }] });
  });
});
