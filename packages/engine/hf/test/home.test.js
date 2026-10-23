// Created by The Angelo Umali.
const test = require("node:test");
const assert = require("node:assert/strict");
const { hyperframesChromeEnv } = require("../home");

// HyperFrames otherwise renders with whatever Chrome sits in ~/.cache/hyperframes or ~/.cache/puppeteer, not the pinned one.
test("hands HyperFrames the pinned Chrome from ZKS_CHROME", () => {
  assert.deepEqual(hyperframesChromeEnv({ ZKS_CHROME: "/zks/tools/chrome-headless-shell" }), {
    PRODUCER_HEADLESS_SHELL_PATH: "/zks/tools/chrome-headless-shell",
  });
});

test("leaves HyperFrames' own lookup alone in a dev checkout without ZKS_CHROME", () => {
  assert.deepEqual(hyperframesChromeEnv({}), {});
});
