// Created by The Angelo Umali.
// Real PTY + stub claude + temp ZKS_HOME, shared by the sessions and routes tests.
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAgentEnv } from "../../src/auth/agent-env.ts";
import type { NewStudioEvent } from "../../src/events/event-bus.ts";
import { createPtyHost } from "../../src/terminal/pty-host.ts";
import { createTerminalSessions, type TerminalSessions, type TerminalSessionsDeps } from "../../src/terminal/terminal-sessions.ts";
import { writeStubClaude } from "./stub-claude.ts";

export const PROJECT_ID = "0b6f4f0e-7f43-4d8f-9a3c-5c9d7c1f2e11";
export const CATALOG_TOOL = "mcp__studio__render_preview";
const silentLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };

export interface TerminalFixture {
  readonly sessions: TerminalSessions;
  readonly events: NewStudioEvent[];
  readonly studioHome: string;
  readonly runDir: string;
  readonly projectDir: string;
  /** Every projectId cancelProjectJobs was called with, in order. */
  readonly cancelledProjects: string[];
  readonly cleanup: () => Promise<void>;
}

export interface TerminalFixtureOptions {
  readonly isClaudeMissing?: boolean;
  /** A real claude for the opt-in live test; the stub otherwise. */
  readonly claudePath?: string;
}

export async function createTerminalFixture(overrides: Partial<TerminalSessionsDeps> = {}, options: TerminalFixtureOptions = {}): Promise<TerminalFixture> {
  const studioHome = await mkdtemp(join(tmpdir(), "zks-terminal-"));
  const projectDir = join(studioHome, "projects", "demo");
  const pluginDir = join(studioHome, "plugin");
  await Promise.all([mkdir(projectDir, { recursive: true }), mkdir(pluginDir)]);
  await writeFile(join(projectDir, "cuts.json"), "{}");
  const claudePath = options.isClaudeMissing === true ? join(studioHome, "missing-claude") : (options.claudePath ?? (await writeStubClaude(studioHome)));
  const events: NewStudioEvent[] = [];
  const cancelledProjects: string[] = [];
  const runDir = join(studioHome, "run");

  const sessions = createTerminalSessions({
    ptyHost: createPtyHost({ claudePath }),
    eventBus: { publish: (event) => Promise.resolve(void events.push(event)) },
    runDir,
    appPort: 9,
    pluginDir,
    studioToolNames: [CATALOG_TOOL],
    createToken: () => randomBytes(32).toString("base64url"),
    tokensMatch: (expected, presented) => expected !== "" && expected === presented,
    buildEnv: (tokens) => buildAgentEnv({ kind: "terminal", tokens }, { studioHome, appVersion: "0.0.0-test", proxyOptIn: false }),
    cancelProjectJobs: (projectId) => Promise.resolve(void cancelledProjects.push(projectId)),
    logger: silentLogger,
    // Off unless a test turns it on: the stub never fires UserPromptSubmit, so every prompt would be resent.
    promptRetryMs: 60_000,
    ...overrides,
  });

  return {
    sessions,
    events,
    studioHome,
    runDir,
    projectDir,
    cancelledProjects,
    async cleanup() {
      sessions.killAll();
      await rm(studioHome, { recursive: true, force: true });
    },
  };
}
