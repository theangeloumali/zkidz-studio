// Created by The Angelo Umali.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import { PromptInbox } from "../../src/agent/inbox.ts";
import { buildPrintArgs, createPrintQuery, type SpawnClaude } from "../../src/agent/print-runner.ts";

const FAKE_CLAUDE = fileURLToPath(new URL("./fixtures/fake-claude.mjs", import.meta.url));
const runFake: SpawnClaude = (command, args, options) => spawn(process.execPath, [FAKE_CLAUDE, ...args], options);

describe("buildPrintArgs", () => {
  it("uses the spike 05 flags and never --bare or a skip-permissions flag", () => {
    const args = buildPrintArgs({ mcpConfigPath: "/run/studio-mcp.json", settingsPath: "/run/settings.json", pluginDir: "/app/plugin", maxTurns: 40 });
    expect(args).toEqual([
      "-p",
      "--restricted",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--strict-mcp-config",
      "--mcp-config",
      "/run/studio-mcp.json",
      "--plugin-dir",
      "/app/plugin",
      "--add-dir",
      "/app/plugin",
      "--settings",
      "/run/settings.json",
      "--tools",
      "Read,Skill,AskUserQuestion",
      "--disallowedTools",
      "Bash,Edit,Write,WebFetch,WebSearch,Agent",
      "--permission-mode",
      "default",
      "--permission-prompt-tool",
      "mcp__studio__approve",
      "--max-turns",
      "40",
    ]);
  });

  it("adds the budget, model and resume only when given", () => {
    const args = buildPrintArgs({
      mcpConfigPath: "/m.json",
      settingsPath: "/s.json",
      pluginDir: "/p",
      maxTurns: 5,
      maxBudgetUsd: 2.5,
      model: "haiku",
      resume: "sdk-1",
    });
    expect(args.slice(-6)).toEqual(["--max-budget-usd", "2.5", "--model", "haiku", "--resume", "sdk-1"]);
  });
});

describe("createPrintQuery", () => {
  function start() {
    const inbox = new PromptInbox();
    const abortController = new AbortController();
    const query = createPrintQuery({ claudePath: "claude", mcpConfigPath: "/m.json", settingsPath: "/s.json", pluginDir: "/p", spawn: runFake });
    const handle = query({
      prompt: inbox,
      projectId: "project-1",
      options: { maxTurns: 3, resume: "sdk-1", cwd: process.cwd(), env: { ZKS_FAKE_MARKER: "child-env" }, abortController },
    });
    const iterator: AsyncIterator<SDKMessage, unknown> = handle[Symbol.asyncIterator]();
    const next = async (): Promise<Record<string, unknown>> => {
      const { value } = await iterator.next();
      return toRecord(value);
    };
    return { inbox, abortController, handle, next };
  }

  it("streams NDJSON both ways, skips non-JSON lines and passes options as flags and env", async () => {
    const { inbox, handle, next } = start();
    const init = await next();
    expect(init).toMatchObject({ type: "system", subtype: "init", marker: "child-env" });
    expect(init.argv).toEqual(expect.arrayContaining(["--settings", "/s.json", "--max-turns", "3", "--resume", "sdk-1"]));

    inbox.push("hello");
    expect(await next()).toMatchObject({ type: "result", result: "echo: hello" });
    handle.close?.();
  });

  it("interrupts with SIGINT and keeps the process for the next prompt", async () => {
    const { inbox, handle, next } = start();
    await next();
    await handle.interrupt?.();
    expect(await next()).toMatchObject({ type: "result", errors: ["interrupted"] });
    inbox.push("again");
    expect(await next()).toMatchObject({ result: "echo: again" });
    handle.close?.();
  });

  it("ends the stream when aborted", async () => {
    const { abortController, next, handle } = start();
    await next();
    abortController.abort();
    const rest: SDKMessage[] = [];
    for await (const message of handle) rest.push(message);
    expect(rest).toEqual([]);
  });
});

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? Object.fromEntries(Object.entries(value)) : {};
}
