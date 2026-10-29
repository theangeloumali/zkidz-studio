// Created by The Angelo Umali.
// Opt-in (ZKS_LIVE_CODEX=1): the user's own signed-in codex, locked down by the adapter, launched through pty-host.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import type { NewStudioEvent } from "../../../src/events/event-bus.ts";
import { resolveAgentBinary } from "../../../src/terminal/agents/agent-binary.ts";
import { removeAgentFiles } from "../../../src/terminal/agents/agent-files.ts";
import { createCodexAdapter } from "../../../src/terminal/agents/codex.ts";
import { createPtyHost, type TerminalPty } from "../../../src/terminal/pty-host.ts";
import { waitFor } from "../stub-claude.ts";
import { type LiveBridge, startLiveBridge } from "./live-bridge.ts";

const isLiveEnabled = process.env.ZKS_LIVE_CODEX === "1";
const START_WAIT_MS = 90_000;
const SESSION_ID = "0b0f6c0e-1f9b-4c1e-9d55-1a2b3c4d5e6f";
const PROJECT_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const PLUGIN_DIR = fileURLToPath(new URL("../../../../../plugin/", import.meta.url));
const TOKENS = { hookToken: "live-hook-token", mcpToken: "live-mcp-token", mcpUrl: "http://127.0.0.1:9/mcp/none" };

let bridge: LiveBridge | undefined;
let pty: TerminalPty | undefined;
let filesDir: string | undefined;

afterEach(async () => {
  pty?.kill();
  await bridge?.close();
  if (filesDir !== undefined) await removeAgentFiles(filesDir);
});

describe.skipIf(!isLiveEnabled)("live codex in mode T", () => {
  it(
    "relays SessionStart and the prompt through the studio hooks",
    async () => {
      const adapter = createCodexAdapter();
      const binary = await resolveAgentBinary(adapter.binaryNames, process.env, process.platform);
      if (binary === null) throw new Error("codex is not on PATH");
      bridge = await startLiveBridge([TOKENS.hookToken]);
      const projectDir = await mkdtemp(join(tmpdir(), "zks-live-codex-"));
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
        model: "gpt-5.6-luna",
      };
      const launch = await adapter.prepare(request, TOKENS, binary);
      filesDir = launch.filesDir;
      expect(launch.args.join(" ")).not.toMatch(/dangerously|developer_instructions|Reply in one word/);
      pty = await createPtyHost({ claudePath: binary }).launch(SESSION_ID, { argv: [launch.file, ...launch.args], cwd: launch.cwd, env: launch.env });
      if (adapter.events.kind !== "hooks") throw new Error("codex reports through hooks");
      const mapHook = adapter.events.mapHook.bind(adapter.events);
      const events = (): NewStudioEvent[] => (bridge?.requests ?? []).flatMap((request) => mapHook(request.body, { projectId: PROJECT_ID }));
      const screen = () => stripVTControlCharacters(pty?.snapshot() ?? "");

      // A resumed or fresh TUI may drop keys while it first draws, so wait for its prompt before typing.
      await waitFor(() => /›|>_/.test(screen()), START_WAIT_MS);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      pty.write("Say ok.");
      await new Promise((resolve) => setTimeout(resolve, 500));
      pty.write("\r");
      await waitFor(() => events().some((event) => event.type === "prompt.submitted"), START_WAIT_MS);

      expect(events()).toContainEqual(expect.objectContaining({ type: "session.started", credential: "your Codex sign-in" }));
      expect(events()).toContainEqual(expect.objectContaining({ type: "prompt.submitted", text: "Say ok." }));
    },
    3 * START_WAIT_MS,
  );
});
