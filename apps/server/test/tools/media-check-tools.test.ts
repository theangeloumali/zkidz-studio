// Created by The Angelo Umali.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EngineReportedError } from "../../src/jobs/engine-process.ts";
import { createTestServer, type TestServer } from "../support/test-server.ts";
import { callTool, messageOf } from "./cue-fixtures.ts";
import { argumentAfter, fakeEngine, insertInPlaceAsset, withEngine } from "./fake-engine.ts";
import { createToolFixture, insertCameraAsset, insertTranscript } from "./tool-fixtures.ts";

const PROBE_REPORT = {
  durationS: 12.5,
  fps: { num: 30000, den: 1001 },
  size: { width: 3840, height: 2160 },
  rotation: 0,
  hdr: false,
  audio: { rate: 48000, channels: 2 },
  vfr: false,
};
const WINDOWS_REPORT = { windows: [{ at: 12.3, end: 13.1, words: [{ at: 12.4, end: 12.9, text: " hello" }] }] };
const ENERGY_REPORT = { stepMs: 50, db: [-30, -42.5, -61], quietRuns: [{ at: 1.1, end: 1.6 }] };
const PHRASES = [{ id: 0, at: 0.2, end: 1.4, reel: null, text: "hello there" }];

let server: TestServer;
let originalsDir: string;
beforeAll(async () => {
  server = await createTestServer();
  originalsDir = await mkdtemp(join(tmpdir(), "zks-originals-"));
});
afterAll(async () => {
  await server.close();
  await rm(originalsDir, { recursive: true, force: true });
});

const engineFailure = (command: string) => () => Promise.reject(new EngineReportedError(command, "bad_input", "the range is past the source"));

describe("probe_media", () => {
  it("probes an uploaded asset's file under the project and returns the engine's metadata", async () => {
    const { engine, requests } = fakeEngine(() => PROBE_REPORT);
    const fixture = withEngine(await createToolFixture(server), engine);
    const asset = await insertCameraAsset(fixture);
    const result = await callTool(fixture, "probe_media", { assetId: asset.id });
    expect(result.structuredContent).toEqual(PROBE_REPORT);
    expect(requests[0]).toMatchObject({
      command: "probe",
      args: [join(fixture.projectRoot, asset.relPath ?? "")],
      workDir: join(fixture.projectRoot, "work"),
      inPlacePaths: [],
    });
  });

  it("hands an in-place original to the engine as an in-place path", async () => {
    const { engine, requests } = fakeEngine(() => PROBE_REPORT);
    const fixture = withEngine(await createToolFixture(server), engine);
    const asset = await insertInPlaceAsset(fixture, originalsDir);
    expect((await callTool(fixture, "probe_media", { assetId: asset.id })).isError).toBeUndefined();
    expect(requests[0]).toMatchObject({ args: [asset.inPlacePath], inPlacePaths: [asset.inPlacePath] });
  });

  it("refuses another project's asset before the engine runs", async () => {
    const { engine, requests } = fakeEngine(() => PROBE_REPORT);
    const fixture = withEngine(await createToolFixture(server), engine);
    const result = await callTool(fixture, "probe_media", { assetId: crypto.randomUUID() });
    expect(result.isError).toBe(true);
    expect(messageOf(result)).toMatch(/not part of this project/);
    expect(requests).toEqual([]);
  });

  it("reports the engine's own refusal as a tool error", async () => {
    const fixture = withEngine(await createToolFixture(server), fakeEngine(engineFailure("probe")).engine);
    const result = await callTool(fixture, "probe_media", { assetId: (await insertCameraAsset(fixture)).id });
    expect(result.isError).toBe(true);
    expect(messageOf(result)).toMatch(/past the source/);
  });
});

describe("check_window", () => {
  // QC's second opinion hears with the transcript's model, so check_window must hear the same window the same way.
  it("asks for each range with the transcript's language and model and returns the windows' words", async () => {
    const { engine, requests } = fakeEngine(() => WINDOWS_REPORT);
    const fixture = withEngine(await createToolFixture(server), engine);
    await insertTranscript(fixture, (await insertCameraAsset(fixture)).id, [{ at: 12.4, end: 12.9, text: " hello" }]);
    const result = await callTool(fixture, "check_window", {
      ranges: [
        { at: 12.3, end: 13.1 },
        { at: 20, end: 21.5 },
      ],
    });
    expect(result.structuredContent).toEqual(WINDOWS_REPORT);
    expect(requests[0]).toMatchObject({
      command: "check-window",
      args: ["--video", "v1", "--range", "12.3-13.1", "--range", "20-21.5", "--language", "en", "--model", "base"],
      workDir: join(fixture.projectRoot, "work"),
    });
  });

  it("leaves the language to the engine before any transcript exists", async () => {
    const { engine, requests } = fakeEngine(() => WINDOWS_REPORT);
    const fixture = withEngine(await createToolFixture(server), engine);
    await callTool(fixture, "check_window", { ranges: [{ at: 1, end: 2 }] });
    expect(requests[0]?.args).not.toContain("--language");
    expect(requests[0]?.args).not.toContain("--model");
  });

  // A malformed report is an engine bug, so it fails the call like any server fault rather than reaching the model.
  it("throws on a report that is not the window contract, and passes an engine refusal on", async () => {
    const malformed = withEngine(await createToolFixture(server), fakeEngine(() => ({ windows: [{ at: 1 }] })).engine);
    await expect(callTool(malformed, "check_window", { ranges: [{ at: 1, end: 2 }] })).rejects.toThrow();
    const refused = withEngine(await createToolFixture(server), fakeEngine(engineFailure("check-window")).engine);
    expect(messageOf(await callTool(refused, "check_window", { ranges: [{ at: 1, end: 2 }] }))).toMatch(/past the source/);
  });
});

describe("energy_profile", () => {
  it("profiles the span and returns the loudness steps and quiet runs", async () => {
    const { engine, requests } = fakeEngine(() => ENERGY_REPORT);
    const fixture = withEngine(await createToolFixture(server), engine);
    const result = await callTool(fixture, "energy_profile", { from: 0.5, to: 3 });
    expect(result.structuredContent).toEqual(ENERGY_REPORT);
    expect(requests[0]).toMatchObject({ command: "energy-profile", args: ["--video", "v1", "--from", "0.5", "--to", "3"] });
  });

  it("refuses an empty or backwards span before the engine runs", async () => {
    const { engine, requests } = fakeEngine(() => ENERGY_REPORT);
    const fixture = withEngine(await createToolFixture(server), engine);
    const result = await callTool(fixture, "energy_profile", { from: 3, to: 3 });
    expect(result.isError).toBe(true);
    expect(messageOf(result)).toMatch(/after from/);
    expect(requests).toEqual([]);
  });
});

describe("make_caption_phrases", () => {
  it("returns the phrases the engine wrote for set_captions", async () => {
    const { engine, requests } = fakeEngine(() => ({ phrases: PHRASES }));
    const fixture = withEngine(await createToolFixture(server), engine);
    const result = await callTool(fixture, "make_caption_phrases", {});
    expect(result.structuredContent).toEqual({ phrases: PHRASES });
    expect(requests[0]).toMatchObject({ command: "caption-phrases", args: ["--video", "v1"] });
  });

  it("asks for the Reels phrases with --reel", async () => {
    const { engine, requests } = fakeEngine(() => ({ phrases: [{ ...PHRASES[0], reel: 0 }] }));
    const fixture = withEngine(await createToolFixture(server), engine);
    expect((await callTool(fixture, "make_caption_phrases", { reel: true })).isError).toBeUndefined();
    expect(requests[0]?.args).toEqual(["--video", "v1", "--reel"]);
    expect(argumentAfter(requests[0], "--video")).toBe("v1");
  });

  it("reports the engine's refusal as a tool error", async () => {
    const fixture = withEngine(await createToolFixture(server), fakeEngine(engineFailure("caption-phrases")).engine);
    expect((await callTool(fixture, "make_caption_phrases", {})).isError).toBe(true);
  });
});
