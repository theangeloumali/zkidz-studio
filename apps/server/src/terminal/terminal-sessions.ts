// Created by The Angelo Umali.
// Mode T session registry (plan §6.3): hooks → policy + events, Esc to stop, Kill to close.
import type { HookPayload, HookResponse } from "@zks/shared";
import type { NewStudioEvent } from "../events/event-bus.ts";
import { hookToStudioEvents } from "./hook-events.ts";
import { decideTerminalTool, type TerminalToolDecision } from "./hook-policy.ts";
import { encodePrompt, eraseInput } from "./prompt-input.ts";
import { removeSessionFiles } from "./session-files.ts";
import { launchSession, type OpenTerminalRequest, type SessionRecord, type TerminalSession, type TerminalSessionsDeps } from "./session-launch.ts";

export type { TerminalSession, TerminalSessionsDeps } from "./session-launch.ts";

/** Spike 07: SessionStart lands about 3 s after spawn; past this the user is likely signing in. */
const SESSION_START_TIMEOUT_MS = 30_000;
/** A resumed Claude Code drops input for its first seconds, after SessionStart has fired (measured on 2.1.311). */
const PROMPT_RETRY_MS = 3000;
const PROMPT_ATTEMPTS = 4;

export interface TerminalSessions {
  open(request: OpenTerminalRequest): Promise<TerminalSession>;
  find(sessionId: string): TerminalSession | undefined;
  findByProject(projectId: string): TerminalSession | undefined;
  isHookAuthorized(sessionId: string, presentedToken: string | undefined): boolean;
  /** The stdio twin refuses every call until SessionStart arrives (plan §6.3). */
  isMcpCallAllowed(sessionId: string, presentedToken: string | undefined): boolean;
  handleHook(sessionId: string, payload: HookPayload): Promise<HookResponse>;
  submitPrompt(projectId: string, text: string): boolean;
  stop(projectId: string): boolean;
  kill(projectId: string): boolean;
  killAll(): void;
}

type PreToolUsePayload = Extract<HookPayload, { hook_event_name: "PreToolUse" }>;

export function createTerminalSessions(deps: TerminalSessionsDeps): TerminalSessions {
  const records = new Map<string, SessionRecord>();
  const findRecordByProject = (projectId: string) => [...records.values()].find((record) => record.projectId === projectId);
  // Each launch writes its own files folder; a reopen still waits for the last run's cleanup, so its exit events go out first.
  const pendingCleanups = new Map<string, Promise<void>>();

  const publishAll = async (newEvents: readonly NewStudioEvent[]) => {
    for (const newEvent of newEvents) await deps.eventBus.publish(newEvent);
  };
  const publishInBackground = (newEvents: readonly NewStudioEvent[]) => {
    publishAll(newEvents).catch((error: unknown) => deps.logger.error("terminal event publish failed", { error }));
  };

  const watchLifecycle = (record: SessionRecord) => {
    const { projectId } = record;
    record.sessionStartTimer = setTimeout(() => {
      if (!record.hasStarted) publishInBackground([{ type: "terminal.state", projectId, state: "waiting" }]);
    }, deps.sessionStartTimeoutMs ?? SESSION_START_TIMEOUT_MS);
    record.sessionStartTimer.unref();

    record.pty.onExit((exitCode) => {
      clearTimeout(record.sessionStartTimer);
      clearTimeout(record.promptRetryTimer);
      records.delete(record.sessionId);
      const isUnexpected = !record.wasKilled && exitCode !== 0;
      const exitEvents: NewStudioEvent[] = [{ type: "terminal.state", projectId, state: "exited", exitCode }];
      if (isUnexpected) {
        exitEvents.push({ type: "session.error", projectId, kind: "terminal_exited", message: `Claude Code exited with code ${exitCode}.`, action: "Restart" });
      }
      if (record.wasKilled || isUnexpected) {
        deps.cancelProjectJobs(projectId).catch((error: unknown) => deps.logger.error("terminal job cancel failed", { projectId, error }));
      }
      const cleanup = removeSessionFiles(record.files)
        .catch((error: unknown) => deps.logger.warn("terminal session files not removed", { error }))
        .finally(() => {
          if (pendingCleanups.get(projectId) === cleanup) pendingCleanups.delete(projectId);
          publishInBackground(exitEvents);
        });
      pendingCleanups.set(projectId, cleanup);
    });
  };

  const killRecord = (record: SessionRecord) => {
    record.wasKilled = true;
    record.pty.kill();
  };

  const eventContext = (record: SessionRecord) => ({
    projectId: record.projectId,
    model: record.model,
  });

  // Always an explicit answer: Claude Code blocks the tool only when the bridge is unreachable (spike 07), not on a 500.
  const answerPreToolUse = async (record: SessionRecord, payload: PreToolUsePayload): Promise<HookResponse> => {
    const scope = { projectDir: record.projectDir, pluginDir: deps.pluginDir, studioToolNames: deps.studioToolNames };
    const decision = await decideTerminalTool(payload.tool_name, payload.tool_input, scope).catch((error: unknown): TerminalToolDecision => {
      deps.logger.error("terminal tool policy failed", { error });
      return { isAllowed: false, reason: "ZKidz Studio could not check this tool, so it is blocked." };
    });
    try {
      await publishAll(hookToStudioEvents(payload, { ...eventContext(record), decision }));
    } catch (error) {
      deps.logger.error("terminal tool event not published", { error });
    }
    return preToolUseAnswer(decision);
  };

  // Erases a prompt a Stop put back in Claude Code's input first, so the paste is not appended to it.
  const writePrompt = (record: SessionRecord, text: string) => {
    const erase = record.promptToErase === undefined ? "" : eraseInput(record.promptToErase);
    record.promptToErase = undefined;
    record.lastPrompt = text;
    record.pty.write(erase + encodePrompt(text));
    if (!record.isWorking) retryUntilSubmitted(record, text, 1);
  };

  // Resent until UserPromptSubmit confirms it; the erase covers the text and the newline a swallowed Enter left behind.
  const retryUntilSubmitted = (record: SessionRecord, text: string, attempt: number) => {
    clearTimeout(record.promptRetryTimer);
    record.promptRetryTimer = setTimeout(() => {
      if (attempt >= PROMPT_ATTEMPTS) {
        deps.logger.warn("terminal prompt never confirmed", { projectId: record.projectId });
        return;
      }
      record.pty.write(eraseInput(`${text}\n`) + encodePrompt(text));
      retryUntilSubmitted(record, text, attempt + 1);
    }, deps.promptRetryMs ?? PROMPT_RETRY_MS);
    record.promptRetryTimer.unref();
  };

  const withProjectRecord = (projectId: string, act: (record: SessionRecord) => void): boolean => {
    const record = findRecordByProject(projectId);
    if (record === undefined) return false;
    act(record);
    return true;
  };

  return {
    async open(request) {
      await pendingCleanups.get(request.projectId);
      const record = await launchSession(deps, request);
      records.set(record.sessionId, record);
      watchLifecycle(record);
      await publishAll([{ type: "terminal.state", projectId: request.projectId, state: "starting" }]);
      return record;
    },
    find: (sessionId) => records.get(sessionId),
    findByProject: findRecordByProject,
    isHookAuthorized(sessionId, presentedToken) {
      const record = records.get(sessionId);
      return record !== undefined && deps.tokensMatch(record.hookToken, presentedToken);
    },
    isMcpCallAllowed(sessionId, presentedToken) {
      const record = records.get(sessionId);
      return record !== undefined && record.hasStarted && deps.tokensMatch(record.mcpToken, presentedToken);
    },
    async handleHook(sessionId, payload) {
      const record = records.get(sessionId);
      // The session can end between the route's token check and here; its tools still get an explicit answer.
      if (record === undefined) {
        return payload.hook_event_name === "PreToolUse" ? preToolUseAnswer({ isAllowed: false, reason: "This Claude session has ended." }) : {};
      }
      if (payload.hook_event_name === "PreToolUse") return answerPreToolUse(record, payload);
      if (payload.hook_event_name === "UserPromptSubmit") {
        clearTimeout(record.promptRetryTimer);
        record.isWorking = true;
      }
      if (payload.hook_event_name === "Stop") record.isWorking = false;
      if (payload.hook_event_name === "SessionStart") {
        clearTimeout(record.sessionStartTimer);
        // §6.3: another mode could skip the PreToolUse policy's prompts, so the session does not run.
        if (payload.permission_mode !== undefined && payload.permission_mode !== "default") {
          killRecord(record);
          return {};
        }
        record.hasStarted = true;
        for (const text of record.queuedPrompts.splice(0)) writePrompt(record, text);
      }
      await publishAll(hookToStudioEvents(payload, eventContext(record)));
      return {};
    },
    // Before SessionStart the folder-trust dialog may own the pane, and the prompt's Enter would pick its "No, exit" default.
    submitPrompt: (projectId, text) =>
      withProjectRecord(projectId, (record) => {
        if (record.hasStarted) writePrompt(record, text);
        else record.queuedPrompts.push(text);
      }),
    // Claude Code fires no Stop hook on a user interrupt, so the turn's end is reported here.
    stop: (projectId) =>
      withProjectRecord(projectId, (record) => {
        record.pty.interrupt();
        clearTimeout(record.promptRetryTimer);
        record.isWorking = false;
        record.promptToErase = record.lastPrompt;
        publishInBackground([{ type: "terminal.state", projectId, state: "ready" }]);
      }),
    kill: (projectId) => withProjectRecord(projectId, killRecord),
    killAll() {
      for (const record of records.values()) killRecord(record);
    },
  };
}

function preToolUseAnswer(decision: TerminalToolDecision): HookResponse {
  const reason = decision.isAllowed ? {} : { permissionDecisionReason: decision.reason };
  return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision.isAllowed ? "allow" : "deny", ...reason } };
}
