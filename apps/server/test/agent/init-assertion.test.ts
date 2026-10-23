// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { findInitMismatch } from "../../src/agent/init-assertion.ts";
import { initMessage, REQUIRED_SKILLS } from "./sdk-fixtures.ts";

const EXPECTED = { requiredSkills: REQUIRED_SKILLS, apiKeySource: "ANTHROPIC_API_KEY" } as const;

describe("findInitMismatch", () => {
  it("accepts the locked-down init from spike 01", () => {
    expect(findInitMismatch(initMessage(), EXPECTED)).toBeNull();
  });

  it.each([
    ["an extra built-in tool", { tools: ["Read", "Skill", "AskUserQuestion", "Bash"] }, /Bash/],
    ["a missing base tool", { tools: ["Read", "Skill"] }, /AskUserQuestion/],
    [
      "another MCP server",
      {
        mcp_servers: [
          { name: "studio", status: "connected" },
          { name: "github", status: "connected" },
        ],
      },
      /github/,
    ],
    [
      "a user plugin",
      {
        plugins: [
          { name: "zkidz-studio", path: "/p", source: "zkidz-studio@inline" },
          { name: "x", path: "/x", source: "x@market" },
        ],
      },
      /x@market/,
    ],
    ["no studio plugin", { plugins: [] }, /zkidz-studio@inline/],
    ["a missing required skill", { skills: ["other-skill"] }, /edit-video/],
    ["a non-default permission mode", { permissionMode: "bypassPermissions" }, /bypassPermissions/],
    ["the wrong credential source", { apiKeySource: "none" }, /none/],
  ])("rejects %s", (_label, overrides, reason) => {
    expect(findInitMismatch(initMessage(overrides), EXPECTED)).toMatch(reason);
  });

  it("expects no api key source in cloud mode", () => {
    expect(findInitMismatch(initMessage({ apiKeySource: "none" }), { ...EXPECTED, apiKeySource: "none" })).toBeNull();
  });
});
