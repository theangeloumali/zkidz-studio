// Created by The Angelo Umali.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { projects } from "@zks/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestServer, type TestServer } from "../support/test-server.ts";
import { anchoredKeyword, callTool, messageOf } from "./cue-fixtures.ts";
import { argumentAfter, fakeEngine, withEngine } from "./fake-engine.ts";
import { createToolFixture, type ToolFixture } from "./tool-fixtures.ts";

let server: TestServer;
beforeAll(async () => {
  server = await createTestServer();
});
afterAll(async () => {
  await server.close();
});

const BEATS = [{ at: 12.4, word: "savings", visual: "phoneScreen savings ring fills", ground: "footage" }];

async function useLearningTheme(fixture: ToolFixture): Promise<void> {
  await fixture.context.db
    .update(projects)
    .set({ style: { theme: "learning" } })
    .where(eq(projects.id, fixture.context.projectId));
}

describe("set_beat_map", () => {
  it("stores the beat map in the project's work folder and returns its length", async () => {
    const fixture = await createToolFixture(server);
    const result = await callTool(fixture, "set_beat_map", { beats: BEATS });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ beats: 1 });
    const stored = JSON.parse(await readFile(join(fixture.projectRoot, "work", "research", "beat-map.json"), "utf8")) as unknown;
    expect(stored).toEqual({ beats: BEATS });
  });
});

describe("add_cue on a learning project", () => {
  it("refuses the first cue until a beat map exists, naming set_beat_map", async () => {
    const fixture = await createToolFixture(server);
    await useLearningTheme(fixture);
    const result = await callTool(fixture, "add_cue", { sheet: "main", cue: anchoredKeyword() });
    expect(result.isError).toBe(true);
    expect(messageOf(result)).toContain("set_beat_map");
  });
});

describe("frame_faces", () => {
  it("asks the engine for the project's video over the span and returns its face samples", async () => {
    const report = { band: [0, 420, 1080, 1080], samples: [{ t: 3, faces: [{ box: [480, 600, 120, 150], score: 0.93 }] }] };
    const engine = fakeEngine(() => report);
    const fixture = withEngine(await createToolFixture(server), engine.engine);
    const result = await callTool(fixture, "frame_faces", { at: 2, end: 8, fps: 2 });
    expect(result.isError, messageOf(result)).toBeUndefined();
    expect(result.structuredContent).toEqual(report);
    const [request] = engine.requests;
    expect(request?.command).toBe("frame-faces");
    expect([argumentAfter(request, "--video"), argumentAfter(request, "--at"), argumentAfter(request, "--end"), argumentAfter(request, "--fps")]).toEqual([
      "v1",
      "2",
      "8",
      "2",
    ]);
  });

  it("turns a report of the wrong shape into a tool error", async () => {
    const fixture = withEngine(await createToolFixture(server), fakeEngine(() => ({ faces: "none" })).engine);
    const result = await callTool(fixture, "frame_faces", {});
    expect(result.isError).toBe(true);
  });
});
