// Created by The Angelo Umali.
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AgentLaunchError } from "../../../src/terminal/agents/agent-env.ts";
import { CODEX_DISABLED_FEATURES, createCodexAdapter } from "../../../src/terminal/agents/codex.ts";
import { HOOK_RELAY_PATH, MCP_SERVER_PATH } from "../../../src/terminal/session-files.ts";

const SESSION_ID = "0b0f6c0e-1f9b-4c1e-9d55-1a2b3c4d5e6f";
const PROJECT_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const PLUGIN_DIR = fileURLToPath(new URL("../../../../../plugin/", import.meta.url));
const TOKENS = { hookToken: "hook-secret", mcpToken: "mcp-secret", mcpUrl: "http://127.0.0.1:4100/mcp/x" };
const PARENT_ENV = { PATH: "/usr/bin", HOME: "/home/user", OPENAI_API_KEY: "sk-parent" };
const HOOK_URL = `http://127.0.0.1:4100/api/terminal/${SESSION_ID}/hooks`;
const RELAY = `"/usr/bin/node" "${HOOK_RELAY_PATH}" "${HOOK_URL}"`;
const modeOf = async (path: string) => (await stat(path)).mode & 0o777;

async function launchRequest(overrides: { resumeSessionId?: string; model?: string } = {}) {
  const projectDir = await mkdtemp(join(tmpdir(), "zks-proj-"));
  return {
    sessionId: SESSION_ID,
    projectId: PROJECT_ID,
    projectDir,
    runDir: await mkdtemp(join(tmpdir(), "zks-run-")),
    appPort: 4100,
    nodePath: "/usr/bin/node",
    rulesText: "RULES",
    pluginDir: PLUGIN_DIR,
    studioToolNames: ["mcp__studio__project_info"],
    ...overrides,
  };
}

const adapterWith = (userMcpServers: readonly string[] = ["figma", "my server"]) =>
  createCodexAdapter({ parentEnv: PARENT_ENV, listUserMcpServers: async () => userMcpServers });

function expectedArgs(instructions: string, model?: string): string[] {
  return [
    "--sandbox",
    "read-only",
    "-a",
    "never",
    "--dangerously-bypass-hook-trust",
    ...CODEX_DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]),
    "-c",
    'web_search="disabled"',
    ...(model === undefined ? [] : ["-m", model]),
    "-c",
    "mcp_servers.figma.enabled=false",
    "-c",
    'mcp_servers."my server".enabled=false',
    "-c",
    'mcp_servers.studio.command="/usr/bin/node"',
    "-c",
    `mcp_servers.studio.args=[${JSON.stringify(MCP_SERVER_PATH)}]`,
    "-c",
    'mcp_servers.studio.env_vars=["ZKS_MCP_TOKEN","ZKS_MCP_URL"]',
    "-c",
    'mcp_servers.studio.default_tools_approval_mode="approve"',
    ...["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop"].flatMap((event) => [
      "-c",
      `hooks.${event}=[{matcher="*",hooks=[{type="command",command=${JSON.stringify(RELAY)}}]}]`,
    ]),
    "-c",
    `developer_instructions=${JSON.stringify(instructions)}`,
  ];
}

describe("codex adapter: launch", () => {
  it("locks codex down entirely through argv, with the tokens only in env", async () => {
    const request = await launchRequest({ model: "gpt-5.6-luna" });
    const launch = await adapterWith().prepare(request, TOKENS, "/opt/codex/bin/codex");
    const instructions = await readFile(join(launch.filesDir, "instructions.md"), "utf8");

    expect(launch.file).toBe("/opt/codex/bin/codex");
    expect(launch.cwd).toBe(request.projectDir);
    expect(launch.args).toEqual(expectedArgs(instructions, "gpt-5.6-luna"));
    expect(launch.env).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/user",
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      ZKS_HOOK_TOKEN: "hook-secret",
      ZKS_MCP_TOKEN: "mcp-secret",
      ZKS_MCP_URL: TOKENS.mcpUrl,
    });
    expect(launch.args.join(" ")).not.toMatch(/hook-secret|mcp-secret/);
    expect(launch.companion).toBeUndefined();
  });

  it("keeps its files owner-only in a folder under the run dir", async () => {
    const request = await launchRequest();
    const launch = await adapterWith([]).prepare(request, TOKENS, "/opt/codex/bin/codex");
    expect(dirname(launch.filesDir)).toBe(request.runDir);
    expect(await modeOf(launch.filesDir)).toBe(0o700);
    expect(await modeOf(join(launch.filesDir, "instructions.md"))).toBe(0o600);
  });

  it("resumes the codex thread with the same lockdown", async () => {
    const launch = await adapterWith([]).prepare(await launchRequest({ resumeSessionId: "019a-thread" }), TOKENS, "/opt/codex/bin/codex");
    expect(launch.args[0]).toBe("resume");
    expect(launch.args.at(-1)).toBe("019a-thread");
    expect(launch.args).toContain("--dangerously-bypass-hook-trust");
  });

  it("refuses to start when the user has an MCP server named studio", async () => {
    await expect(adapterWith(["studio"]).prepare(await launchRequest(), TOKENS, "/opt/codex/bin/codex")).rejects.toThrow(AgentLaunchError);
  });

  it("refuses to start when the user's MCP servers cannot be listed", async () => {
    const adapter = createCodexAdapter({ parentEnv: PARENT_ENV, listUserMcpServers: async () => Promise.reject(new Error("codex failed")) });
    await expect(adapter.prepare(await launchRequest(), TOKENS, "/opt/codex/bin/codex")).rejects.toThrow(AgentLaunchError);
  });
});

describe("codex adapter: hooks", () => {
  const adapter = adapterWith();
  if (adapter.events.kind !== "hooks") throw new Error("codex reports through hooks");
  const { mapHook } = adapter.events;
  const base = { session_id: "019a-thread", transcript_path: "/x/rollout.jsonl", cwd: "/p", permission_mode: "bypassPermissions" };

  it("reports the session on the user's codex sign-in", () => {
    expect(mapHook({ ...base, hook_event_name: "SessionStart", source: "startup", model: "gpt-5.6-luna" }, { projectId: PROJECT_ID })).toEqual([
      { type: "session.started", projectId: PROJECT_ID, sessionId: "019a-thread", model: "gpt-5.6-luna", credential: "your Codex sign-in", skills: [] },
      { type: "terminal.state", projectId: PROJECT_ID, state: "ready" },
    ]);
  });

  it("maps tool calls, denials, prompts and the turn's end", () => {
    const toolCall = { ...base, tool_name: "mcp__studio__project_info", tool_input: {}, tool_use_id: "exec-1" };
    expect(mapHook({ ...toolCall, hook_event_name: "PreToolUse" }, { projectId: PROJECT_ID })).toEqual([
      { type: "tool.called", projectId: PROJECT_ID, toolUseId: "exec-1", name: "mcp__studio__project_info", label: expect.any(String), input: {} },
    ]);
    expect(
      mapHook(
        { ...base, hook_event_name: "PreToolUse", tool_name: "apply_patch", tool_input: {}, tool_use_id: "exec-2" },
        { projectId: PROJECT_ID, decision: { isAllowed: false, reason: "apply_patch is not available in ZKidz Studio." } },
      ),
    ).toEqual([{ type: "tool.denied", projectId: PROJECT_ID, name: "apply_patch", reason: "apply_patch is not available in ZKidz Studio." }]);
    expect(mapHook({ ...toolCall, hook_event_name: "PostToolUse", tool_response: {} }, { projectId: PROJECT_ID })).toEqual([
      expect.objectContaining({ type: "tool.finished", toolUseId: "exec-1", ok: true }),
    ]);
    expect(mapHook({ ...base, hook_event_name: "UserPromptSubmit", prompt: "cut it" }, { projectId: PROJECT_ID })).toEqual([
      { type: "prompt.submitted", projectId: PROJECT_ID, text: "cut it" },
      { type: "terminal.state", projectId: PROJECT_ID, state: "working" },
    ]);
    expect(mapHook({ ...base, hook_event_name: "Stop", stop_hook_active: false, last_assistant_message: "Done." }, { projectId: PROJECT_ID })).toEqual([
      { type: "narration", projectId: PROJECT_ID, text: "Done." },
      { type: "terminal.state", projectId: PROJECT_ID, state: "ready" },
    ]);
  });

  it("ignores a payload that is not a hook", () => {
    expect(mapHook({ hook_event_name: "Nope" }, { projectId: PROJECT_ID })).toEqual([]);
  });
});

describe("codex adapter: policy", () => {
  const adapter = adapterWith();
  const scope = { projectDir: "/p", pluginDir: PLUGIN_DIR, studioToolNames: ["mcp__studio__project_info"] };

  it.each(["apply_patch", "exec_command", "shell", "spawn_agent", "mcp__figma__get_file"])("denies %s", async (toolName) => {
    expect((await adapter.decideTool?.(toolName, {}, scope))?.isAllowed).toBe(false);
  });

  it("allows the studio's own tools", async () => {
    expect(await adapter.decideTool?.("mcp__studio__project_info", {}, scope)).toEqual({ isAllowed: true });
  });
});

describe("codex adapter: usage", () => {
  it("reads the thread's latest token totals from its rollout file", async () => {
    const codexHome = await mkdtemp(join(tmpdir(), "zks-codex-home-"));
    const dayDir = join(codexHome, "sessions", "2026", "10", "29");
    await mkdir(dayDir, { recursive: true });
    const tokenCount = (input: number, cached: number, output: number) =>
      JSON.stringify({
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: input,
              cached_input_tokens: cached,
              output_tokens: output,
              reasoning_output_tokens: 5,
              total_tokens: input + output,
            },
          },
        },
      });
    await writeFile(
      join(dayDir, "rollout-2026-10-29T10-00-00-019a-thread.jsonl"),
      [tokenCount(100, 20, 10), '{"type":"event_msg","payload":{"type":"token_count","info":null}}', tokenCount(900, 300, 40), ""].join("\n"),
    );

    const adapter = createCodexAdapter({ parentEnv: { ...PARENT_ENV, CODEX_HOME: codexHome } });
    expect(await adapter.usageSource?.("019a-thread")).toEqual({ inputTokens: 600, outputTokens: 40, cacheTokens: 300 });
    expect(await adapter.usageSource?.("019b-other")).toBeNull();
    expect(await adapter.usageSource?.("../escape")).toBeNull();
  });
});
