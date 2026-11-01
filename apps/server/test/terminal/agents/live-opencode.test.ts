// Created by The Angelo Umali.
// Opt-in (ZKS_LIVE_OPENCODE=1): the user's own signed-in opencode, its companion server and TUI, launched as the adapter says.
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { NewStudioEvent } from "../../../src/events/event-bus.ts";
import { resolveAgentBinary } from "../../../src/terminal/agents/agent-binary.ts";
import { removeSessionFiles } from "../../../src/terminal/session-files.ts";
import { createOpenCodeAdapter } from "../../../src/terminal/agents/opencode.ts";
import { createPtyHost, type TerminalPty } from "../../../src/terminal/pty-host.ts";
import { waitFor } from "../stub-claude.ts";
import { type LiveBridge, startLiveBridge } from "./live-bridge.ts";

const isLiveEnabled = process.env.ZKS_LIVE_OPENCODE === "1";
const START_WAIT_MS = 90_000;
const SESSION_ID = "0b0f6c0e-1f9b-4c1e-9d55-1a2b3c4d5e6f";
const PROJECT_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const PLUGIN_DIR = fileURLToPath(new URL("../../../../../plugin/", import.meta.url));
const MCP_TOKEN = "live-mcp-token";

let bridge: LiveBridge | undefined;
let companion: ChildProcess | undefined;
let pty: TerminalPty | undefined;
let unsubscribe: (() => void) | undefined;
let filesDir: string | undefined;

afterEach(async () => {
  unsubscribe?.();
  pty?.kill();
  companion?.kill();
  await bridge?.close();
  if (filesDir !== undefined) await removeSessionFiles({ dir: filesDir });
});

describe.skipIf(!isLiveEnabled)("live opencode in mode T", () => {
  it(
    "loads only the studio config on the user's sign-in, streams the turn, starts the studio MCP and refuses a read that escapes the project",
    async () => {
      const adapter = createOpenCodeAdapter();
      const binary = await resolveAgentBinary(adapter.binaryNames, process.env, process.platform);
      if (binary === null) throw new Error("opencode is not on PATH");
      bridge = await startLiveBridge([MCP_TOKEN]);
      const tokens = { hookToken: "unused-by-opencode", mcpToken: MCP_TOKEN, mcpUrl: `${bridge.url}/mcp` };
      const projectDir = await mkdtemp(join(tmpdir(), "zks-live-opencode-"));
      const request = {
        sessionId: SESSION_ID,
        projectId: PROJECT_ID,
        projectDir,
        runDir: await mkdtemp(join(tmpdir(), "zks-run-")),
        appPort: bridge.port,
        nodePath: process.execPath,
        rulesText: "Reply in one word.",
        pluginDir: PLUGIN_DIR,
        studioToolNames: [],
        model: "openai/gpt-5.6-luna",
      };
      const launch = await adapter.prepare(request, tokens, binary);
      filesDir = launch.filesDir;
      if (launch.companion === undefined || adapter.events.kind !== "stream") throw new Error("opencode runs a companion server and streams its events");

      const spawned = spawn(launch.companion.file, launch.companion.args, {
        cwd: launch.cwd,
        env: launch.companion.env,
        stdio: ["ignore", "pipe", "ignore"],
        shell: false,
      });
      companion = spawned;
      // Passing means the user's own ~/.config/opencode (MCP servers, plugins, permissions) was not loaded.
      const connected = await launch.companion.connect(spawned.stdout, AbortSignal.timeout(START_WAIT_MS));
      const events: NewStudioEvent[] = [];
      unsubscribe = adapter.events.subscribe(connected, { projectId: PROJECT_ID }, (published) => events.push(...published));
      pty = await createPtyHost({ claudePath: binary }).launch(SESSION_ID, {
        argv: [connected.file, ...connected.args],
        cwd: connected.cwd,
        env: connected.env,
      });
      await waitFor(() => events.some((event) => event.type === "session.started"), START_WAIT_MS);

      // The TUI drops keys while it first draws; typing is retried until the server sees the prompt.
      await waitFor(() => pty?.snapshot().includes("Ask") === true || pty?.snapshot().includes("ctrl") === true, START_WAIT_MS);
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      pty.write("Say ok.");
      await new Promise((resolve) => setTimeout(resolve, 500));
      pty.write("\r");
      await waitFor(() => events.some((event) => event.type === "usage.reported"), START_WAIT_MS);

      expect(events).toContainEqual(expect.objectContaining({ type: "session.started", credential: "your OpenCode sign-in" }));
      expect(events).toContainEqual(expect.objectContaining({ type: "prompt.submitted", text: "Say ok." }));
      // The bridge only answers the MCP token, so a request here means {env:ZKS_MCP_TOKEN} was resolved by opencode.
      expect(bridge.requests.map((request) => request.path)).toContain("/mcp/tools");

      const outsideFile = join(await mkdtemp(join(tmpdir(), "zks-outside-")), "secret.txt");
      await writeFile(outsideFile, "not the project's");
      await symlink(outsideFile, join(projectDir, "link.txt"));
      const serverUrl = connected.args[connected.args.indexOf("--server") + 1];
      const sessionId = connected.args.at(-1);
      const password = connected.env["OPENCODE_SERVER_PASSWORD"] ?? "";
      const asked = await fetch(`${serverUrl}/api/session/${sessionId}/permission`, {
        method: "POST",
        headers: { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`, "content-type": "application/json" },
        body: JSON.stringify({ action: "read", resources: [join(projectDir, "link.txt")] }),
      });
      expect(asked.ok).toBe(true);
      await waitFor(() => events.some((event) => event.type === "tool.denied" && event.name === "read"), START_WAIT_MS);
    },
    4 * START_WAIT_MS,
  );
});
