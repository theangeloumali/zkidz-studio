// Created by The Angelo Umali.
const test = require("node:test");
const assert = require("node:assert/strict");
const { hyperframesToolsEnv } = require("../home");

// HyperFrames otherwise runs whatever ffmpeg/ffprobe is on PATH and whatever Chrome sits in its own cache, not the pinned builds.
test("hands HyperFrames the pinned Chrome, ffmpeg and the ffprobe beside it", () => {
  assert.deepEqual(hyperframesToolsEnv({ ZKS_CHROME: "/zks/chrome-headless-shell", ZKS_FFMPEG: "/zks/ff/bin/ffmpeg" }), {
    PRODUCER_HEADLESS_SHELL_PATH: "/zks/chrome-headless-shell",
    HYPERFRAMES_FFMPEG_PATH: "/zks/ff/bin/ffmpeg",
    HYPERFRAMES_FFPROBE_PATH: "/zks/ff/bin/ffprobe",
  });
});

test("keeps ffprobe's .exe on Windows and honours an explicit ZKS_FFPROBE", () => {
  assert.equal(hyperframesToolsEnv({ ZKS_FFMPEG: "C:\\zks\\ff\\bin\\ffmpeg.exe" }).HYPERFRAMES_FFPROBE_PATH, "C:\\zks\\ff\\bin\\ffprobe.exe");
  assert.equal(hyperframesToolsEnv({ ZKS_FFMPEG: "/a/ffmpeg", ZKS_FFPROBE: "/b/ffprobe" }).HYPERFRAMES_FFPROBE_PATH, "/b/ffprobe");
});

test("leaves HyperFrames' own lookups alone in a dev checkout without the pins", () => {
  assert.deepEqual(hyperframesToolsEnv({}), {});
});
