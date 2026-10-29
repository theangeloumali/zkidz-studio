// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { assertOnlyStudioTools, exposedToolNames, hookStateOverride } from "../../../src/terminal/agents/codex-lockdown.ts";

/** The shape `codex debug prompt-input` printed on 0.164.0 for a model in code mode. */
const CODE_MODE_PROMPT_INPUT = [
  {
    type: "additional_tools",
    role: "developer",
    tools: [
      { type: "custom", name: "exec", description: "Run JavaScript" },
      {
        type: "namespace",
        name: "collaboration",
        tools: [{ type: "function", name: "spawn_agent", parameters: {} }],
      },
      { type: "namespace", name: "mcp__studio", tools: [{ type: "function", name: "project_read" }] },
    ],
  },
  { type: "message", role: "developer", content: [] },
];

describe("codex lockdown: exposed tools", () => {
  it("names every tool the model would see, namespaced", () => {
    expect(exposedToolNames(CODE_MODE_PROMPT_INPUT)).toEqual(["exec", "collaboration.spawn_agent", "mcp__studio.project_read"]);
  });

  it("refuses output with no tools section rather than reading it as no tools", () => {
    expect(() => exposedToolNames([{ type: "message", role: "user", content: [] }])).toThrow(/no tools section/);
  });

  it("allows only the studio's tools and codex's question and MCP-resource tools", () => {
    expect(() => assertOnlyStudioTools(["functions.request_user_input", "functions.list_mcp_resources", "mcp__studio.project_read"])).not.toThrow();
    expect(() => assertOnlyStudioTools(exposedToolNames(CODE_MODE_PROMPT_INPUT))).toThrow(/exec, collaboration\.spawn_agent/);
    expect(() => assertOnlyStudioTools(["mcp__studio_evil.x"])).toThrow(/mcp__studio_evil\.x/);
  });
});

describe("codex lockdown: hook state", () => {
  it("trusts the studio's hooks by hash and switches the rest off, quoting every key", () => {
    const relay = '"/usr/bin/node" "/zks/hook.mjs" "http://127.0.0.1:1/h"';
    const common = { enabled: true, handlerType: "command" };
    const override = hookStateOverride(
      [
        { ...common, key: '/home/u/.codex/hooks.json:stop:0:0"]', source: "user", trustStatus: "trusted", currentHash: "sha256:aa", command: "x" },
        { ...common, key: "/<session-flags>/config.toml:stop:0:0", source: "sessionFlags", trustStatus: "untrusted", currentHash: "sha256:bb", command: relay },
        {
          ...common,
          key: "/<session-flags>/config.toml:stop:0:1",
          source: "sessionFlags",
          trustStatus: "untrusted",
          currentHash: "sha256:cc",
          command: "planted",
        },
      ],
      relay,
    );
    expect(override).toBe(
      'hooks.state={"/home/u/.codex/hooks.json:stop:0:0\\"]"={enabled=false},"/<session-flags>/config.toml:stop:0:0"={trusted_hash="sha256:bb"},"/<session-flags>/config.toml:stop:0:1"={enabled=false}}',
    );
  });
});
