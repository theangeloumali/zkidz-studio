// Created by The Angelo Umali.
// sample_reference over real clips made by ffmpeg, and project_info keeping references apart from footage (slice D).
import { execFile } from "node:child_process";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { hasFfmpeg } from "../support/media-fixtures.ts";
import { createTestServer, type TestServer } from "../support/test-server.ts";
import { callTool, messageOf } from "./cue-fixtures.ts";
import { insertReferenceAsset, SHORT_SILENT, TWO_SHOTS_WITH_TONE } from "./reference-fixtures.ts";
import { createToolFixture, insertCameraAsset } from "./tool-fixtures.ts";

const ffmpegAvailable = await hasFfmpeg();
const runFile = promisify(execFile);

let server: TestServer;
beforeAll(async () => {
  server = await createTestServer();
  // The test machine has no pinned ffmpeg under ZKS_HOME; the override is how the server is pointed at one.
  if (ffmpegAvailable) vi.stubEnv("ZKS_FFMPEG", (await runFile("which", ["ffmpeg"])).stdout.trim());
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await server.close();
});

interface SampleOutput {
  durationS: number;
  contactSheet: string;
  frames: { at: number; path: string }[];
  shotChangesPerMinute: number;
  averageShotS: number;
  loudnessLufs: number | null;
}

describe.skipIf(!ffmpegAvailable)("sample_reference", () => {
  it("writes a contact sheet and frames into the work folder and returns them as paths and images", async () => {
    const fixture = await createToolFixture(server);
    const reference = await insertReferenceAsset(fixture, TWO_SHOTS_WITH_TONE);
    const result = await callTool(fixture, "sample_reference", { assetId: reference.id, frames: 3 });
    expect(result.isError, messageOf(result)).toBeFalsy();
    const output = result.structuredContent as unknown as SampleOutput;
    expect(output.contactSheet).toBe(`work/reference/${reference.id}/contact.png`);
    expect(output.frames.map((frame) => frame.path)).toEqual([0, 1, 2].map((index) => `work/reference/${reference.id}/frame-${index + 1}.png`));
    expect(output.frames.every((frame) => frame.at >= 0 && frame.at < 4)).toBe(true);
    for (const path of [output.contactSheet, ...output.frames.map((frame) => frame.path)]) {
      expect((await stat(join(fixture.projectRoot, path))).size).toBeGreaterThan(0);
    }
    expect(result.content.slice(1)).toEqual(Array(4).fill(expect.objectContaining({ type: "image", mimeType: "image/png" })));
  });

  it("reports the pace from shot changes and the integrated loudness", async () => {
    const fixture = await createToolFixture(server);
    const reference = await insertReferenceAsset(fixture, TWO_SHOTS_WITH_TONE);
    const output = (await callTool(fixture, "sample_reference", { assetId: reference.id })).structuredContent as unknown as SampleOutput;
    expect(output.durationS).toBe(4);
    expect(output.shotChangesPerMinute).toBe(15);
    expect(output.averageShotS).toBe(2);
    expect(output.loudnessLufs).toBeLessThan(0);
    expect(output.frames).toHaveLength(6);
  });

  it("samples a reference shorter than 3 s with no audio: one shot and a null loudness", async () => {
    const fixture = await createToolFixture(server);
    const reference = await insertReferenceAsset(fixture, SHORT_SILENT);
    const result = await callTool(fixture, "sample_reference", { assetId: reference.id, frames: 2 });
    expect(result.isError, messageOf(result)).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ durationS: 1.5, shotChangesPerMinute: 0, averageShotS: 1.5, loudnessLufs: null });
  });

  it("opens the reference only as a local file under a container whitelist, never as a playlist or image pattern", async () => {
    const fixture = await createToolFixture(server);
    const reference = await insertReferenceAsset(fixture);
    // A stand-in ffmpeg that records each argv and fails, so the first call's arguments are what is checked.
    const binDir = await mkdtemp(join(tmpdir(), "zks-fake-ffmpeg-"));
    const argsLog = join(binDir, "args.json");
    const fakeFfmpeg = join(binDir, "ffmpeg");
    await writeFile(fakeFfmpeg, `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(argsLog)}\nexit 1\n`, { mode: 0o755 });
    vi.stubEnv("ZKS_FFMPEG", fakeFfmpeg);
    try {
      const result = await callTool(fixture, "sample_reference", { assetId: reference.id, frames: 1 });
      expect(result.isError).toBe(true);
    } finally {
      vi.stubEnv("ZKS_FFMPEG", (await runFile("which", ["ffmpeg"])).stdout.trim());
    }
    const args = (await readFile(argsLog, "utf8")).trim().split("\n");
    const input = args.indexOf("-i");
    const formats = args[args.indexOf("-format_whitelist") + 1]?.split(",") ?? [];
    expect(args.slice(0, input)).toEqual(expect.arrayContaining(["-protocol_whitelist", "file,pipe", "-format_whitelist"]));
    expect(formats).toContain("mov");
    expect(formats.filter((format) => ["image2", "hls", "concat"].includes(format))).toEqual([]);
    expect(args[input + 1]).toBe(`file:${join(fixture.projectRoot, reference.relPath ?? "")}`);
  });

  it("refuses footage: only a reference is sampled", async () => {
    const fixture = await createToolFixture(server);
    const footage = await insertCameraAsset(fixture);
    const result = await callTool(fixture, "sample_reference", { assetId: footage.id });
    expect(result.isError).toBe(true);
    expect(messageOf(result)).toMatch(/not a reference/);
  });
});

describe("project_info", () => {
  it("lists references apart from the clips, so a reference is never cut as footage", async () => {
    const fixture = await createToolFixture(server);
    const footage = await insertCameraAsset(fixture);
    const reference = await insertReferenceAsset(fixture);
    const info = await callTool(fixture, "project_info", {});
    expect(info.isError, messageOf(info)).toBeFalsy();
    const output = info.structuredContent as unknown as { clips: { assetId: string }[]; references: unknown[]; theme: string };
    expect(output.clips.map((clip) => clip.assetId)).toEqual([footage.id]);
    expect(output.references).toEqual([{ assetId: reference.id, name: "reference-look-mp4", durationS: 4 }]);
    expect(output.theme).toBe("zkidz");
  });
});
