// Created by The Angelo Umali.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HookInput } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createConfineReadsHook } from "../../src/agent/confine-reads.ts";

function preToolUse(toolInput: unknown, toolName = "Read"): HookInput {
  return {
    hook_event_name: "PreToolUse",
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: "tu1",
    session_id: "s1",
    transcript_path: "/t",
    cwd: "/",
  } as unknown as HookInput;
}

describe("confineReads hook", () => {
  let scratchDir = "";
  let hook: ReturnType<typeof createConfineReadsHook>;
  const signal = new AbortController().signal;

  beforeEach(async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "zks-confine-"));
    await mkdir(join(scratchDir, "project"));
    await mkdir(join(scratchDir, "plugin"));
    await writeFile(join(scratchDir, "project", "notes.txt"), "ok");
    await writeFile(join(scratchDir, "plugin", "SKILL.md"), "ok");
    await writeFile(join(scratchDir, "secret.txt"), "no");
    hook = createConfineReadsHook({ projectDir: join(scratchDir, "project"), pluginDir: join(scratchDir, "plugin") });
  });
  afterEach(async () => {
    await rm(scratchDir, { recursive: true, force: true });
  });

  const decisionFor = async (toolInput: unknown, toolName?: string) => {
    const output = await hook(preToolUse(toolInput, toolName), "tu1", { signal });
    return "hookSpecificOutput" in output ? output.hookSpecificOutput : undefined;
  };

  // A hook "allow" skips canUseTool, so this backstop only ever denies: inside reads fall through to canUseTool.
  it("leaves reads inside the project and the plugin dir to canUseTool", async () => {
    expect(await decisionFor({ file_path: join(scratchDir, "project", "notes.txt") })).toBeUndefined();
    expect(await decisionFor({ file_path: join(scratchDir, "plugin", "SKILL.md") })).toBeUndefined();
  });

  // The SDK matcher is a pattern, so "Read" also reaches NotebookRead or an MCP tool named like mcp__x__ReadFile.
  it("never decides for a tool other than Read, even with an in-project path", async () => {
    const inside = { file_path: join(scratchDir, "project", "notes.txt") };
    for (const toolName of ["Write", "NotebookRead", "mcp__x__ReadFile"]) expect(await decisionFor(inside, toolName)).toBeUndefined();
  });

  it("denies reads outside both, traversal, and malformed input", async () => {
    for (const toolInput of [{ file_path: join(scratchDir, "secret.txt") }, { file_path: join(scratchDir, "project", "..", "secret.txt") }, {}, null]) {
      expect(await decisionFor(toolInput)).toMatchObject({ hookEventName: "PreToolUse", permissionDecision: "deny" });
    }
  });
});
