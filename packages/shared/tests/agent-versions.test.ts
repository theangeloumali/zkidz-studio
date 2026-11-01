// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { AGENT_MIN_VERSIONS, isVersionAtLeast } from "../src/agent-versions.ts";

describe("isVersionAtLeast", () => {
  it.each([
    ["2.2.0", "2.2.0", true],
    ["2.2.0-beta.1", "2.2.0", true],
    ["2.10.0", "2.9.9", true],
    ["codex-cli 0.165.0", "0.164.0", true],
    ["2.1.312 (Claude Code)", "2.1.295", true],
    ["2.1.294", "2.1.295", false],
    ["1.99.99", "2.0.0", false],
    ["2.2", "2.2.0", false],
    ["not a version", "0.1.0", false],
  ])("%j against %j is %s", (version, minimum, expected) => {
    expect(isVersionAtLeast(version, minimum)).toBe(expected);
  });

  it("knows a minimum for every agent the studio runs", () => {
    expect(Object.keys(AGENT_MIN_VERSIONS).sort()).toEqual(["claude", "codex", "opencode"]);
  });
});
