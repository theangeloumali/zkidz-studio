// Created by The Angelo Umali.
// One terminal agent CLI (Claude Code, Codex, OpenCode): how to find it, launch it locked down, and read its events.
// Phase 7 of docs/plans/zkidz-studio-editing-ux-agents-2026-10-29.md moves launchSession onto this seam.
import type { AgentKind, UsageFigures } from "@zks/shared";
import type { TerminalTokens } from "../../auth/agent-env.ts";
import type { NewStudioEvent } from "../../events/event-bus.ts";
import type { TerminalToolDecision, TerminalToolScope } from "../hook-policy.ts";

export interface AgentLaunchRequest {
  readonly sessionId: string;
  /** The agent's own session id to resume, when it keeps one. */
  readonly resumeSessionId?: string;
  readonly projectId: string;
  readonly projectDir: string;
  /** ZKS_RUN; every file the adapter writes goes in a 0700 folder under it and is removed when the session ends. */
  readonly runDir: string;
  readonly appPort: number;
  readonly nodePath: string;
  /** The studio rules block (buildRulesPromptBlock), joined with the edit skills for agents with no plugin system. */
  readonly rulesText: string;
  readonly pluginDir: string;
  readonly studioToolNames: readonly string[];
  readonly model?: string;
}

/** A process the adapter needs beside the PTY (OpenCode's `serve`); it starts first and is killed with the session. */
export interface AgentCompanion {
  readonly file: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  /** Resolves once the companion accepts the PTY's connection. */
  readonly isReady: (signal: AbortSignal) => Promise<void>;
}

export interface PreparedLaunch {
  /** The binary the PTY runs: always the resolved absolute path, argv only, never a shell. */
  readonly file: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
  /** The folder of session files to remove on exit. */
  readonly filesDir: string;
  readonly companion?: AgentCompanion;
}

export interface AgentEventContext {
  readonly projectId: string;
  readonly model?: string;
}

/** Hook-driven agents post to the bearer bridge route; stream-driven ones are read by the adapter itself. */
export type AgentEventSource =
  | { readonly kind: "hooks"; mapHook(payload: unknown, context: AgentEventContext): NewStudioEvent[] }
  | {
      readonly kind: "stream";
      /** Subscribes to the companion's event stream; returns the unsubscribe. */
      subscribe(launch: PreparedLaunch, context: AgentEventContext, publish: (events: readonly NewStudioEvent[]) => void): () => void;
    };

export interface AgentAdapter {
  readonly kind: AgentKind;
  /** Plain text for the UI, e.g. "Codex". */
  readonly label: string;
  /** Names searched on PATH, in order (claude, claude.exe, claude.cmd). */
  readonly binaryNames: readonly string[];
  readonly versionArgs: readonly string[];
  /** The oldest version whose lockdown this adapter has been checked against. */
  readonly minVersion: string;
  prepare(request: AgentLaunchRequest, tokens: TerminalTokens, binaryPath: string): Promise<PreparedLaunch>;
  readonly events: AgentEventSource;
  /** The studio's deny-by-default tool policy, for agents whose hooks can block a call. */
  decideTool?(toolName: string, toolInput: unknown, scope: TerminalToolScope): Promise<TerminalToolDecision>;
  /** Where usage comes from for this agent, if anywhere; folded into the edit by the edit recorder. */
  readonly usageSource?: (sessionId: string) => Promise<UsageFigures | null>;
}
