// Created by The Angelo Umali.
// Opt-in (ZKS_LIVE_CLAUDE=1): the user's own signed-in claude, haiku, no prompt sent; SessionStart must reach the bridge.
import { execFileSync } from "node:child_process";
import { stripVTControlCharacters } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { waitFor } from "./stub-claude.ts";
import { PROJECT_ID } from "./terminal-fixture.ts";
import { startTerminalServer, type TerminalServer } from "./terminal-server.ts";

const isLiveEnabled = process.env.ZKS_LIVE_CLAUDE === "1";
const SESSION_START_WAIT_MS = 60_000;
// Claude Code draws spaces as cursor moves, so match the screen with escapes and spaces removed.
const TRUST_PROMPT = /Itrustthisfolder/;
const YES_SELECTED = /❯\s*Yes/;
const ARROW_DOWN = "\x1b[B";
// Spike 07: keys sent while the dialog first renders are dropped, so let it settle before answering.
const DIALOG_SETTLE_MS = 1500;
const sleep = (durationMs: number) => new Promise((resolve) => setTimeout(resolve, durationMs));

let terminalServer: TerminalServer | undefined;

afterEach(async () => {
  await terminalServer?.close();
});

describe.skipIf(!isLiveEnabled)("live claude in mode T", () => {
  it(
    "delivers SessionStart through the relay to the hooks bridge",
    async () => {
      const claudePath = execFileSync("which", ["claude"], { encoding: "utf8" }).trim();
      terminalServer = await startTerminalServer({ claudePath });
      const { fixture } = terminalServer;
      const session = await fixture.sessions.open({ projectId: PROJECT_ID, projectDir: fixture.projectDir, model: "haiku", rulesText: "Reply briefly." });
      const screenText = () => stripVTControlCharacters(session.pty.snapshot()).replace(/ /g, "");
      const hasStarted = () => fixture.events.some((event) => event.type === "session.started");

      // The test plays the user: a fresh temp folder shows the trust dialog, whose default answer exits (spike 07).
      await waitFor(() => TRUST_PROMPT.test(screenText()) || hasStarted(), SESSION_START_WAIT_MS);
      if (!hasStarted()) {
        await sleep(DIALOG_SETTLE_MS);
        session.pty.write(ARROW_DOWN);
        await waitFor(() => YES_SELECTED.test(screenText()), 5_000);
        await sleep(DIALOG_SETTLE_MS);
        session.pty.write("\r");
      }
      await waitFor(hasStarted, SESSION_START_WAIT_MS);

      expect(fixture.events).toContainEqual(expect.objectContaining({ type: "session.started", projectId: PROJECT_ID }));
      expect(fixture.sessions.isMcpCallAllowed(session.sessionId, session.mcpToken)).toBe(true);
    },
    3 * SESSION_START_WAIT_MS,
  );
});
