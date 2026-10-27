// Created by The Angelo Umali.
import { readdirSync, readFileSync } from "node:fs";
import type { SDKMessage, SDKSystemMessage } from "@anthropic-ai/claude-agent-sdk";
import { findStudioTool, HOOK_EVENT_NAMES, STUDIO_TOOL_NAMES } from "@zks/shared";
import { describe, expect, it } from "vitest";
import { AGENT_TRANSCRIPT_NAMES, readTranscript, type TranscriptLine } from "./fake-agent.ts";
import { readHookFixture } from "./fake-terminal.ts";

const FIXTURE_ROOT = new URL("../../../../tests/fixtures/", import.meta.url);
const PLACEHOLDER_UUID = /^00000000-0000-4000-8000-[0-9a-f]{12}$/;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const REAL_LOOKING = [/\/mnt\//, /\/home\//, /\/Users\//, /[A-Za-z]:\\\\/, /[\w.+-]+@[\w-]+\.[a-z]{2,}/, /sk-ant-/];
const BASE_TOOLS = ["AskUserQuestion", "Read", "Skill"];

const sdkMessages = (lines: readonly TranscriptLine[]): SDKMessage[] =>
  lines.filter((line): line is SDKMessage => line.type !== "control_request" && line.type !== "harness_branch");

const initOf = (lines: readonly TranscriptLine[]): SDKSystemMessage | undefined =>
  sdkMessages(lines).find((message): message is SDKSystemMessage => message.type === "system" && message.subtype === "init");

/** The plan §6.10 init assertion, restated so a fixture drifting from it fails here. */
function initViolations(init: SDKSystemMessage): string[] {
  const violations: string[] = [];
  const foreignTools = init.tools.filter((tool) => !BASE_TOOLS.includes(tool) && !tool.startsWith("mcp__studio__"));
  if (foreignTools.length > 0) violations.push(`tools ${foreignTools.join(",")}`);
  if (init.mcp_servers.some(({ name }) => name !== "studio")) violations.push("mcp_servers");
  // The SDK types omit `source`, but the CLI sends it; the assertion falls back to `name` the same way.
  const pluginSources = init.plugins.map((plugin) => ("source" in plugin ? String(plugin.source) : plugin.name));
  if (!pluginSources.includes("zkidz-studio@inline") || pluginSources.some((source) => source !== "zkidz-studio@inline" && !source.endsWith("@builtin")))
    violations.push("plugins");
  if (init.permissionMode !== "default") violations.push("permissionMode");
  return violations;
}

function allFixtureFiles(): string[] {
  return ["agent", "hooks"].flatMap((folder) =>
    readdirSync(new URL(`${folder}/`, FIXTURE_ROOT)).map((file) => readFileSync(new URL(`${folder}/${file}`, FIXTURE_ROOT), "utf8")),
  );
}

describe("agent transcripts", () => {
  it.each(AGENT_TRANSCRIPT_NAMES)("%s opens with an init and closes on a result", (name) => {
    const messages = sdkMessages(readTranscript(name));

    expect(messages[0]).toMatchObject({ type: "system", subtype: "init" });
    expect(messages.at(-1)).toMatchObject({ type: "result" });
  });

  it.each(AGENT_TRANSCRIPT_NAMES.filter((name) => name !== "init-foreign-mcp"))("%s passes the init assertion", (name) => {
    const init = initOf(readTranscript(name));

    expect(init && initViolations(init)).toEqual([]);
  });

  it("init-foreign-mcp carries a foreign MCP server and tool", () => {
    const init = initOf(readTranscript("init-foreign-mcp"));

    expect(init && initViolations(init)).toEqual(["tools mcp__github__create_issue", "mcp_servers"]);
  });

  it("studio-tools calls every studio tool except the -p approve fallback", () => {
    const called = sdkMessages(readTranscript("studio-tools")).flatMap((message) =>
      message.type === "assistant" ? message.message.content.flatMap((block) => (block.type === "tool_use" ? [block.name] : [])) : [],
    );

    expect([...new Set(called)].sort()).toEqual(STUDIO_TOOL_NAMES.filter((name) => name !== "mcp__studio__approve").sort());
  });

  it("every studio tool_use input and successful tool_result output matches its contract", () => {
    const toolNameById = new Map<string, string>();
    for (const message of AGENT_TRANSCRIPT_NAMES.flatMap((name) => sdkMessages(readTranscript(name)))) {
      if (message.type === "assistant") {
        for (const block of message.message.content) {
          if (block.type !== "tool_use" || !block.name.startsWith("mcp__studio__")) continue;
          toolNameById.set(block.id, block.name);
          expect(findStudioTool(block.name)?.input.safeParse(block.input).success, `${block.name} input`).toBe(true);
        }
      }
      if (message.type !== "user" || typeof message.message.content === "string") continue;
      for (const block of message.message.content) {
        if (block.type !== "tool_result" || block.is_error === true || !Array.isArray(block.content)) continue;
        const toolName = toolNameById.get(block.tool_use_id);
        const [first] = block.content;
        const output: unknown = first?.type === "text" ? JSON.parse(first.text) : undefined;
        expect(toolName && findStudioTool(toolName)?.output.safeParse(output).success, `${toolName} output`).toBe(true);
      }
    }
  });
});

describe("hook payload fixtures", () => {
  it.each(HOOK_EVENT_NAMES)("%s parses as the shared hook contract with Claude Code's base fields", (eventName) => {
    const payload = readHookFixture(eventName);

    expect(payload.hook_event_name).toBe(eventName);
    expect([payload.session_id, payload.transcript_path, payload.cwd].map((field) => typeof field)).toEqual(["string", "string", "string"]);
  });
});

describe("fixture privacy", () => {
  it("holds only placeholder ids and no real paths, emails or keys", () => {
    for (const text of allFixtureFiles()) {
      for (const id of text.match(UUID) ?? []) expect(id).toMatch(PLACEHOLDER_UUID);
      for (const pattern of REAL_LOOKING) expect(text).not.toMatch(pattern);
    }
  });
});
