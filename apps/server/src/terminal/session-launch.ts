// Created by The Angelo Umali.
// Opens one mode T session: claude check → 0600 session files → argv-only PTY spawn.
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import type { AgentKind, TerminalAgentKind, UsageFigures } from "@zks/shared";
import type { TerminalTokens } from "../auth/agent-env.ts";
import type { NewStudioEvent } from "../events/event-bus.ts";
import type { Logger } from "../logging/logger.ts";
import type { AskedQuestions, QuestionAnswers } from "../tools/context.ts";
import { launchAgentSession, type AgentRuntime, type TerminalAgent, type TerminalAgents } from "./agent-launch.ts";
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
  /** DecisionBroker.askQuestions: the Activity tab's question card; null when dismissed or cancelled. */
  readonly askQuestions: (projectId: string, questions: AskedQuestions, signal: AbortSignal) => Promise<QuestionAnswers | null>;
  readonly sessionStartTimeoutMs?: number;
  readonly promptRetryMs?: number;
  /** How long a freshly drawn agent input waits before taking a prompt; tests shorten it. */
  readonly inputSettleMs?: number;
  /** How long a card waits before the question falls back to the terminal dialog. */
  readonly questionTimeoutMs?: number;
  /** How long a question card waits for Claude's text about it, so the text lands first in Activity. */
  readonly questionTextWaitMs?: number;
  readonly readTranscriptUsage?: (transcriptPath: string) => Promise<UsageFigures | null>;
  /** Where claude keeps transcripts; a transcript path outside it is never read. */
  readonly transcriptRoot?: string;
  /** The installed Codex and OpenCode, for their terminal modes (ADR 0007). */
  readonly agents?: TerminalAgents;
  /** Looks an agent up again when it was not installed at startup. */
  readonly findAgent?: (kind: TerminalAgentKind) => Promise<TerminalAgent | undefined>;
}

export interface OpenTerminalRequest {
  readonly projectId: string;
  readonly projectDir: string;
  readonly model?: string;
  readonly rulesText: string;
  readonly resumeSessionId?: string;
  /** Claude when unset. */
  readonly agentKind?: AgentKind;
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
  readonly files: Pick<SessionFiles, "dir">;
  /** Codex or OpenCode; unset for Claude, whose hooks terminal-sessions.ts handles itself. */
  readonly agent?: AgentRuntime;
  hasStarted: boolean;
  wasKilled: boolean;
  /** Prompts sent before SessionStart; they die with the record. */
  readonly queuedPrompts: string[];
  lastPrompt?: string;
  /** Set by Stop: an interrupt before Claude answers puts the prompt back in its input. */
  promptToErase?: string;
  /** Between UserPromptSubmit and Stop; Claude Code then queues a prompt itself. */
  isWorking: boolean;
  /** A prompt written while idle that UserPromptSubmit has not confirmed yet. */
  promptRetryTimer?: NodeJS.Timeout;
  sessionStartTimer?: NodeJS.Timeout;
  /** MessageDisplay text per message until its final batch. */
  readonly displayBuffers: Map<string, string>;
  /** Claude's text went out since the last tool call or prompt, so a question now needs no wait for it. */
  hasTextSinceTool: boolean;
  /** False until an agent that names an input marker has drawn it; unset for agents that take input at once. */
  isInputReady?: boolean;
  /** Question cards waiting for that text. */
  readonly textWaiters: (() => void)[];
  /** A MessageDisplay narration went out this turn, so Stop's last message would only repeat it. */
  hasNarratedTurn: boolean;
  /** Question cards waiting on the user; Stop, Kill and exit dismiss them. */
  readonly questionCards: Set<AbortController>;
  /** The last status-line usage published, so an unchanged refresh publishes nothing. */
  lastStatusUsage?: string;
}

/** The per-session state every agent's record starts with. */
export function freshSessionState() {
  return {
    hasStarted: false,
    wasKilled: false,
    isWorking: false,
    queuedPrompts: [],
    displayBuffers: new Map<string, string>(),
    hasTextSinceTool: false,
    textWaiters: [],
    hasNarratedTurn: false,
    questionCards: new Set<AbortController>(),
  };
}

export async function launchSession(deps: TerminalSessionsDeps, request: OpenTerminalRequest): Promise<SessionRecord> {
  if (request.agentKind === "codex" || request.agentKind === "opencode") return launchAgentSession(deps, request, request.agentKind);
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
    return { ...request, ...tokens, sessionId, pty, files, ...freshSessionState() };
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
