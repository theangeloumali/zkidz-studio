// Created by The Angelo Umali.
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CODEX_DISABLED_FEATURES, createCodexAdapter } from "../../../src/terminal/agents/codex.ts";
import { decideTerminalTool } from "../../../src/terminal/hook-policy.ts";
import type { CodexHook, CodexSetup } from "../../../src/terminal/agents/codex-lockdown.ts";
import type { CodexProbe } from "../../../src/terminal/agents/codex-probes.ts";
import { HOOK_RELAY_PATH, MCP_SERVER_PATH } from "../../../src/terminal/session-files.ts";

const SESSION_ID = "0b0f6c0e-1f9b-4c1e-9d55-1a2b3c4d5e6f";
const PROJECT_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const PLUGIN_DIR = fileURLToPath(new URL("../../../../../plugin/", import.meta.url));
const TOKENS = { hookToken: "hook-secret", mcpToken: "mcp-secret", mcpUrl: "http://127.0.0.1:4100/mcp/x" };
const HOOK_URL = `http://127.0.0.1:4100/api/terminal/${SESSION_ID}/hooks`;
const RELAY = `"/usr/bin/node" "${HOOK_RELAY_PATH}" "${HOOK_URL}"`;
const HOOK_EVENTS = ["session_start", "user_prompt_submit", "pre_tool_use", "post_tool_use", "stop"];
const USER_HOOK_KEY = "/home/user/.codex/hooks.json:session_start:0:0";
const STUDIO_TOOLS = ["functions.request_user_input", "functions.read_mcp_resource", "mcp__studio.project_info"];
const modeOf = async (path: string) => (await stat(path)).mode & 0o777;
const hashOf = (index: number) => `sha256:${String(index).repeat(64).slice(0, 64)}`;

const MODEL_CACHE = {
  fetched_at: "2026-10-29T00:00:00Z",
  models: [
    {
      slug: "gpt-5.6-luna",
      tool_mode: "code_mode_only",
      multi_agent_version: "v2",
      supports_search_tool: true,
      experimental_supported_tools: ["exec"],
      apply_patch_tool_type: "freeform",
      model_messages: { instructions_template: "BASE PROMPT", multi_agent: "keep" },
    },
  ],
};

async function codexHome(cache: unknown = MODEL_CACHE): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "zks-codex-home-"));
  await writeFile(join(home, "models_cache.json"), JSON.stringify(cache));
  return home;
}

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

const hook = (key: string, overrides: Partial<CodexHook>): CodexHook => ({
  key,
  source: "user",
  enabled: true,
  trustStatus: "trusted",
  currentHash: hashOf(9),
  handlerType: "command",
  command: "orca-hook.sh",
  ...overrides,
});
const studioHooks = (trustStatus: string) =>
  HOOK_EVENTS.map((event, index) =>
    hook(`/<session-flags>/config.toml:${event}:0:0`, { source: "sessionFlags", trustStatus, currentHash: hashOf(index), command: RELAY }),
  );
/** What codex reports before the studio's hooks.state, and after it when the override took. */
const BEFORE_STATE = [hook(USER_HOOK_KEY, {}), ...studioHooks("untrusted")];
const AFTER_STATE = [hook(USER_HOOK_KEY, { enabled: false }), ...studioHooks("trusted")];

const STUDIO_ORIGINS = { "mcp_servers.studio.command": { name: { type: "sessionFlags" } } };
const permissionsMessage = (sandbox: string, approval: string) => ({
  type: "message",
  role: "developer",
  content: [{ type: "input_text", text: `<permissions instructions>\n\`sandbox_mode\` is \`${sandbox}\`.\nApproval policy is currently ${approval}.` }],
});
/** prompt-input's shape: tools grouped by namespace, then codex's own permissions message. */
const promptInput = (toolNames: readonly string[], sandbox: string) => [
  {
    type: "additional_tools",
    tools: toolNames.map((name) => {
      const [namespace = "", ...rest] = name.split(".");
      return { type: "namespace", name: namespace, tools: [{ type: "function", name: rest.join(".") }] };
    }),
  },
  permissionsMessage(sandbox, "never"),
];

interface FakeCodex {
  readonly userMcpServers?: readonly string[];
  readonly hooksAfterState?: readonly CodexHook[];
  readonly serversAfterState?: CodexSetup["mcpServers"];
  readonly origins?: CodexSetup["origins"];
  readonly exposedTools?: readonly string[];
  readonly sandbox?: string;
  readonly cache?: unknown;
}

async function adapterWith(fake: FakeCodex = {}) {
  const probes: CodexProbe[] = [];
  const hasHookState = (probe: CodexProbe) => probe.launchArgs.some((arg) => arg.startsWith("hooks.state="));
  const userServers = fake.userMcpServers ?? ["figma", "my server"];
  const servers = (enabled: boolean) => ({ ...Object.fromEntries(userServers.map((name) => [name, { enabled }] as const)), studio: { enabled: true } });
  const adapter = createCodexAdapter({
    parentEnv: { PATH: "/usr/bin", HOME: "/home/user", OPENAI_API_KEY: "sk-parent", CODEX_HOME: await codexHome(fake.cache) },
    readSetup: (probe) => {
      probes.push(probe);
      const origins = fake.origins ?? STUDIO_ORIGINS;
      if (!hasHookState(probe)) return Promise.resolve({ hooks: BEFORE_STATE, mcpServers: servers(true), origins });
      return Promise.resolve({ hooks: fake.hooksAfterState ?? AFTER_STATE, mcpServers: fake.serversAfterState ?? servers(false), origins });
    },
    readPrompt: (probe) => {
      probes.push(probe);
      return Promise.resolve(promptInput(fake.exposedTools ?? STUDIO_TOOLS, fake.sandbox ?? "read-only"));
    },
  });
  return { adapter, probes };
}

function expectedArgs(catalogPath: string): string[] {
  const hookState = [
    `${JSON.stringify(USER_HOOK_KEY)}={enabled=false}`,
    ...HOOK_EVENTS.map((event, index) => `${JSON.stringify(`/<session-flags>/config.toml:${event}:0:0`)}={trusted_hash="${hashOf(index)}"}`),
  ];
  return [
    "--sandbox",
    "read-only",
    "--ask-for-approval",
    "never",
    "-c",
    'sandbox_mode="read-only"',
    "-c",
    'approval_policy="never"',
    "-c",
    "include_permissions_instructions=true",
    ...CODEX_DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]),
    "-c",
    'web_search="disabled"',
    "-c",
    'model="gpt-5.6-luna"',
    "-c",
    `model_catalog_json=${JSON.stringify(catalogPath)}`,
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
    "mcp_servers.figma.enabled=false",
    "-c",
    'mcp_servers."my server".enabled=false',
    "-c",
    `hooks.state={${hookState.join(",")}}`,
  ];
}

const rejectsWithConflict = (launch: Promise<unknown>, message: RegExp) =>
  expect(launch).rejects.toThrow(
    expect.objectContaining({ name: "AgentLaunchError", reason: "config_conflict", message: expect.stringMatching(message) as unknown }),
  );

describe("codex adapter: launch", () => {
  it("locks codex down through config alone, with the tokens only in env and the instructions only in a file", async () => {
    const request = await launchRequest({ model: "gpt-5.6-luna" });
    const { adapter } = await adapterWith();
    const launch = await adapter.prepare(request, TOKENS, "/opt/codex/bin/codex");

    expect(launch.file).toBe("/opt/codex/bin/codex");
    expect(launch.cwd).toBe(request.projectDir);
    expect(launch.args).toEqual(expectedArgs(join(launch.filesDir, "codex-models.json")));
    expect(launch.env).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/user",
      CODEX_HOME: expect.any(String) as unknown,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      ZKS_HOOK_TOKEN: "hook-secret",
      ZKS_MCP_TOKEN: "mcp-secret",
      ZKS_MCP_URL: TOKENS.mcpUrl,
    });
    const argv = launch.args.join(" ");
    expect(argv).not.toMatch(/hook-secret|mcp-secret|RULES|developer_instructions|dangerously/);
    expect(launch.companion).toBeUndefined();
  });

  it("writes codex's model list back in direct tool mode, with no sub-agents, search or patch tool, and the studio's instructions", async () => {
    const { adapter } = await adapterWith();
    const request = await launchRequest();
    const launch = await adapter.prepare(request, TOKENS, "/opt/codex/bin/codex");
    const catalogPath = join(launch.filesDir, "codex-models.json");
    const catalog: unknown = JSON.parse(await readFile(catalogPath, "utf8"));

    expect(catalog).toEqual({
      models: [
        {
          slug: "gpt-5.6-luna",
          tool_mode: "direct",
          supports_search_tool: false,
          experimental_supported_tools: [],
          apply_patch_tool_type: null,
          model_messages: { instructions_template: expect.stringMatching(/^BASE PROMPT\n\n[\s\S]*RULES/) as unknown, multi_agent: "keep" },
        },
      ],
    });
    expect(dirname(launch.filesDir)).toBe(request.runDir);
    expect(await modeOf(launch.filesDir)).toBe(0o700);
    expect(await modeOf(catalogPath)).toBe(0o600);
  });

  it("asks codex what it would load with exactly the argv, cwd and env the session runs with", async () => {
    const { adapter, probes } = await adapterWith();
    const request = await launchRequest();
    const launch = await adapter.prepare(request, TOKENS, "/opt/codex/bin/codex");
    const finalProbes = probes.filter((probe) => probe.launchArgs.some((arg) => arg.startsWith("hooks.state=")));

    expect(probes).toHaveLength(3);
    for (const probe of probes) expect(probe).toMatchObject({ binaryPath: "/opt/codex/bin/codex", env: launch.env, cwd: request.projectDir });
    expect(finalProbes).toHaveLength(2);
    for (const probe of finalProbes) expect(probe.launchArgs).toEqual(launch.args);
  });

  it("resumes the codex thread with the same lockdown", async () => {
    const { adapter } = await adapterWith({ userMcpServers: [] });
    const launch = await adapter.prepare(await launchRequest({ resumeSessionId: "019a-thread" }), TOKENS, "/opt/codex/bin/codex");
    expect(launch.args[0]).toBe("resume");
    expect(launch.args.at(-1)).toBe("019a-thread");
    expect(launch.args.some((arg) => arg.startsWith("model_catalog_json=") || arg.startsWith("hooks.state="))).toBe(true);
  });

  it("refuses to start when the user's config already sets a key on an MCP server named studio", async () => {
    const { adapter } = await adapterWith({ origins: { ...STUDIO_ORIGINS, "mcp_servers.studio.url": { name: { type: "user" } } } });
    await rejectsWithConflict(adapter.prepare(await launchRequest(), TOKENS, "/opt/codex/bin/codex"), /named studio/);
  });

  it("refuses to start when codex has no model list to lock down", async () => {
    const { adapter } = await adapterWith({ cache: { models: [] } });
    await rejectsWithConflict(adapter.prepare(await launchRequest(), TOKENS, "/opt/codex/bin/codex"), /model list/);
  });
});

describe("codex adapter: what the session may expose and run", () => {
  it.each(["collaboration.spawn_agent", "functions.exec", "multi_agent_v1.spawn_agent", "functions.exec_command", "mcp__figma.get_file"])(
    "refuses to start when codex would offer %s",
    async (tool) => {
      const { adapter } = await adapterWith({ exposedTools: [...STUDIO_TOOLS, tool] });
      await rejectsWithConflict(adapter.prepare(await launchRequest(), TOKENS, "/opt/codex/bin/codex"), new RegExp(tool.replace(".", "\\.")));
    },
  );

  it("refuses to start when an MCP server stays on, such as one a trusted project's .codex adds", async () => {
    const { adapter } = await adapterWith({ serversAfterState: { studio: { enabled: true }, planted: { enabled: true } } });
    await rejectsWithConflict(adapter.prepare(await launchRequest(), TOKENS, "/opt/codex/bin/codex"), /planted/);
  });

  it("refuses to start when codex would not run read-only", async () => {
    const { adapter } = await adapterWith({ sandbox: "workspace-write" });
    await rejectsWithConflict(adapter.prepare(await launchRequest(), TOKENS, "/opt/codex/bin/codex"), /workspace-write/);
  });

  it("refuses to start when a hook the studio did not write would still run", async () => {
    const managed = hook("/etc/codex/managed.toml:pre_tool_use:0:0", { source: "mdm", trustStatus: "managed" });
    const { adapter } = await adapterWith({ hooksAfterState: [...AFTER_STATE, managed] });
    await rejectsWithConflict(adapter.prepare(await launchRequest(), TOKENS, "/opt/codex/bin/codex"), /managed\.toml/);
  });

  it("refuses to start when codex did not trust the studio's own hooks", async () => {
    const { adapter } = await adapterWith({ hooksAfterState: [hook(USER_HOOK_KEY, { enabled: false }), ...studioHooks("modified")] });
    await rejectsWithConflict(adapter.prepare(await launchRequest(), TOKENS, "/opt/codex/bin/codex"), /studio's own hooks/);
  });

  it("refuses to start when codex cannot be asked", async () => {
    const adapter = createCodexAdapter({
      parentEnv: { PATH: "/usr/bin", CODEX_HOME: await codexHome() },
      readSetup: () => Promise.reject(new Error("app-server crashed")),
      readPrompt: () => Promise.resolve(promptInput(STUDIO_TOOLS, "read-only")),
    });
    await rejectsWithConflict(adapter.prepare(await launchRequest(), TOKENS, "/opt/codex/bin/codex"), /app-server crashed/);
  });
});

describe("codex adapter: hooks", () => {
  const adapter = createCodexAdapter();
  if (adapter.events.kind !== "hooks") throw new Error("codex reports through hooks");
  const mapHook = adapter.events.mapHook.bind(adapter.events);
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
      { type: "tool.called", projectId: PROJECT_ID, toolUseId: "exec-1", name: "mcp__studio__project_info", label: expect.any(String) as unknown, input: {} },
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

// Codex has no policy of its own: the studio's default decides its tools, so its tool names are checked against that.
describe("codex adapter: policy", () => {
  const scope = { projectDir: "/p", pluginDir: PLUGIN_DIR, studioToolNames: ["mcp__studio__project_info"] };

  it("keeps the studio's default policy", () => {
    expect(createCodexAdapter().decideTool).toBeUndefined();
  });

  it.each(["apply_patch", "exec_command", "shell", "spawn_agent", "mcp__figma__get_file"])("denies %s", async (toolName) => {
    expect((await decideTerminalTool(toolName, {}, scope)).isAllowed).toBe(false);
  });

  it("allows the studio's own tools", async () => {
    expect(await decideTerminalTool("mcp__studio__project_info", {}, scope)).toEqual({ isAllowed: true });
  });
});
