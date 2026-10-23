// Created by The Angelo Umali.
import { rm } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chooseStoredExtension, MediaRejectedError, probeMedia } from "../src/media-io/probe.ts";
import { hasFfmpeg, makeMediaFixtures, type MediaFixtures } from "./support/media-fixtures.ts";

const isFfmpegInstalled = await hasFfmpeg();

describe.skipIf(!isFfmpegInstalled)("probeMedia", () => {
  let fixtures: MediaFixtures;
  beforeAll(async () => {
    fixtures = await makeMediaFixtures();
  });
  afterAll(async () => {
    await rm(fixtures.dir, { recursive: true, force: true });
  });

  it("reads duration, size and the exact NTSC frame rate", async () => {
    const probe = await probeMedia("ffprobe", fixtures.clipMp4);
    expect(probe).toMatchObject({ kind: "camera", width: 64, height: 36, fps: { num: 30000, den: 1001 }, rotation: 0, isHdr: false });
    expect(probe.durationS).toBeGreaterThan(0.4);
    expect(probe.formatName).toBe("mov,mp4,m4a,3gp,3g2,mj2");
  });

  it("reads display rotation", async () => {
    expect((await probeMedia("ffprobe", fixtures.rotatedMp4)).rotation).toBe(90);
  });

  it("flags PQ transfer as HDR", async () => {
    expect(await probeMedia("ffprobe", fixtures.hdrMkv)).toMatchObject({ isHdr: true, formatName: "matroska,webm" });
  });

  it("accepts a single still image", async () => {
    expect(await probeMedia("ffprobe", fixtures.stillPng)).toMatchObject({ kind: "image", width: 8, height: 8, fps: null, durationS: null });
  });

  it.each([
    ["an HLS playlist", "playlistAsMp4"],
    ["an ffconcat list", "concatAsMp4"],
    ["non-media bytes", "garbage"],
  ] as const)("rejects %s whatever its extension", async (_label, fixtureKey) => {
    await expect(probeMedia("ffprobe", fixtures[fixtureKey])).rejects.toBeInstanceOf(MediaRejectedError);
  });

  it("never expands an image-sequence pattern in the path", async () => {
    await expect(probeMedia("ffprobe", fixtures.stillPng.replace("still.png", "still%d.png"))).rejects.toBeInstanceOf(MediaRejectedError);
  });
});

describe("chooseStoredExtension", () => {
  it("keeps the original extension when it matches the probed container", () => {
    expect(chooseStoredExtension("mov,mp4,m4a,3gp,3g2,mj2", "Clip.MOV")).toBe("mov");
    expect(chooseStoredExtension("matroska,webm", "a.webm")).toBe("webm");
  });

  it("falls back to the container's own extension when the name lies", () => {
    expect(chooseStoredExtension("mov,mp4,m4a,3gp,3g2,mj2", "clip.exe")).toBe("mp4");
    expect(chooseStoredExtension("png_pipe", "photo")).toBe("png");
  });
});
