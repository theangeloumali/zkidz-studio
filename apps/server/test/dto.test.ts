// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { toMediaAssetDto, type MediaAssetRow } from "../src/dto.ts";

function assetRow(isHdr: boolean, probe: MediaAssetRow["probe"]): MediaAssetRow {
  return {
    id: "0b6f8c2a-1d3e-4f5a-9b7c-2d4e6f8a0b1c",
    projectId: "5f0c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f",
    kind: "camera",
    name: "trip.mp4",
    relPath: "media/0b6f8c2a.mp4",
    inPlacePath: null,
    bytes: 1,
    mtimeMs: 0,
    durationS: 10,
    width: 1920,
    height: 1080,
    fpsNum: 30,
    fpsDen: 1,
    isHdr,
    probe,
    createdAt: new Date("2026-11-01T10:00:00.000Z"),
  };
}

describe("toMediaAssetDto", () => {
  it.each([
    ["H.264 8-bit SDR", false, { videoCodec: "h264", pixelFormat: "yuv420p" }, true],
    ["full-range H.264", false, { videoCodec: "h264", pixelFormat: "yuvj420p" }, true],
    ["HEVC", false, { videoCodec: "hevc", pixelFormat: "yuv420p" }, false],
    ["10-bit H.264", false, { videoCodec: "h264", pixelFormat: "yuv420p10le" }, false],
    ["HDR H.264", true, { videoCodec: "h264", pixelFormat: "yuv420p" }, false],
    ["a probe from before pixel formats were read", false, { videoCodec: "h264" }, false],
    ["no probe", false, null, false],
  ])("decides browser playback for %s", (_, isHdr, probe, expected) => {
    expect(toMediaAssetDto(assetRow(isHdr, probe)).isBrowserPlayable).toBe(expected);
  });
});
