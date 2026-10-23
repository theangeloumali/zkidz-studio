// Created by The Angelo Umali.
// Replays tests/fixtures/agent/*.ndjson through the SDK query() shape, so session tests run without Claude.
import { readFileSync } from "node:fs";
import { AbortError, type Options, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

export const AGENT_TRANSCRIPT_NAMES = ["init-text-result", "studio-tools", "permission-gate", "auth-failed", "rate-limit", "init-foreign-mcp"] as const;
export type AgentTranscriptName = (typeof AGENT_TRANSCRIPT_NAMES)[number];

const AGENT_FIXTURE_DIR = new URL("../../../../tests/fixtures/agent/", import.meta.url);

/** The CLI's can_use_tool control request; the replay answers it through options.canUseTool. */
interface PermissionRequestLine {
  readonly type: "control_request";
  readonly request_id: string;
  readonly request: {
    readonly subtype: "can_use_tool";
    readonly tool_name: string;
    readonly input: Record<string, unknown>;
    readonly tool_use_id: string;
    readonly mcp_server?: { readonly name: string; readonly source: string };
  };
}

/** Harness-only: the lines after it play only when the last decision matches `on` ("any" ends the branch). */
interface BranchLine {
  readonly type: "harness_branch";
  readonly on: "allow" | "deny" | "any";
}

export type TranscriptLine = SDKMessage | PermissionRequestLine | BranchLine;

interface FakeQueryParams {
  readonly prompt: AsyncIterable<SDKUserMessage>;
  readonly options: Options;
}

interface FakeAgentCall {
  readonly options: Options;
  readonly prompts: SDKUserMessage[];
}

export interface FakeAgent {
  readonly query: (params: FakeQueryParams) => AsyncIterable<SDKMessage>;
  readonly calls: readonly FakeAgentCall[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Every SDK message carries session_id; the fixture test checks the per-type fields.
function isTranscriptLine(value: unknown): value is TranscriptLine {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "harness_branch") return value.on === "allow" || value.on === "deny" || value.on === "any";
  if (value.type === "control_request") return isRecord(value.request) && value.request.subtype === "can_use_tool" && isRecord(value.request.input);
  return typeof value.session_id === "string";
}

function parseTranscriptLine(rawLine: string, lineNumber: number): TranscriptLine {
  const parsed: unknown = JSON.parse(rawLine);
  if (!isTranscriptLine(parsed)) throw new Error(`transcript line ${lineNumber} is not an SDK message or harness line`);
  return parsed;
}

export function readTranscript(name: AgentTranscriptName): TranscriptLine[] {
  return readFileSync(new URL(`${name}.ndjson`, AGENT_FIXTURE_DIR), "utf8")
    .split("\n")
    .filter((rawLine) => rawLine.trim() !== "")
    .map((rawLine, index) => parseTranscriptLine(rawLine, index + 1));
}

async function askPermission(line: PermissionRequestLine, options: Options, signal: AbortSignal): Promise<"allow" | "deny"> {
  const { tool_name: toolName, input, tool_use_id: toolUseID, mcp_server: mcpServer } = line.request;
  if (options.canUseTool === undefined) throw new Error(`the transcript asks canUseTool about ${toolName}, but the options carry none`);
  const decision = await options.canUseTool(toolName, input, {
    signal,
    toolUseID,
    requestId: line.request_id,
    ...(mcpServer === undefined ? {} : { mcpServer }),
  });
  // A null answer leaves the call unapproved, so the replay fails closed.
  return decision?.behavior === "allow" ? "allow" : "deny";
}

async function* replay(lines: readonly TranscriptLine[], params: FakeQueryParams, call: FakeAgentCall): AsyncGenerator<SDKMessage, void> {
  // With streaming input the SDK starts the session only once the first user message arrives.
  const firstPrompt = await params.prompt[Symbol.asyncIterator]().next();
  if (firstPrompt.done !== true) call.prompts.push(firstPrompt.value);
  const signal = params.options.abortController?.signal ?? new AbortController().signal;
  let decision: "allow" | "deny" | undefined;
  let branch: BranchLine["on"] = "any";
  for (const line of lines) {
    if (signal.aborted) throw new AbortError("Claude Code process aborted by user");
    if (line.type === "harness_branch") {
      branch = line.on;
    } else if (branch === "any" || branch === decision) {
      if (line.type === "control_request") decision = await askPermission(line, params.options, signal);
      else yield line;
    }
  }
}

/** Each query() call replays the next transcript, from its init to its result. */
export function createFakeAgent(...transcripts: AgentTranscriptName[]): FakeAgent {
  const calls: FakeAgentCall[] = [];
  const query = (params: FakeQueryParams): AsyncIterable<SDKMessage> => {
    const transcriptName = transcripts[calls.length];
    if (transcriptName === undefined) throw new Error(`FakeAgent has no transcript left for call ${calls.length + 1}`);
    const call: FakeAgentCall = { options: params.options, prompts: [] };
    calls.push(call);
    return replay(readTranscript(transcriptName), params, call);
  };
  return { query, calls };
}
