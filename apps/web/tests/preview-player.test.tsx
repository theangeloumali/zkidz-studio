// Created by The Angelo Umali.
import type { CutSpec } from "@zks/shared";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPlaybackClock } from "../src/editor/playback-clock.ts";
import { PreviewPlayer } from "../src/editor/preview-player.tsx";
import { renderWithProviders } from "./render.tsx";

const CUTS: CutSpec = {
  schemaVersion: 1,
  sourceAssetId: "0b8c7d6e-5f4a-4b3c-8d2e-1f0a9b8c7d6e",
  durationS: 30,
  fps: { num: 30000, den: 1001 },
  removals: [{ at: 10, end: 12, reason: "pause" }],
  bleeps: [],
  zooms: [],
  blurBoxes: [],
  portals: [],
  matteRanges: [],
};
const SPANS = [
  { at: 0, end: 10 },
  { at: 12, end: 30 },
];

function manualTime() {
  let nowMs = 0;
  const frames: FrameRequestCallback[] = [];
  return {
    now: () => nowMs,
    requestFrame: (callback: FrameRequestCallback) => frames.push(callback),
    cancelFrame: () => frames.splice(0),
    advance(ms: number) {
      nowMs += ms;
      frames.splice(0).forEach((callback) => callback(nowMs));
    },
  };
}

const PROXY_URL = "/api/projects/0b6f4f0e-7f43-4d8f-9a3c-5c9d7c1f2e11/videos/v1/proxy";

describe("PreviewPlayer", () => {
  let videoFrames: Map<HTMLVideoElement, VideoFrameRequestCallback>;

  beforeEach(() => {
    videoFrames = new Map();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockReturnValue();
    HTMLVideoElement.prototype.requestVideoFrameCallback = function (this: HTMLVideoElement, callback: VideoFrameRequestCallback) {
      videoFrames.set(this, callback);
      return videoFrames.size;
    };
    HTMLVideoElement.prototype.cancelVideoFrameCallback = function (this: HTMLVideoElement) {
      videoFrames.delete(this);
    };
  });
  afterEach(() => vi.restoreAllMocks());

  const presentFrame = (video: HTMLVideoElement, mediaTime: number) => {
    const callback = videoFrames.get(video);
    if (callback === undefined) throw new Error("no video frame callback is waiting on this proxy");
    videoFrames.delete(video);
    act(() => callback(0, { mediaTime } as VideoFrameCallbackMetadata));
  };

  // Plan §8.4: the 1080 H.264 proxy, never the original, which can be a phone's 4K HEVC that Chrome cannot decode.
  it("plays the video's proxy in both layers", () => {
    const clock = createPlaybackClock({ durationS: 28, ...manualTime() });
    const { container } = renderWithProviders(<PreviewPlayer cuts={CUTS} spans={SPANS} composition={null} clock={clock} footageUrl={PROXY_URL} />);
    expect([...container.querySelectorAll("video")].map((video) => video.getAttribute("src"))).toEqual([PROXY_URL, PROXY_URL]);
  });

  it("swaps proxies on the presented frame that reaches the end of a kept span", () => {
    const time = manualTime();
    const clock = createPlaybackClock({ durationS: 28, ...time });
    const { container } = renderWithProviders(<PreviewPlayer cuts={CUTS} spans={SPANS} composition={null} clock={clock} footageUrl={PROXY_URL} />);
    const [first, second] = [...container.querySelectorAll("video")];
    if (first === undefined || second === undefined) throw new Error("expected two proxies");

    act(() => clock.play());
    act(() => time.advance(16));
    presentFrame(first, 5);
    expect(first.dataset.active).toBe("true");

    presentFrame(first, 9.99);
    expect(second.dataset.active).toBe("true");
    expect(first.dataset.active).toBe("false");
  });
});
