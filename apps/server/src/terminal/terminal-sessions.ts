// Created by The Angelo Umali.
// Mode T session registry (plan §6.3): hooks → policy + events, Esc to stop, Kill to close.
import { stripVTControlCharacters } from "node:util";
import { AskUserQuestionInputSchema, toAskedQuestions, type HookPayload, type HookResponse, type UsageFigures } from "@zks/shared";
import type { NewStudioEvent } from "../events/event-bus.ts";
import { hookToStudioEvents, QUESTION_TOOL_NAME } from "./hook-events.ts";
import { decideTerminalTool, type TerminalToolDecision } from "./hook-policy.ts";
import { encodePrompt, eraseInput } from "./prompt-input.ts";
import { QUESTION_HOOK_TIMEOUT_S, removeSessionFiles } from "./session-files.ts";
import type { AgentRuntime } from "./agent-launch.ts";
import { launchSession, type OpenTerminalRequest, type SessionRecord, type TerminalSession, type TerminalSessionsDeps } from "./session-launch.ts";
import { defaultTranscriptRoot, isSessionTranscript, isUnderTranscriptRoot, readTranscriptUsage } from "./transcript-usage.ts";

export type { TerminalSession, TerminalSessionsDeps } from "./session-launch.ts";

/** Spike 07: SessionStart lands about 3 s after spawn; past this the user is likely signing in. */
const SESSION_START_TIMEOUT_MS = 30_000;
/** A resumed Claude Code drops input for its first seconds, after SessionStart has fired (measured on 2.1.311). */
const PROMPT_RETRY_MS = 3000;
const PROMPT_ATTEMPTS = 4;
/** The card gives up a minute before Claude Code's hook timeout, so the terminal dialog takes over instead of a block. */
const QUESTION_DEADLINE_MS = (QUESTION_HOOK_TIMEOUT_S - 60) * 1000;
/** Claude Code 2.1.312 shows the text before a question while the question's hook is already held (live test). */
const QUESTION_TEXT_WAIT_MS = 3000;
const QUESTION_DISMISSED = "The question was dismissed.";
/** A message longer than this goes out in pieces, so one runaway reply cannot grow a buffer without bound. */
const MAX_NARRATION_CHARS = 100_000;
const ALLOW: TerminalToolDecision = { isAllowed: true };

export interface TerminalSessions {
  open(request: OpenTerminalRequest): Promise<TerminalSession>;
  find(sessionId: string): TerminalSession | undefined;
  findByProject(projectId: string): TerminalSession | undefined;
  isHookAuthorized(sessionId: string, presentedToken: string | undefined): boolean;
  /** The stdio twin refuses every call until SessionStart arrives (plan §6.3). */
  isMcpCallAllowed(sessionId: string, presentedToken: string | undefined): boolean;
  /** `signal` aborts when Claude Code drops the hook request, which dismisses a waiting question card. */
  handleHook(sessionId: string, payload: HookPayload, signal?: AbortSignal): Promise<HookResponse>;
  submitPrompt(projectId: string, text: string): boolean;
  stop(projectId: string): boolean;
  kill(projectId: string): boolean;
  /** Resolves once every killed session's exit work is done, so shutdown can close the database after it. */
  killAll(): Promise<void>;
}

type PreToolUsePayload = Extract<HookPayload, { hook_event_name: "PreToolUse" }>;
type MessageDisplayPayload = Extract<HookPayload, { hook_event_name: "MessageDisplay" }>;
type StatusLinePayload = Extract<HookPayload, { hook_event_name: "StatusLine" }>;
type StopPayload = Extract<HookPayload, { hook_event_name: "Stop" }>;
/** Modes that keep the PreToolUse policy's decisions in charge; auto falls back to default when the account can't use it. */
const ALLOWED_PERMISSION_MODES: ReadonlySet<string> = new Set(["auto", "default"]);
/** A child that ignores the kill must not hold shutdown forever. */
const KILL_SETTLE_TIMEOUT_MS = 5_000;
/** A TUI may drop keys while it first draws its input. */
const INPUT_SETTLE_MS = 2_000;

export function createTerminalSessions(deps: TerminalSessionsDeps): TerminalSessions {
  const records = new Map<string, SessionRecord>();
  const findRecordByProject = (projectId: string) => [...records.values()].find((record) => record.projectId === projectId);
  // Each launch writes its own files folder; a reopen still waits for the last run's cleanup, so its exit events go out first.
  const pendingCleanups = new Map<string, Promise<void>>();
  // Per session: settles once its exit has cancelled jobs, removed files and published its events.
  const exitWork = new Map<string, Promise<void>>();

  const publishAll = async (newEvents: readonly NewStudioEvent[]) => {
    for (const newEvent of newEvents) await deps.eventBus.publish(newEvent);
  };
  const publishInBackground = (newEvents: readonly NewStudioEvent[]) => {
    publishAll(newEvents).catch((error: unknown) => deps.logger.error("terminal event publish failed", { error }));
  };

  const dismissQuestions = (record: SessionRecord) => {
    for (const card of record.questionCards) card.abort();
  };

  const watchLifecycle = (record: SessionRecord) => {
    const { projectId } = record;
    record.sessionStartTimer = setTimeout(() => {
      if (!record.hasStarted) publishInBackground([{ type: "terminal.state", projectId, state: "waiting" }]);
    }, deps.sessionStartTimeoutMs ?? SESSION_START_TIMEOUT_MS);
    record.sessionStartTimer.unref();

    let settleExit: () => void = () => undefined;
    exitWork.set(record.sessionId, new Promise((resolve) => (settleExit = resolve)));
    record.pty.onExit((exitCode) => {
      clearTimeout(record.sessionStartTimer);
      clearTimeout(record.promptRetryTimer);
      dismissQuestions(record);
      record.agent?.unsubscribe?.();
      record.agent?.companion?.kill();
      records.delete(record.sessionId);
      const isUnexpected = !record.wasKilled && exitCode !== 0;
      const exitEvents: NewStudioEvent[] = [{ type: "terminal.state", projectId, state: "exited", exitCode }];
      if (isUnexpected) {
        exitEvents.push({ type: "session.error", projectId, kind: "terminal_exited", message: `Claude Code exited with code ${exitCode}.`, action: "Restart" });
      }
      const cancelJobs =
        record.wasKilled || isUnexpected
          ? deps.cancelProjectJobs(projectId).catch((error: unknown) => deps.logger.error("terminal job cancel failed", { projectId, error }))
          : Promise.resolve();
      const cleanup = removeSessionFiles(record.files)
        .catch((error: unknown) => deps.logger.warn("terminal session files not removed", { error }))
        .finally(() => {
          if (pendingCleanups.get(projectId) === cleanup) pendingCleanups.delete(projectId);
          return publishAll(exitEvents).catch((error: unknown) => deps.logger.error("terminal event publish failed", { error }));
        });
      pendingCleanups.set(projectId, cleanup);
      void Promise.all([cancelJobs, cleanup]).then(() => {
        exitWork.delete(record.sessionId);
        settleExit();
      });
    });
  };

  const killRecord = (record: SessionRecord) => {
    record.wasKilled = true;
    dismissQuestions(record);
    record.pty.kill();
  };

  const eventContext = (record: SessionRecord) => ({
    projectId: record.projectId,
    model: record.model,
  });

  const publishNarration = async (record: SessionRecord, text: string) => {
    const trimmed = text.trim();
    if (trimmed === "") return;
    record.hasNarratedTurn = true;
    record.hasTextSinceTool = true;
    await publishAll([{ type: "narration", projectId: record.projectId, text: trimmed }]);
    for (const wake of record.textWaiters.splice(0)) wake();
  };

  // One narration per assistant message, published on its final batch; Claude Code holds the batch until this answers.
  const handleMessageDisplay = async (record: SessionRecord, payload: MessageDisplayPayload) => {
    const messageKey = payload.message_id ?? payload.turn_id ?? "";
    let text = record.displayBuffers.get(messageKey) ?? "";
    if (text.length + payload.delta.length > MAX_NARRATION_CHARS) {
      await publishNarration(record, text);
      text = "";
    }
    text += payload.delta;
    while (text.length > MAX_NARRATION_CHARS) {
      await publishNarration(record, text.slice(0, MAX_NARRATION_CHARS));
      text = text.slice(MAX_NARRATION_CHARS);
    }
    if (payload.final !== true) {
      record.displayBuffers.set(messageKey, text);
      return;
    }
    record.displayBuffers.delete(messageKey);
    await publishNarration(record, text);
  };

  const flushDisplays = async (record: SessionRecord) => {
    const pending = [...record.displayBuffers.values()];
    record.displayBuffers.clear();
    for (const text of pending) await publishNarration(record, text);
  };

  // The card follows Claude's text about it: at once when that text is out, else when it lands or the wait ends.
  const questionTextShown = async (record: SessionRecord) => {
    if (record.hasTextSinceTool && record.displayBuffers.size === 0) return;
    let timer: NodeJS.Timeout | undefined;
    await new Promise<void>((resolve) => {
      record.textWaiters.push(resolve);
      timer = setTimeout(resolve, deps.questionTextWaitMs ?? QUESTION_TEXT_WAIT_MS);
    });
    clearTimeout(timer);
  };

  const publishUsage = (record: SessionRecord, source: "claude_statusline" | "claude_transcript", figures: UsageFigures) =>
    publishAll([{ type: "usage.reported", projectId: record.projectId, sessionId: record.sessionId, source, ...figures }]);

  // Cost and time are session totals that refresh on every assistant message; an unchanged refresh says nothing new.
  const handleStatusLine = async (record: SessionRecord, payload: StatusLinePayload) => {
    const costUsd = payload.cost?.total_cost_usd;
    const durationMs = payload.cost?.total_duration_ms;
    const figures: UsageFigures = {
      ...(costUsd === undefined ? {} : { costUsd }),
      ...(durationMs === undefined ? {} : { durationMs: Math.round(durationMs) }),
    };
    const fingerprint = JSON.stringify(figures);
    if (fingerprint === "{}" || fingerprint === record.lastStatusUsage) return;
    record.lastStatusUsage = fingerprint;
    await publishUsage(record, "claude_statusline", figures);
  };

  const reportTranscriptUsage = (record: SessionRecord, payload: StopPayload) => {
    const transcriptPath = payload.transcript_path;
    if (!isSessionTranscript(transcriptPath, record.sessionId)) return;
    isUnderTranscriptRoot(transcriptPath, deps.transcriptRoot ?? defaultTranscriptRoot())
      .then((isConfined) => (isConfined ? (deps.readTranscriptUsage ?? readTranscriptUsage)(transcriptPath) : null))
      .then((figures) => (figures === null ? undefined : publishUsage(record, "claude_transcript", figures)))
      .catch((error: unknown) => deps.logger.warn("terminal transcript usage not read", { error }));
  };

  const handleStop = async (record: SessionRecord, payload: StopPayload) => {
    record.isWorking = false;
    await flushDisplays(record);
    reportTranscriptUsage(record, payload);
    const hasNarrated = record.hasNarratedTurn;
    record.hasNarratedTurn = false;
    await publishAll(hookToStudioEvents(hasNarrated ? { ...payload, last_assistant_message: undefined } : payload, eventContext(record)));
  };

  // Holds the hook while the card waits in Activity; answering there skips Claude Code's own dialog (docs: hooks).
  const answerQuestion = async (record: SessionRecord, payload: PreToolUsePayload, requestSignal: AbortSignal | undefined): Promise<HookResponse> => {
    const parsed = AskUserQuestionInputSchema.safeParse(payload.tool_input);
    if (!parsed.success) return preToolUseAnswer(ALLOW);
    const card = new AbortController();
    let hasTimedOut = false;
    const deadline = setTimeout(() => {
      hasTimedOut = true;
      card.abort();
    }, deps.questionTimeoutMs ?? QUESTION_DEADLINE_MS);
    const dismissOnDrop = () => card.abort();
    requestSignal?.addEventListener("abort", dismissOnDrop, { once: true });
    record.questionCards.add(card);
    try {
      await questionTextShown(record);
      record.hasTextSinceTool = false;
      const answers = await deps.askQuestions(record.projectId, toAskedQuestions(parsed.data), card.signal);
      if (answers !== null) return preToolUseAnswer(ALLOW, { ...parsed.data, answers });
      return preToolUseAnswer(hasTimedOut ? ALLOW : { isAllowed: false, reason: QUESTION_DISMISSED });
    } catch (error) {
      // A card that cannot go out leaves the question to the terminal dialog rather than failing the tool.
      deps.logger.error("terminal question card failed", { error });
      return preToolUseAnswer(ALLOW);
    } finally {
      clearTimeout(deadline);
      requestSignal?.removeEventListener("abort", dismissOnDrop);
      record.questionCards.delete(card);
    }
  };

  // Always an explicit answer: Claude Code blocks the tool only when the bridge is unreachable (spike 07), not on a 500.
  const answerPreToolUse = async (record: SessionRecord, payload: PreToolUsePayload, signal: AbortSignal | undefined): Promise<HookResponse> => {
    const scope = { projectDir: record.projectDir, pluginDir: deps.pluginDir, studioToolNames: deps.studioToolNames };
    const decision = await decideTerminalTool(payload.tool_name, payload.tool_input, scope).catch((error: unknown): TerminalToolDecision => {
      deps.logger.error("terminal tool policy failed", { error });
      return { isAllowed: false, reason: "ZKidz Studio could not check this tool, so it is blocked." };
    });
    if (decision.isAllowed && payload.tool_name === QUESTION_TOOL_NAME) return answerQuestion(record, payload, signal);
    record.hasTextSinceTool = false;
    try {
      await publishAll(hookToStudioEvents(payload, { ...eventContext(record), decision }));
    } catch (error) {
      deps.logger.error("terminal tool event not published", { error });
    }
    return preToolUseAnswer(decision);
  };

  const reportAgentUsage = (record: SessionRecord, agent: AgentRuntime) => {
    const { usageSource, kind } = agent.adapter;
    if (usageSource === undefined || agent.agentSessionId === undefined || kind === "claude") return;
    usageSource(agent.agentSessionId)
      .then((figures) =>
        figures === null
          ? undefined
          : publishAll([{ type: "usage.reported", projectId: record.projectId, sessionId: record.sessionId, source: kind, ...figures }]),
      )
      .catch((error: unknown) => deps.logger.warn("terminal agent usage not read", { error }));
  };

  // Codex posts Claude-shaped hooks to the same bridge; its adapter maps them and the studio's policy decides its tools.
  const handleAgentHook = async (record: SessionRecord, agent: AgentRuntime, payload: HookPayload): Promise<HookResponse> => {
    const { events } = agent.adapter;
    if (events.kind !== "hooks")
      return payload.hook_event_name === "PreToolUse" ? preToolUseAnswer({ isAllowed: false, reason: "This agent sends no hooks." }) : {};
    const context = eventContext(record);
    switch (payload.hook_event_name) {
      case "PreToolUse": {
        const scope = { projectDir: record.projectDir, pluginDir: deps.pluginDir, studioToolNames: deps.studioToolNames };
        const decision = await (
          agent.adapter.decideTool?.(payload.tool_name, payload.tool_input, scope) ?? decideTerminalTool(payload.tool_name, payload.tool_input, scope)
        ).catch((error: unknown): TerminalToolDecision => {
          deps.logger.error("terminal agent policy failed", { error });
          return { isAllowed: false, reason: "ZKidz Studio could not check this tool, so it is blocked." };
        });
        await publishAll(events.mapHook(payload, { ...context, decision })).catch((error: unknown) =>
          deps.logger.error("terminal tool event not published", { error }),
        );
        return preToolUseAnswer(decision);
      }
      case "SessionStart":
        agent.agentSessionId = payload.session_id;
        markStarted(record);
        break;
      case "UserPromptSubmit":
        clearTimeout(record.promptRetryTimer);
        record.isWorking = true;
        break;
      case "Stop":
        record.isWorking = false;
        reportAgentUsage(record, agent);
        break;
      default:
        break;
    }
    await publishAll(events.mapHook(payload, context));
    return {};
  };

  const markStarted = (record: SessionRecord) => {
    clearTimeout(record.sessionStartTimer);
    if (record.hasStarted) return;
    record.hasStarted = true;
    for (const text of record.queuedPrompts.splice(0)) writePrompt(record, text);
  };

  const startWhenInputDrawn = (record: SessionRecord, inputReady: RegExp) => {
    const stopWatching = record.pty.onData(() => {
      if (!inputReady.test(stripVTControlCharacters(record.pty.snapshot()))) return;
      stopWatching();
      setTimeout(() => markStarted(record), deps.inputSettleMs ?? INPUT_SETTLE_MS).unref();
    });
  };

  // Erases a prompt a Stop put back in Claude Code's input first, so the paste is not appended to it.
  const writePrompt = (record: SessionRecord, text: string) => {
    const erase = record.promptToErase === undefined ? "" : eraseInput(record.promptToErase);
    record.promptToErase = undefined;
    record.lastPrompt = text;
    record.pty.write(erase + encodePrompt(text));
    // Only a UserPromptSubmit hook can confirm the prompt landed; a stream-driven agent sends none to stop the retries.
    const confirmsPrompts = record.agent === undefined || record.agent.adapter.events.kind === "hooks";
    if (!record.isWorking && confirmsPrompts) retryUntilSubmitted(record, text, 1);
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
      const { agent } = record;
      if (agent?.adapter.inputReady !== undefined) startWhenInputDrawn(record, agent.adapter.inputReady);
      if (agent?.adapter.events.kind === "stream") agent.unsubscribe = agent.adapter.events.subscribe(agent.launch, eventContext(record), publishInBackground);
      // The TUI only fails once its server is gone; the record says why and closes. A normal exit has removed it already.
      agent?.companion?.once("exit", (code) => {
        if (records.get(record.sessionId) !== record || record.wasKilled) return;
        const message = `The agent's server stopped (code ${code ?? "none"}).`;
        publishInBackground([{ type: "session.error", projectId: record.projectId, kind: "terminal_exited", message, action: "Restart" }]);
        killRecord(record);
      });
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
    async handleHook(sessionId, payload, signal) {
      const record = records.get(sessionId);
      // The session can end between the route's token check and here; its tools still get an explicit answer.
      if (record === undefined) {
        return payload.hook_event_name === "PreToolUse" ? preToolUseAnswer({ isAllowed: false, reason: "This Claude session has ended." }) : {};
      }
      if (record.agent !== undefined) return handleAgentHook(record, record.agent, payload);
      switch (payload.hook_event_name) {
        case "PreToolUse":
          return answerPreToolUse(record, payload, signal);
        case "MessageDisplay":
          await handleMessageDisplay(record, payload);
          return {};
        case "StatusLine":
          await handleStatusLine(record, payload);
          return {};
        case "Stop":
          await handleStop(record, payload);
          return {};
        case "UserPromptSubmit":
          clearTimeout(record.promptRetryTimer);
          record.isWorking = true;
          record.hasNarratedTurn = false;
          record.hasTextSinceTool = false;
          break;
        case "SessionStart":
          clearTimeout(record.sessionStartTimer);
          // §6.3: another mode could skip the PreToolUse policy's prompts, so the session does not run.
          if (payload.permission_mode !== undefined && !ALLOWED_PERMISSION_MODES.has(payload.permission_mode)) {
            killRecord(record);
            return {};
          }
          markStarted(record);
          break;
        default:
          break;
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
        dismissQuestions(record);
        record.isWorking = false;
        record.promptToErase = record.lastPrompt;
        publishInBackground([{ type: "terminal.state", projectId, state: "ready" }]);
      }),
    kill: (projectId) => withProjectRecord(projectId, killRecord),
    async killAll() {
      const exits = [...records.values()].map((record) => {
        killRecord(record);
        return exitWork.get(record.sessionId) ?? Promise.resolve();
      });
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, KILL_SETTLE_TIMEOUT_MS).unref());
      await Promise.race([Promise.all(exits), timeout]);
    },
  };
}

function preToolUseAnswer(decision: TerminalToolDecision, updatedInput?: Record<string, unknown>): HookResponse {
  const reason = decision.isAllowed ? {} : { permissionDecisionReason: decision.reason };
  const rewrite = updatedInput === undefined ? {} : { updatedInput };
  return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision.isAllowed ? "allow" : "deny", ...reason, ...rewrite } };
}
