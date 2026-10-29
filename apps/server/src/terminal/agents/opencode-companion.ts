// Created by The Angelo Umali.
// The `opencode serve` companion: find the address it bound, then refuse it unless the studio's config is the only one it loaded.
import { join } from "node:path";
import { LOOPBACK_HOST } from "@zks/shared";
import { z } from "zod";
import { AgentLaunchError } from "./agent-env.ts";

/** OpenCode applies the last matching rule; "*" deny first makes everything else opt-in, and reads are asked so the studio confines them. */
export const OPENCODE_PERMISSIONS = { "*": "deny", "studio_*": "allow", read: "ask", external_directory: "deny" } as const;
export const OPENCODE_CONFIG_FILE = "opencode.json";

const STUDIO_MCP_SERVER = "studio";
const LISTENING_LINE = new RegExp(`^server listening on (http://${LOOPBACK_HOST.replaceAll(".", "\\.")}:\\d{1,5})$`);
const STUDIO_RULES = Object.entries(OPENCODE_PERMISSIONS).map(([action, effect]) => ({ action, resource: "*", effect }));

const RuleSchema = z.looseObject({ action: z.string(), resource: z.string(), effect: z.string() });
const StudioInfoSchema = z.looseObject({
  mcp: z.looseObject({ servers: z.record(z.string(), z.unknown()).default({}) }).optional(),
  plugins: z.array(z.unknown()).default([]),
});
const ConfigSourcesSchema = z.array(z.looseObject({ type: z.string(), path: z.string().optional(), info: StudioInfoSchema.optional() }));
const AgentsSchema = z.looseObject({ data: z.array(z.looseObject({ id: z.string(), permissions: z.array(RuleSchema) })) });
const PluginsSchema = z.looseObject({ data: z.array(z.looseObject({ id: z.string(), source: z.looseObject({ type: z.string() }) })) });
const SavedApprovalsSchema = z.looseObject({ data: z.array(z.unknown()) });

type Rule = z.infer<typeof RuleSchema>;

export interface OpenCodeServer {
  readonly serverUrl: string;
  readonly authorization: string;
  readonly fetch: typeof fetch;
}

/** Reads the companion's stdout until it names its loopback address; keeps draining after, so the child never blocks on a full pipe. */
export async function readListeningUrl(output: AsyncIterable<Uint8Array | string>, signal: AbortSignal): Promise<string> {
  const iterator = output[Symbol.asyncIterator]();
  const decoder = new TextDecoder();
  let buffered = "";
  for (;;) {
    const next = await nextOrAbort(iterator, signal);
    if (next.done === true) throw new AgentLaunchError("companion_failed", "The OpenCode server stopped before it started listening.");
    buffered += typeof next.value === "string" ? next.value : decoder.decode(next.value, { stream: true });
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    const url = lines.map((line) => LISTENING_LINE.exec(line.trim())?.[1]).find((match) => match !== undefined);
    if (url !== undefined) {
      void drain(iterator);
      return url;
    }
  }
}

/** Throws config_conflict when the server loaded anything that could allow a tool, or answer a read, without the studio. */
export async function assertStudioLockdown(server: OpenCodeServer, filesDir: string, signal: AbortSignal): Promise<void> {
  const [sources, agents, plugins, saved] = await Promise.all([
    getJson(server, "/api/config", ConfigSourcesSchema, signal),
    getJson(server, "/api/agent", AgentsSchema, signal),
    getJson(server, "/api/plugin", PluginsSchema, signal),
    getJson(server, "/api/permission/saved", SavedApprovalsSchema, signal),
  ]);
  const studioFile = join(filesDir, OPENCODE_CONFIG_FILE);
  const isStudioSource = (source: (typeof sources)[number]) =>
    (source.type === "directory" && source.path === filesDir) || (source.type === "document" && source.path === studioFile);
  const foreignSource = sources.find((source) => !isStudioSource(source));
  if (foreignSource !== undefined) conflict(`OpenCode loaded settings ZKidz Studio did not write (${foreignSource.path ?? "from its environment"}).`);

  const studioInfo = sources.find((source) => source.path === studioFile)?.info;
  const hasForeignServer = Object.keys(studioInfo?.mcp?.servers ?? {}).some((name) => name !== STUDIO_MCP_SERVER);
  if (hasForeignServer || (studioInfo?.plugins.length ?? 0) > 0) conflict("The studio's OpenCode settings were changed after it wrote them.");

  const looseAgent = agents.data.find((agent) => !endsLockedDown(agent.permissions));
  if (looseAgent !== undefined) conflict(`The OpenCode agent "${looseAgent.id}" allows tools ZKidz Studio does not.`);
  const foreignPlugin = plugins.data.find((plugin) => plugin.source.type !== "builtin");
  if (foreignPlugin !== undefined) conflict(`The OpenCode plugin "${foreignPlugin.id}" is enabled; ZKidz Studio runs OpenCode with its built-in plugins only.`);
  if (saved.data.length > 0) conflict("OpenCode has saved permission answers, which would skip the studio's own check. Remove them in OpenCode and try again.");
}

/** True when the studio's rule block is present and nothing after its last copy allows anything. */
function endsLockedDown(rules: readonly Rule[]): boolean {
  const blockStarts = rules.flatMap((_rule, start) => (STUDIO_RULES.every((studio, offset) => isSameRule(rules[start + offset], studio)) ? [start] : []));
  const lastStart = blockStarts.at(-1);
  return lastStart !== undefined && rules.slice(lastStart + STUDIO_RULES.length).every((rule) => rule.effect !== "allow");
}

const isSameRule = (rule: Rule | undefined, studio: Rule) =>
  rule !== undefined && rule.action === studio.action && rule.resource === studio.resource && rule.effect === studio.effect;

function conflict(message: string): never {
  throw new AgentLaunchError("config_conflict", message);
}

async function getJson<T>(server: OpenCodeServer, path: string, schema: z.ZodType<T>, signal: AbortSignal): Promise<T> {
  const response = await server.fetch(`${server.serverUrl}${path}`, { headers: { authorization: server.authorization }, signal });
  const parsed = response.ok ? schema.safeParse(await response.json()) : undefined;
  // An answer the studio cannot read counts as no answer: it never launches on a config it could not check.
  if (parsed?.success !== true) throw new AgentLaunchError("companion_failed", `The OpenCode server did not answer ${path} as expected.`);
  return parsed.data;
}

async function nextOrAbort<T>(iterator: AsyncIterator<T>, signal: AbortSignal): Promise<IteratorResult<T>> {
  signal.throwIfAborted();
  let onAbort: () => void = () => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new AgentLaunchError("companion_failed", "The session ended before the OpenCode server started listening."));
  });
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    return await Promise.race([iterator.next(), aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

async function drain(iterator: AsyncIterator<unknown>): Promise<void> {
  try {
    while ((await iterator.next()).done !== true);
  } catch {
    // The companion's stdout closes with the session; nothing waits on it.
  }
}
