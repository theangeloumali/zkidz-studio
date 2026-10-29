// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { AgentLaunchError, buildTerminalAgentEnv, findAgentCredentialVariable } from "../../../src/terminal/agents/agent-env.ts";

const HOSTILE_PARENT = {
  PATH: "/usr/bin",
  HOME: "/home/user",
  OPENAI_API_KEY: "sk-parent",
  CODEX_API_KEY: "parent",
  ANTHROPIC_API_KEY: "parent",
  GEMINI_API_KEY: "parent",
  CODEX_HOME: "/home/user/.codex-alt",
  DATABASE_URL: "postgres://secret",
};

describe("buildTerminalAgentEnv", () => {
  it("keeps the allowlist plus the agent's own names, never a parent credential", () => {
    const env = buildTerminalAgentEnv({ parentEnv: HOSTILE_PARENT, inheritNames: ["CODEX_HOME"], extraEnv: { ZKS_HOOK_TOKEN: "hook" } });
    expect(env).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/user",
      CODEX_HOME: "/home/user/.codex-alt",
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      ZKS_HOOK_TOKEN: "hook",
    });
  });

  it("refuses to build an env that would carry a credential", () => {
    expect(() => buildTerminalAgentEnv({ parentEnv: HOSTILE_PARENT, inheritNames: ["OPENAI_API_KEY"] })).toThrow(AgentLaunchError);
  });
});

describe("findAgentCredentialVariable", () => {
  it.each([
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "AZURE_OPENAI_KEY",
    "CODEX_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "GEMINI_API_KEY",
    "OPENROUTER_API_KEY",
    "AWS_SECRET_ACCESS_KEY",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "MISTRAL_API_KEY",
  ])("flags %s", (name) => {
    expect(findAgentCredentialVariable({ [name]: "x" })).toBe(name);
  });

  it("lets the studio's own tokens and the agent's home through", () => {
    expect(findAgentCredentialVariable({ ZKS_HOOK_TOKEN: "x", ZKS_MCP_TOKEN: "x", OPENCODE_SERVER_PASSWORD: "x", CODEX_HOME: "x", PATH: "x" })).toBeUndefined();
  });
});
