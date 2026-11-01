// Created by The Angelo Umali.
import { readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OPENCODE_PERMISSIONS } from "../../../src/terminal/agents/opencode-companion.ts";
import { MCP_SERVER_PATH } from "../../../src/terminal/session-files.ts";
import {
  TOKENS,
  SERVER_URL,
  BINARY,
  RESUMED_SESSION,
  STUDIO_RULES,
  modeOf,
  launchRequest,
  studioSources,
  fakeServer,
  printed,
  silent,
  adapterWith,
  connectWith,
} from "./opencode-fixtures.ts";

describe("opencode adapter: launch", () => {
  it("starts a password-protected local server on a port it picks itself, loading only the studio's config", async () => {
    const request = await launchRequest({ model: "openai/gpt-5.6-luna" });
    const launch = await adapterWith().prepare(request, TOKENS, BINARY);
    const password = launch.env["OPENCODE_SERVER_PASSWORD"] ?? "";

    expect(password.length).toBeGreaterThanOrEqual(32);
    expect(launch.env).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/user",
      XDG_DATA_HOME: "/home/user/.local/share",
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      OPENCODE_SERVER_PASSWORD: password,
      // The user's ~/.config/opencode is never a config source; the sign-in under XDG_DATA_HOME still is.
      XDG_CONFIG_HOME: launch.filesDir,
      OPENCODE_CONFIG_DIR: launch.filesDir,
      OPENCODE_DISABLE_PROJECT_CONFIG: "1",
      OPENCODE_DISABLE_CLAUDE_CODE: "1",
      OPENCODE_DISABLE_AUTOUPDATE: "1",
    });
    expect(launch.companion?.file).toBe(BINARY);
    expect(launch.companion?.args).toEqual(["serve", "--hostname", "127.0.0.1", "--port", "0"]);
    expect(launch.companion?.env).toEqual({ ...launch.env, ZKS_MCP_TOKEN: "mcp-secret", ZKS_MCP_URL: TOKENS.mcpUrl });
    expect([...launch.args, ...(launch.companion?.args ?? [])].join(" ")).not.toMatch(new RegExp(`${password}|mcp-secret|hook-secret`));
  });

  it("writes a deny-by-default config whose only tools are the studio's and reads the studio confirms", async () => {
    const launch = await adapterWith().prepare(await launchRequest({ model: "openai/gpt-5.6-luna" }), TOKENS, BINARY);
    const configPath = join(launch.filesDir, "opencode.json");
    const instructionsPath = join(launch.filesDir, "instructions.md");

    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual({
      $schema: "https://opencode.ai/config.json",
      share: "disabled",
      autoupdate: false,
      model: "openai/gpt-5.6-luna",
      mcp: {
        studio: {
          type: "local",
          command: ["/usr/bin/node", MCP_SERVER_PATH],
          environment: { ZKS_MCP_TOKEN: "{env:ZKS_MCP_TOKEN}", ZKS_MCP_URL: "{env:ZKS_MCP_URL}" },
        },
      },
      permission: OPENCODE_PERMISSIONS,
      instructions: [instructionsPath],
    });
    expect(OPENCODE_PERMISSIONS).toEqual({ "*": "deny", "studio_*": "allow", read: "ask", external_directory: "deny" });
    expect(await readFile(instructionsPath, "utf8")).toContain("read_skill");
    expect(await modeOf(launch.filesDir)).toBe(0o700);
    expect(await modeOf(configPath)).toBe(0o600);
    expect(await modeOf(instructionsPath)).toBe(0o600);
  });

  it("attaches the TUI to the address its own server printed, after checking that server with the password", async () => {
    const server = fakeServer();
    const { prepared, connect } = await connectWith(server, { output: printed("starting\nserver listening on http://127.0.", "0.1:47123\n") });
    const launch = await connect();
    const password = prepared.env["OPENCODE_SERVER_PASSWORD"] ?? "";

    expect(launch?.args).toEqual([prepared.cwd, "--server", SERVER_URL, "--session", RESUMED_SESSION]);
    expect(launch?.env).toEqual(prepared.env);
    expect(server.calls.map((call) => new URL(call.url).pathname).sort()).toEqual(["/api/agent", "/api/config", "/api/permission/saved", "/api/plugin"]);
    server.calls.forEach((call) => {
      expect(call.url.startsWith(SERVER_URL)).toBe(true);
      expect(new Headers(call.init?.headers).get("authorization")).toBe(`Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`);
    });
  });

  it("sends nothing to any port until its own server names one, and never trusts a non-loopback address", async () => {
    const server = fakeServer();
    const { connect } = await connectWith(server, { output: printed("server listening on http://0.0.0.0:47123\n") });

    await expect(connect()).rejects.toMatchObject({ name: "AgentLaunchError", reason: "companion_failed" });
    expect(server.calls).toEqual([]);
  });

  it("gives up when the server stops or the session is cancelled before it listens", async () => {
    const stopped = await connectWith(fakeServer(), { output: printed("Error: something broke\n") });
    await expect(stopped.connect()).rejects.toMatchObject({ reason: "companion_failed" });

    const cancelled = await connectWith(fakeServer());
    await expect(cancelled.prepared.companion?.connect(silent(), AbortSignal.timeout(50))).rejects.toThrow();
  });

  // Captured from opencode 2.2.5 through the studio's own launch: the banner, then the prompt box's footer.
  it("counts the prompt box's footer, not the banner, as ready for a prompt", () => {
    const { inputReady } = adapterWith();
    expect(inputReady?.test("┃┃┃┃Build·GPT-6.1 Sol FastOpenAI·high╹")).toBe(true);
    expect(inputReady?.test("2.2.5   q⊙ 1 MCP/mcps")).toBe(false);
  });

  it("never launches a .cmd shim, which would pass its arguments through cmd.exe", () => {
    expect(adapterWith().binaryNames.filter((name) => name.endsWith(".cmd"))).toEqual([]);
  });

  it("removes its session folder when a step of prepare fails", async () => {
    const request = { ...(await launchRequest()), pluginDir: join(tmpdir(), "zks-no-such-plugin") };
    await expect(adapterWith().prepare(request, TOKENS, BINARY)).rejects.toThrow();
    expect(await readdir(request.runDir)).toEqual([]);
  });

  it("resumes the user's opencode session by its id", async () => {
    const launch = await adapterWith().prepare(await launchRequest({ resumeSessionId: RESUMED_SESSION }), TOKENS, BINARY);
    expect(launch.args.at(-1)).toBe(RESUMED_SESSION);
  });
});

describe("opencode adapter: resolved config", () => {
  const refusals: ReadonlyArray<readonly [string, (answers: Map<string, unknown>, filesDir: string) => void]> = [
    [
      "a config file outside the studio's folder",
      (answers, filesDir) =>
        answers.set("/api/config", [...studioSources(filesDir), { type: "document", path: "/home/user/.config/opencode/opencode.json", info: {} }]),
    ],
    [
      "config passed in through the environment",
      (answers, filesDir) =>
        answers.set("/api/config", [...studioSources(filesDir), { type: "document", info: { mcp: { servers: { extra: { type: "local" } } } } }]),
    ],
    [
      "an MCP server other than the studio's in the studio's own file",
      (answers, filesDir) =>
        answers.set("/api/config", [{ type: "document", path: join(filesDir, "opencode.json"), info: { mcp: { servers: { studio: {}, extra: {} } } } }]),
    ],
    [
      "an agent allowed a tool after the studio's rules",
      (answers) => answers.set("/api/agent", { data: [{ id: "build", permissions: [...STUDIO_RULES, { action: "shell", resource: "*", effect: "allow" }] }] }),
    ],
    [
      "an agent without the studio's rules",
      (answers) => answers.set("/api/agent", { data: [{ id: "reviewer", permissions: [{ action: "*", resource: "*", effect: "allow" }] }] }),
    ],
    [
      "a plugin the user installed",
      (answers) => answers.set("/api/plugin", { data: [{ id: "opencode-anthropic-auth", source: { type: "npm" }, state: { status: "active" } }] }),
    ],
    ["a saved approval that would answer reads before the studio sees them", (answers) => answers.set("/api/permission/saved", { data: [{ id: "prm_1" }] })],
  ];

  it.each(refusals)("refuses to launch with %s", async (_label, edit) => {
    const { connect } = await connectWith(fakeServer(), { edit });
    await expect(connect()).rejects.toMatchObject({ name: "AgentLaunchError", reason: "config_conflict" });
  });

  it("fails closed when the server answers in a shape it does not know", async () => {
    const { connect } = await connectWith(fakeServer(), { edit: (answers) => answers.set("/api/agent", { agents: "?" }) });
    await expect(connect()).rejects.toMatchObject({ reason: "companion_failed" });
  });
});
