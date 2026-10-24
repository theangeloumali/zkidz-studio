// Created by The Angelo Umali.
// @vitest-environment node
import { describe, expect, it } from "vitest";
import config from "../vite.config";

describe("web vitest config", () => {
  // Each isolated file paid a fresh jsdom load inside vitest's fixed 60 s worker start limit, which timed out under ci:local load.
  it("reuses one fork per worker across test files", () => {
    expect(config.test?.isolate).toBe(false);
  });
});
