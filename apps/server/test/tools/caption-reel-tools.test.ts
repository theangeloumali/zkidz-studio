// Created by The Angelo Umali.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { writeAgentSpec } from "../../src/tools/spec-store.ts";
import { createTestServer, type TestServer } from "../support/test-server.ts";
import { callTool, messageOf } from "./cue-fixtures.ts";
import { createToolFixture, type ToolFixture } from "./tool-fixtures.ts";

let server: TestServer;
beforeAll(async () => {
  server = await createTestServer();
});
afterAll(async () => {
  await server.close();
});

const PHRASES = [
  { id: 0, at: 0.5, end: 1.5, reel: 0, text: "kumusta kayo" },
  { id: 1, at: 1.6, end: 2.4, reel: 0, text: "mga kaibigan" },
  { id: 2, at: 3, end: 4, reel: null, text: "ngayon" },
];

async function fixtureWithPhrases(): Promise<ToolFixture> {
  const fixture = await createToolFixture(server);
  await mkdir(join(fixture.projectRoot, "work", "captions"), { recursive: true });
  await writeFile(join(fixture.projectRoot, "work", "captions", "v1.phrases.json"), JSON.stringify(PHRASES));
  return fixture;
}

describe("set_captions", () => {
  it("stores the groups as captions/vN.json and counts the caption cues", async () => {
    const fixture = await fixtureWithPhrases();
    const entries = [
      { ids: [0, 1], en: "Hello, friends" },
      { ids: [2], en: "Today" },
    ];
    const result = await callTool(fixture, "set_captions", { entries });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ version: 1, warnings: [], cues: 2 });
    expect(JSON.parse(await readFile(join(fixture.projectRoot, "work", "captions", "v1.json"), "utf8"))).toEqual(entries);
    expect(fixture.events).toContainEqual(expect.objectContaining({ type: "spec.version", kind: "captions", version: 1 }));
  });

  it("asks for the phrases first", async () => {
    const fixture = await createToolFixture(server);
    const result = await callTool(fixture, "set_captions", { entries: [{ ids: [0], en: "Hi" }] });
    expect(result.isError).toBe(true);
    expect(messageOf(result)).toMatch(/make_caption_phrases/);
  });

  it("fails a group that crosses a Reels keep edge", async () => {
    const fixture = await fixtureWithPhrases();
    const result = await callTool(fixture, "set_captions", {
      entries: [
        { ids: [0], en: "Hello" },
        { ids: [1, 2], en: "friends, today" },
      ],
    });
    expect(result.isError).toBe(true);
    expect(messageOf(result)).toMatch(/caption ids \[1,2\] cross a Reels keep edge/);
  });

  it("fails English that wraps to three lines", async () => {
    const fixture = await fixtureWithPhrases();
    const longLine = "This translation keeps going well past what two lines of the caption plate can hold";
    const result = await callTool(fixture, "set_captions", {
      entries: [
        { ids: [0, 1], en: longLine },
        { ids: [2], en: "Today" },
      ],
    });
    expect(result.isError).toBe(true);
    expect(messageOf(result)).toMatch(/wrap to 3 lines/);
  });

  it("fails unknown, non-consecutive, missing and doubled phrase ids", async () => {
    const fixture = await fixtureWithPhrases();
    const unknown = await callTool(fixture, "set_captions", { entries: [{ ids: [7], en: "Hi" }] });
    expect(messageOf(unknown)).toMatch(/\[7\] are not phrases/);
    const gaps = await callTool(fixture, "set_captions", { entries: [{ ids: [0], en: "Hi" }] });
    expect(messageOf(gaps)).toMatch(/phrases without a caption: \[1,2\]/);
    const doubled = await callTool(fixture, "set_captions", {
      entries: [
        { ids: [0, 1], en: "Hi" },
        { ids: [1], en: "again" },
        { ids: [2], en: "Today" },
      ],
    });
    expect(messageOf(doubled)).toMatch(/captioned twice: \[1\]/);
  });
});

describe("set_reel", () => {
  it("stores reels/vN.json, sums the kept seconds and lists the cues the reel drops", async () => {
    const fixture = await createToolFixture(server);
    const mainCues = [
      { kind: "keyword", id: "kept", at: 1, end: 3, text: "kept" },
      { kind: "keyword", id: "mostly-cut", at: 4, end: 8, text: "gone" },
    ];
    await writeAgentSpec(fixture.context, { videoId: "v1", kind: "cues" }, mainCues);

    const keep = [
      { at: 0, end: 4.5 },
      { at: 10, end: 12, pin: true },
    ];
    const result = await callTool(fixture, "set_reel", { keep });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ version: 1, warnings: [], reelId: "v1r", seconds: 6.5, droppedCues: ["mostly-cut"] });
    const stored = JSON.parse(await readFile(join(fixture.projectRoot, "work", "reels", "v1.json"), "utf8")) as unknown;
    expect(stored).toEqual({ schemaVersion: 1, baseVideoId: "v1", keep });
  });

  it("rejects overlapping keeps", async () => {
    const fixture = await createToolFixture(server);
    const result = await callTool(fixture, "set_reel", {
      keep: [
        { at: 0, end: 5 },
        { at: 4, end: 6 },
      ],
    });
    expect(result.isError).toBe(true);
  });
});
