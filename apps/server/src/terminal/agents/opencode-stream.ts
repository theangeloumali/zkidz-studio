// Created by The Angelo Umali.
// OpenCode's server-sent events (GET /api/event) → StudioEvents; a read is allowed once when the studio's confinement allows it, all else is rejected.
import { z } from "zod";
import { toolLabel } from "../../agent/tool-names.ts";
import type { NewStudioEvent } from "../../events/event-bus.ts";
import { decideTerminalTool, type TerminalToolScope } from "../hook-policy.ts";
import type { AgentEventContext } from "./agent-adapter.ts";
import type { OpenCodeServer } from "./opencode-companion.ts";

const OPENCODE_CREDENTIAL = "your OpenCode sign-in";
const UNNAMED_MODEL_LABEL = "your default model";
const MAX_RECONNECT_DELAY_MS = 5_000;
const OPENCODE_STUDIO_PREFIX = "studio_";

const EnvelopeSchema = z.looseObject({ type: z.string(), data: z.looseObject({ sessionID: z.string().optional() }) });
const ToolStartedSchema = z.looseObject({ id: z.string().min(1), name: z.string().min(1) });
const ToolCalledSchema = z.looseObject({ id: z.string().min(1), input: z.unknown() });
const ToolSuccessSchema = z.looseObject({
  id: z.string().min(1),
  content: z.array(z.looseObject({ type: z.string(), text: z.string().optional() })).default([]),
});
const ToolFailedSchema = z.looseObject({ id: z.string().min(1), error: z.looseObject({ type: z.string(), message: z.string().min(1) }) });
const InboxSchema = z.looseObject({ item: z.looseObject({ type: z.literal("user"), payload: z.looseObject({ text: z.string() }) }) });
const TextEndedSchema = z.looseObject({ text: z.string() });
const UsageSchema = z.looseObject({
  cost: z.number().nonnegative(),
  tokens: z.looseObject({ input: z.int(), output: z.int(), reasoning: z.int().default(0), cache: z.looseObject({ read: z.int(), write: z.int() }) }),
});
const PermissionSchema = z.looseObject({ id: z.string().min(1), action: z.string().min(1), resources: z.array(z.string()).default([]) });
const READ_ACTION = "read";

export interface OpenCodeConnection extends OpenCodeServer {
  readonly sessionId: string;
  readonly reconnectDelayMs: number;
  /** The same confinement Claude's Read goes through (hook-policy). */
  readonly scope: TerminalToolScope;
}

type PermissionRequest = z.infer<typeof PermissionSchema>;

type Publish = (events: readonly NewStudioEvent[]) => void;
type Envelope = z.infer<typeof EnvelopeSchema>;

/** Reads the stream until stopped, reconnecting with backoff; returns the unsubscribe. */
export function subscribeOpenCodeEvents(connection: OpenCodeConnection, context: AgentEventContext, publish: Publish): () => void {
  const controller = new AbortController();
  const mapper = createEventMapper(connection, context, publish);
  const handle = (envelope: Envelope) => {
    const events = mapper.map(envelope);
    if (events.length > 0) publish(events);
  };
  void readWithReconnect(connection, controller.signal, handle);
  return () => controller.abort();
}

async function readWithReconnect(connection: OpenCodeConnection, signal: AbortSignal, handle: (envelope: Envelope) => void): Promise<void> {
  let delayMs = connection.reconnectDelayMs;
  while (!signal.aborted) {
    // A dropped stream, a refused connection and a 5xx all mean the same thing here: wait and try again.
    const isConnected = await readStream(connection, signal, handle).catch(() => false);
    delayMs = isConnected ? connection.reconnectDelayMs : Math.min(delayMs * 2, MAX_RECONNECT_DELAY_MS);
    await sleep(delayMs, signal);
  }
}

async function readStream(connection: OpenCodeConnection, signal: AbortSignal, handle: (envelope: Envelope) => void): Promise<boolean> {
  const response = await connection.fetch(`${connection.serverUrl}/api/event`, {
    headers: { authorization: connection.authorization, accept: "text/event-stream" },
    signal,
  });
  if (!response.ok || response.body === null) return false;
  const decoder = new TextDecoder();
  let buffered = "";
  const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader();
  for (let chunk = await reader.read(); chunk.done !== true; chunk = await reader.read()) {
    buffered += decoder.decode(chunk.value, { stream: true });
    const frames = buffered.split("\n\n");
    buffered = frames.pop() ?? "";
    frames.forEach((frame) => parseFrame(frame).forEach(handle));
  }
  return true;
}

function parseFrame(frame: string): Envelope[] {
  const data = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())
    .join("\n");
  if (data === "") return [];
  try {
    const parsed = EnvelopeSchema.safeParse(JSON.parse(data));
    return parsed.success ? [parsed.data] : [];
  } catch {
    return [];
  }
}

function createEventMapper(connection: OpenCodeConnection, context: AgentEventContext, publish: Publish) {
  const { projectId } = context;
  const toolNames = new Map<string, string>();
  let hasStarted = false;
  const handlers: Record<string, (data: unknown) => NewStudioEvent[]> = {
    "server.connected": () => {
      // Fires on every reconnect; the session started only once.
      if (hasStarted) return [];
      hasStarted = true;
      const model = context.model ?? UNNAMED_MODEL_LABEL;
      return [
        { type: "session.started", projectId, sessionId: connection.sessionId, model, credential: OPENCODE_CREDENTIAL, skills: [] },
        { type: "terminal.state", projectId, state: "ready" },
      ];
    },
    "session.inbox.enqueued": (data) => parsedOr(InboxSchema, data, (inbox) => [{ type: "prompt.submitted", projectId, text: inbox.item.payload.text }]),
    "session.execution.started": () => [{ type: "terminal.state", projectId, state: "working" }],
    "session.execution.succeeded": () => [{ type: "terminal.state", projectId, state: "ready" }],
    "session.execution.failed": () => [{ type: "terminal.state", projectId, state: "ready" }],
    "session.execution.interrupted": () => [{ type: "terminal.state", projectId, state: "ready" }],
    "session.tool.input.started": (data) =>
      parsedOr(ToolStartedSchema, data, (tool) => {
        toolNames.set(tool.id, studioToolName(tool.name));
        return [];
      }),
    "session.tool.called": (data) =>
      parsedOr(ToolCalledSchema, data, (tool) => {
        const name = toolNames.get(tool.id) ?? "tool";
        return [{ type: "tool.called", projectId, toolUseId: tool.id, name, label: toolLabel(name), input: tool.input }];
      }),
    "session.tool.success": (data) =>
      parsedOr(ToolSuccessSchema, data, (tool) => {
        const text = tool.content.flatMap((part) => (part.text === undefined ? [] : [part.text])).join("\n");
        const summary = text === "" ? `${toolLabel(toolNames.get(tool.id) ?? "tool")} finished` : text;
        return [{ type: "tool.finished", projectId, toolUseId: tool.id, ok: true, summary }];
      }),
    "session.tool.failed": (data) =>
      parsedOr(ToolFailedSchema, data, (tool) => {
        const finished: NewStudioEvent = { type: "tool.finished", projectId, toolUseId: tool.id, ok: false, summary: tool.error.message };
        if (!tool.error.type.startsWith("permission")) return [finished];
        return [finished, { type: "tool.denied", projectId, name: toolNames.get(tool.id) ?? "tool", reason: tool.error.message }];
      }),
    "session.text.ended": (data) => parsedOr(TextEndedSchema, data, (text) => [{ type: "narration", projectId, text: text.text }]),
    "session.usage.updated": (data) =>
      parsedOr(UsageSchema, data, ({ cost, tokens }) => [
        // OpenCode sends running totals; reasoning tokens are billed as output.
        {
          type: "usage.reported",
          projectId,
          sessionId: connection.sessionId,
          source: "opencode",
          costUsd: cost,
          inputTokens: tokens.input,
          outputTokens: tokens.output + tokens.reasoning,
          cacheTokens: tokens.cache.read + tokens.cache.write,
        },
      ]),
    "permission.asked": (data) =>
      parsedOr(PermissionSchema, data, (permission) => {
        if (permission.action === READ_ACTION && permission.resources.length > 0) {
          void answerRead(connection, permission, (reason) => publish([{ type: "tool.denied", projectId, name: READ_ACTION, reason }]));
          return [];
        }
        void replyPermission(connection, permission.id, "reject");
        return [{ type: "tool.denied", projectId, name: permission.action, reason: `${permission.action} is not available in ZKidz Studio.` }];
      }),
  };
  return {
    map(envelope: Envelope): NewStudioEvent[] {
      const handler = handlers[envelope.type];
      if (handler === undefined) return [];
      const isOtherSession = envelope.type !== "server.connected" && envelope.data.sessionID !== connection.sessionId;
      return isOtherSession ? [] : handler(envelope.data);
    },
  };
}

/** Every path must pass; one escape (a symlink out of the project, say) rejects the whole request. */
async function answerRead(connection: OpenCodeConnection, permission: PermissionRequest, deny: (reason: string) => void): Promise<void> {
  const decisions = await Promise.all(permission.resources.map((path) => decideTerminalTool("Read", { file_path: path }, connection.scope)));
  const refusal = decisions.find((decision) => !decision.isAllowed);
  // "once", never "always": a saved answer would skip this check for later reads.
  await replyPermission(connection, permission.id, refusal === undefined ? "once" : "reject");
  if (refusal !== undefined && !refusal.isAllowed) deny(refusal.reason);
}

async function replyPermission(connection: OpenCodeConnection, requestId: string, decision: "once" | "reject"): Promise<void> {
  const url = `${connection.serverUrl}/api/session/${encodeURIComponent(connection.sessionId)}/permission/${encodeURIComponent(requestId)}/reply`;
  // An unanswered request waits, which still runs nothing.
  await connection
    .fetch(url, {
      method: "POST",
      headers: { authorization: connection.authorization, "content-type": "application/json" },
      body: JSON.stringify({ decision }),
    })
    .catch(() => undefined);
}

function parsedOr<T>(schema: z.ZodType<T>, data: unknown, map: (value: T) => NewStudioEvent[]): NewStudioEvent[] {
  const parsed = schema.safeParse(data);
  return parsed.success ? map(parsed.data) : [];
}

/** OpenCode names MCP tools "<server>_<tool>"; the studio's own policy and labels use Claude's mcp__studio__ form. */
function studioToolName(name: string): string {
  return name.startsWith(OPENCODE_STUDIO_PREFIX) ? `mcp__studio__${name.slice(OPENCODE_STUDIO_PREFIX.length)}` : name;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
