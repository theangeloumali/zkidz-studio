// Created by The Angelo Umali.
// Opens one mode T session: claude check → 0600 session files → argv-only PTY spawn.
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import type { TerminalTokens } from "../auth/agent-env.ts";
import type { NewStudioEvent } from "../events/event-bus.ts";
import type { Logger } from "../logging/logger.ts";
import { buildTerminalArgs } from "./launch-args.ts";
import { TerminalLaunchError, type PtyHost, type TerminalPty } from "./pty-host.ts";
import { HOOK_RELAY_PATH, MCP_SERVER_PATH, removeSessionFiles, writeSessionFiles, type SessionFiles } from "./session-files.ts";

export interface TerminalSessionsDeps {
  readonly ptyHost: PtyHost;
  readonly eventBus: { publish(event: NewStudioEvent): Promise<unknown> };
  /** Session files live here (§11 ZKS_RUN); clearSessionFiles empties it at startup. */
  readonly runDir: string;
  readonly appPort: number;
  readonly pluginDir: string;
  readonly studioToolNames: readonly string[];
  /** kai's `createSessionToken` and `tokensMatch` (security/token.ts). */
  readonly createToken: () => string;
  readonly tokensMatch: (expected: string, presented: string | undefined) => boolean;
  /** buildAgentEnv({ kind: "terminal", tokens }); pty-host refuses one that carries a credential. */
  readonly buildEnv: (tokens: TerminalTokens) => Record<string, string>;
  /** The same queued-job cancel the agent manager uses, so a killed or crashed session leaves no engine work running. */
  readonly cancelProjectJobs: (projectId: string) => Promise<void>;
  readonly logger: Logger;
  readonly sessionStartTimeoutMs?: number;
}

export interface OpenTerminalRequest {
  readonly projectId: string;
  readonly projectDir: string;
  readonly model?: string;
  readonly rulesText: string;
  readonly resumeSessionId?: string;
}

export interface TerminalSession {
  readonly sessionId: string;
  readonly projectId: string;
  readonly projectDir: string;
  readonly model?: string;
  readonly hookToken: string;
  readonly mcpToken: string;
  readonly pty: TerminalPty;
}

export interface SessionRecord extends TerminalSession {
  readonly files: SessionFiles;
  hasStarted: boolean;
  wasKilled: boolean;
  /** Prompts sent before SessionStart; they die with the record. */
  readonly queuedPrompts: string[];
  sessionStartTimer?: NodeJS.Timeout;
}

export async function launchSession(deps: TerminalSessionsDeps, request: OpenTerminalRequest): Promise<SessionRecord> {
  await assertClaudeInstalled(deps, request.projectId);
  const sessionId = request.resumeSessionId ?? randomUUID();
  const tokens = { hookToken: deps.createToken(), mcpToken: deps.createToken() };
  const files = await writeSessionFiles({
    runDir: deps.runDir,
    sessionId,
    appPort: deps.appPort,
    nodePath: process.execPath,
    hookRelayPath: HOOK_RELAY_PATH,
    mcpServerPath: MCP_SERVER_PATH,
    rulesText: request.rulesText,
  });
  const args = buildTerminalArgs({
    sessionId,
    resume: request.resumeSessionId !== undefined,
    settingsPath: files.settingsPath,
    mcpConfigPath: files.mcpConfigPath,
    rulesPath: files.rulesPath,
    pluginDir: deps.pluginDir,
    studioToolNames: deps.studioToolNames,
    model: request.model,
  });
  try {
    const pty = await deps.ptyHost.launch(sessionId, {
      argv: [deps.ptyHost.claudePath, ...args],
      cwd: request.projectDir,
      env: deps.buildEnv({ ...tokens, mcpUrl: files.mcpUrl }),
    });
    return { ...request, ...tokens, sessionId, pty, files, hasStarted: false, wasKilled: false, queuedPrompts: [] };
  } catch (error) {
    await removeSessionFiles(files);
    throw error;
  }
}

async function assertClaudeInstalled(deps: TerminalSessionsDeps, projectId: string): Promise<void> {
  try {
    await access(deps.ptyHost.claudePath, constants.X_OK);
  } catch {
    const message = "Claude Code was not found. Install it, then open the terminal again.";
    await deps.eventBus.publish({ type: "session.error", projectId, kind: "claude_missing", message });
    throw new TerminalLaunchError("claude_missing", message);
  }
}
