// Created by The Angelo Umali.
// Opt-in (ZKS_LIVE_CLAUDE=1): the user's own signed-in claude on haiku; SessionStart reaches the bridge, and one short
// turn proves auto mode, the Activity question card, MessageDisplay narration and the usage reports end to end.
import { execFileSync } from "node:child_process";
import { stripVTControlCharacters } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { waitFor } from "./stub-claude.ts";
import { PROJECT_ID } from "./terminal-fixture.ts";
import type { TerminalSession } from "../../src/terminal/terminal-sessions.ts";
import { startTerminalServer, type TerminalServer } from "./terminal-server.ts";

const isLiveEnabled = process.env.ZKS_LIVE_CLAUDE === "1";
const SESSION_START_WAIT_MS = 60_000;
const TURN_WAIT_MS = 120_000;
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

/** Plays the user at the folder-trust dialog, whose highlighted default exits (spike 07). */
async function acceptTrustAndStart(server: TerminalServer, session: TerminalSession): Promise<void> {
  const { fixture } = server;
  const screenText = () => stripVTControlCharacters(session.pty.snapshot()).replace(/ /g, "");
  const hasStarted = () => fixture.events.some((event) => event.type === "session.started");
  await waitFor(() => TRUST_PROMPT.test(screenText()) || hasStarted(), SESSION_START_WAIT_MS);
  if (!hasStarted()) {
    await sleep(DIALOG_SETTLE_MS);
    session.pty.write(ARROW_DOWN);
    await waitFor(() => YES_SELECTED.test(screenText()), 5_000);
    await sleep(DIALOG_SETTLE_MS);
    session.pty.write("\r");
  }
  await waitFor(hasStarted, SESSION_START_WAIT_MS);
}

const claudePath = () => execFileSync("which", ["claude"], { encoding: "utf8" }).trim();

describe.skipIf(!isLiveEnabled)("live claude in mode T", () => {
  it(
    "delivers SessionStart through the relay to the hooks bridge",
    async () => {
      terminalServer = await startTerminalServer({ claudePath: claudePath() });
      const { fixture } = terminalServer;
      const session = await fixture.sessions.open({ projectId: PROJECT_ID, projectDir: fixture.projectDir, model: "haiku", rulesText: "Reply briefly." });
      await acceptTrustAndStart(terminalServer, session);

      expect(fixture.events).toContainEqual(expect.objectContaining({ type: "session.started", projectId: PROJECT_ID }));
      expect(fixture.sessions.isMcpCallAllowed(session.sessionId, session.mcpToken)).toBe(true);
    },
    3 * SESSION_START_WAIT_MS,
  );

  // Haiku, one short turn: the card is answered the way the Activity tab's Send does, through the broker's settle.
  it(
    "starts in auto mode, answers a question from the card, and reports Claude's text and usage",
    async () => {
      const askedAt: number[] = [];
      terminalServer = await startTerminalServer(
        { claudePath: claudePath() },
        {
          askQuestions: (_projectId, questions) => {
            askedAt.push(terminalServer?.fixture.events.length ?? 0);
            return Promise.resolve(Object.fromEntries(questions.map((question) => [question.question, "Blue"])));
          },
        },
      );
      const { fixture } = terminalServer;
      const session = await fixture.sessions.open({ projectId: PROJECT_ID, projectDir: fixture.projectDir, model: "haiku", rulesText: "Reply briefly." });
      await acceptTrustAndStart(terminalServer, session);
      const screenText = () => stripVTControlCharacters(session.pty.snapshot()).replace(/ /g, "");

      fixture.sessions.submitPrompt(
        PROJECT_ID,
        "First write one short sentence about colours. Then use the AskUserQuestion tool once to ask me 'Which color?' with the options Red and Blue. After I answer, reply with exactly: ANSWER=<my answer>",
      );
      const narrations = () => fixture.events.flatMap((event) => (event.type === "narration" ? [event.text] : []));
      await waitFor(() => narrations().some((text) => text.includes("ANSWER=Blue")), TURN_WAIT_MS);

      expect(screenText()).toContain("automodeon");
      expect(askedAt).toHaveLength(1);
      const firstNarrationAt = fixture.events.findIndex((event) => event.type === "narration");
      expect(firstNarrationAt).toBeLessThan(askedAt[0] ?? 0);
      expect(narrations().filter((text) => text.includes("ANSWER=Blue"))).toHaveLength(1);
      await waitFor(() => fixture.events.some((event) => event.type === "usage.reported" && event.source === "claude_transcript"), TURN_WAIT_MS);
      expect(fixture.events).toContainEqual(expect.objectContaining({ type: "usage.reported", source: "claude_statusline" }));
    },
    3 * SESSION_START_WAIT_MS + TURN_WAIT_MS,
  );
});
