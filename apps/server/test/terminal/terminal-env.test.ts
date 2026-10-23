// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { buildAgentEnv } from "../../src/auth/agent-env.ts";
import { findCredentialVariable } from "../../src/terminal/terminal-env.ts";

const tokens = { hookToken: "hook-token", mcpToken: "mcp-token", mcpUrl: "http://127.0.0.1:4317/api/mcp/s1" };

describe("findCredentialVariable", () => {
  it("names a credential or config-routing variable the terminal must never carry", () => {
    for (const name of ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CONFIG_DIR"]) {
      expect(findCredentialVariable({ PATH: "/usr/bin", [name]: "x" })).toBe(name);
    }
  });

  it("passes the terminal env buildAgentEnv builds", () => {
    const parentEnv = { PATH: "/usr/bin", HOME: "/home/someone", LC_ALL: "C" };
    const childEnv = buildAgentEnv({ kind: "terminal", tokens }, { studioHome: "/srv/studio-home", appVersion: "0.1.0", proxyOptIn: false, parentEnv });
    expect(findCredentialVariable(childEnv)).toBeUndefined();
  });
});
