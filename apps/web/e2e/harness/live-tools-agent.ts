// Created by The Angelo Umali.
// FakeAgent scripts the turns; this runs every studio tool call for real, so jobs, files and deliverables are real.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { JobStatusSchema, MAX_JOB_WAIT_S } from "@zks/shared";
import { isJobActive } from "../../src/render/job-display.ts";
import type { QueryFunction } from "../../../server/src/agent/query-function.ts";
import { createFakeAgent, type AgentTranscriptName } from "../../../server/test/agent-harness/fake-agent.ts";

type QueryOptions = Parameters<QueryFunction>[0]["options"];
type AgentMessage = ReturnType<QueryFunction> extends AsyncIterable<infer Message> ? Message : never;
type JsonRecord = Record<string, unknown>;

const STUDIO_TOOL_PREFIX = "mcp__studio__";
const JOB_WAIT_TOOL = `${STUDIO_TOOL_PREFIX}job_wait`;
// The SDK's 60 s default rejects a job_wait still blocking toward its own limit, which a loaded machine's render reaches.
const TOOL_CALL_TIMEOUT_MS = (MAX_JOB_WAIT_S + 30) * 1000;
const connectedClients = new WeakMap<object, Promise<Client>>();

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Canned ids (asset, job) stand in for ones only the live run knows; this maps each to its live value. */
class PlaceholderMap {
  private readonly liveByCanned = new Map<string, string>();

  learn(canned: unknown, live: unknown): void {
    if (typeof canned === "string" && typeof live === "string" && canned !== live) this.liveByCanned.set(canned, live);
    if (Array.isArray(canned) && Array.isArray(live)) canned.forEach((item, index) => this.learn(item, live[index]));
    if (isRecord(canned) && isRecord(live)) for (const key of Object.keys(canned)) this.learn(canned[key], live[key]);
  }

  substitute(value: unknown): unknown {
    if (typeof value === "string") return this.liveByCanned.get(value) ?? value;
    if (Array.isArray(value)) return value.map((item) => this.substitute(item));
    if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.substitute(item)]));
    return value;
  }
}

function connectStudioClient(options: QueryOptions): Promise<Client> {
  const studioServer = options.mcpServers?.studio;
  if (studioServer === undefined || !("instance" in studioServer)) throw new Error("the session passed no in-process studio MCP server");
  const { instance } = studioServer;
  const existing = connectedClients.get(instance);
  if (existing !== undefined) return existing;
  const connecting = (async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await instance.connect(serverTransport);
    const client = new Client({ name: "zks-e2e", version: "0.0.0" });
    await client.connect(clientTransport);
    return client;
  })();
  connectedClients.set(instance, connecting);
  return connecting;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isStillRunning(jobWaitText: string): boolean {
  const reply = parseJson(jobWaitText);
  const status = JobStatusSchema.safeParse(isRecord(reply) ? reply.status : undefined);
  return status.success && isJobActive({ status: status.data });
}

async function callLiveTool(client: Client, qualifiedName: string, input: unknown) {
  const toolCall = { name: qualifiedName.slice(STUDIO_TOOL_PREFIX.length), arguments: isRecord(input) ? input : {} };
  const result = await client.callTool(toolCall, undefined, { timeout: TOOL_CALL_TIMEOUT_MS });
  const content = Array.isArray(result.content) ? result.content.filter(isRecord) : [];
  return { content, isError: result.isError === true, text: content.map((block) => (typeof block.text === "string" ? block.text : "")).join("") };
}

async function* liveReplay(messages: AsyncIterable<AgentMessage>, options: QueryOptions, placeholders: PlaceholderMap, approvedInputs: Map<string, unknown>) {
  const studioCalls = new Map<string, { readonly name: string; readonly input: unknown }>();
  for await (const message of messages) {
    const body: unknown = "message" in message ? message.message : undefined;
    if (!isRecord(body) || !Array.isArray(body.content)) {
      yield message;
      continue;
    }
    const content: unknown[] = [];
    let liveResult: Awaited<ReturnType<typeof callLiveTool>> | undefined;
    for (const block of body.content) {
      if (isRecord(block) && block.type === "tool_use" && typeof block.name === "string" && block.name.startsWith(STUDIO_TOOL_PREFIX)) {
        const liveInput = placeholders.substitute(block.input);
        studioCalls.set(String(block.id), { name: block.name, input: liveInput });
        content.push({ ...block, input: liveInput });
      } else if (isRecord(block) && block.type === "tool_result" && studioCalls.has(String(block.tool_use_id))) {
        const toolUseId = String(block.tool_use_id);
        const studioCall = studioCalls.get(toolUseId) ?? { name: "", input: {} };
        liveResult = await callLiveTool(await connectStudioClient(options), studioCall.name, approvedInputs.get(toolUseId) ?? studioCall.input);
        // A real agent waits again while the job runs; one canned 120 s wait overran on a loaded machine.
        while (studioCall.name === JOB_WAIT_TOOL && isStillRunning(liveResult.text)) {
          liveResult = await callLiveTool(await connectStudioClient(options), studioCall.name, studioCall.input);
        }
        const cannedText = Array.isArray(block.content) && isRecord(block.content[0]) ? String(block.content[0].text) : "";
        placeholders.learn(parseJson(cannedText), parseJson(liveResult.text));
        content.push({ ...block, content: liveResult.content, ...(liveResult.isError ? { is_error: true } : {}) });
      } else {
        content.push(block);
      }
    }
    const rewritten = { ...message, message: { ...body, content }, ...(liveResult === undefined ? {} : { tool_use_result: liveResult.content }) };
    // The rewrite keeps every SDK field and only swaps tool inputs and results, so the message keeps its type.
    yield rewritten as AgentMessage;
  }
}

/** A QueryFunction over FakeAgent whose studio tool calls hit the session's real MCP server. */
export function createLiveToolsQuery(...transcripts: AgentTranscriptName[]): QueryFunction {
  const fakeAgent = createFakeAgent(...transcripts);
  return ({ prompt, options }) => {
    const placeholders = new PlaceholderMap();
    const approvedInputs = new Map<string, unknown>();
    const askUser = options.canUseTool;
    const liveOptions: QueryOptions = {
      ...options,
      ...(askUser === undefined
        ? {}
        : {
            canUseTool: async (toolName, input, context) => {
              const liveInput = placeholders.substitute(input);
              const decision = await askUser(toolName, isRecord(liveInput) ? liveInput : input, context);
              if (decision?.behavior === "allow") approvedInputs.set(context.toolUseID, "updatedInput" in decision ? decision.updatedInput : liveInput);
              return decision;
            },
          }),
    };
    return liveReplay(fakeAgent.query({ prompt, options: liveOptions }), liveOptions, placeholders, approvedInputs);
  };
}
