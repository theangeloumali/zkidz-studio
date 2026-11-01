// Created by The Angelo Umali.
// Asks the user's own codex binary, with the TUI's exact argv, cwd and env, what a session would load, before the TUI starts.
import { execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { z } from "zod";
import { CodexConfigSchema, CodexHookSchema, PromptInputSchema, type CodexSetup } from "./codex-lockdown.ts";

const runFile = promisify(execFile);
const PROBE_TIMEOUT_MS = 30_000;
const PROMPT_INPUT_MAX_BYTES = 32 * 1024 * 1024;
const HOOKS_LIST_ID = 2;
const CONFIG_READ_ID = 3;

export interface CodexProbe {
  readonly binaryPath: string;
  readonly launchArgs: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
}

const ReplySchema = z.looseObject({
  id: z.union([z.literal(HOOKS_LIST_ID), z.literal(CONFIG_READ_ID)]),
  result: z.unknown().optional(),
  error: z.looseObject({ message: z.string() }).optional(),
});
type Reply = z.infer<typeof ReplySchema>;
const HooksListSchema = z.looseObject({ data: z.array(z.looseObject({ hooks: z.array(CodexHookSchema) })) });

/** What the model would be shown (tools and codex's permissions message); prompt-input starts no session and runs no hook. */
export async function readCodexPrompt(probe: CodexProbe): Promise<z.infer<typeof PromptInputSchema>> {
  const { stdout } = await runFile(probe.binaryPath, [...probe.launchArgs, "debug", "prompt-input"], {
    env: probe.env,
    cwd: probe.cwd,
    timeout: PROBE_TIMEOUT_MS,
    maxBuffer: PROMPT_INPUT_MAX_BYTES,
    shell: false,
  });
  return PromptInputSchema.parse(JSON.parse(stdout));
}

/** The hooks (hooks/list) and effective config with project layers (config/read) for the project; neither starts an MCP server. */
export async function readCodexSetup(probe: CodexProbe): Promise<CodexSetup> {
  const child = spawn(probe.binaryPath, [...probe.launchArgs, "app-server"], {
    cwd: probe.cwd,
    env: probe.env,
    stdio: ["pipe", "pipe", "ignore"],
    shell: false,
  });
  let timer: NodeJS.Timeout | undefined;
  const results = new Map<number, unknown>();
  const answered = new Promise<CodexSetup>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error("codex app-server did not answer in time")), PROBE_TIMEOUT_MS);
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`codex app-server exited (${String(code)}) before answering`)));
    child.stdin.once("error", reject);
    createInterface({ input: child.stdout }).on("line", (line) => {
      const reply = parseReply(line);
      if (reply === null) return;
      if (reply.error !== undefined || reply.result === undefined) {
        reject(new Error(`codex app-server request ${String(reply.id)} failed: ${reply.error?.message ?? "no result"}`));
        return;
      }
      results.set(reply.id, reply.result);
      if (results.has(HOOKS_LIST_ID) && results.has(CONFIG_READ_ID)) {
        try {
          resolve(toSetup(results.get(HOOKS_LIST_ID), results.get(CONFIG_READ_ID)));
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      }
    });
    const send = (message: object) => child.stdin.write(`${JSON.stringify(message)}\n`);
    send({ id: 1, method: "initialize", params: { clientInfo: { name: "zkidz-studio", title: null, version: "1" }, capabilities: null } });
    send({ method: "initialized" });
    send({ id: HOOKS_LIST_ID, method: "hooks/list", params: { cwds: [probe.cwd] } });
    send({ id: CONFIG_READ_ID, method: "config/read", params: { cwd: probe.cwd, includeLayers: false } });
  });
  return answered.finally(() => {
    clearTimeout(timer);
    child.kill();
  });
}

/** null for any message other than the two answers the probe waits for. */
function parseReply(line: string): Reply | null {
  try {
    const parsed = ReplySchema.safeParse(JSON.parse(line));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function toSetup(hooksResult: unknown, configResult: unknown): CodexSetup {
  const { config, origins } = CodexConfigSchema.parse(configResult);
  const hooks = HooksListSchema.parse(hooksResult).data.flatMap((entry) => entry.hooks);
  return { hooks, mcpServers: config.mcp_servers, origins };
}
