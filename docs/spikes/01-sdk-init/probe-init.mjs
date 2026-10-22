// Created by The Angelo Umali.
// Runs one SDK session and returns its system/init message plus the result summary.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { fileURLToPath } from "node:url";

export const SPIKE_PLUGIN_DIR = fileURLToPath(new URL("./plugin", import.meta.url));

const OS_BASICS = ["PATH", "HOME", "TMPDIR", "LANG"];

// Mirrors the plan's allowlisted child env: nothing inherited beyond OS basics.
export function buildSpikeEnv(extra = {}) {
  const env = Object.fromEntries(OS_BASICS.flatMap((name) => (process.env[name] ? [[name, process.env[name]]] : [])));
  return {
    ...env,
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    ENABLE_CLAUDEAI_MCP_SERVERS: "false",
    ...extra,
  };
}

export async function runInitProbe({ prompt, cwd, tools, maxTurns = 1, envExtra = {}, skills = "all", timeoutMs = 60_000, hooks }) {
  const messages = [];
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), timeoutMs);
  const session = query({
    prompt,
    options: {
      cwd,
      env: buildSpikeEnv(envExtra),
      model: "haiku",
      maxTurns,
      settingSources: [],
      plugins: [{ type: "local", path: SPIKE_PLUGIN_DIR }],
      skills,
      tools,
      permissionMode: "default",
      strictMcpConfig: true,
      abortController,
      hooks,
      // Spike only: allow tool calls without a UI; deny anything unexpected.
      canUseTool: async (toolName, input) =>
        tools.includes(toolName) ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: `spike denies ${toolName}` },
    },
  });
  // The SDK throws on an error result; keep what arrived so init can still be asserted.
  let error;
  try {
    for await (const message of session) messages.push(message);
  } catch (caught) {
    error = abortController.signal.aborted ? `aborted after ${timeoutMs} ms` : String(caught.message ?? caught).split("\n")[0];
  } finally {
    clearTimeout(timer);
  }
  const init = messages.find((message) => message.type === "system" && message.subtype === "init");
  const result = messages.find((message) => message.type === "result");
  return { init, result, messages, error };
}
