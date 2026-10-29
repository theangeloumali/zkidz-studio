// Created by The Angelo Umali.
// Asks the user's own codex binary, with the studio's exact config, what a session would load, before the TUI starts.
import { execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { z } from "zod";
import { CodexHookSchema, exposedToolNames, type CodexHook } from "./codex-lockdown.ts";

const runFile = promisify(execFile);
const MCP_LIST_TIMEOUT_MS = 10_000;
const PROBE_TIMEOUT_MS = 30_000;
const PROMPT_INPUT_MAX_BYTES = 32 * 1024 * 1024;
const HOOKS_LIST_ID = 2;

export interface CodexProbe {
  readonly binaryPath: string;
  readonly configArgs: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
}

const McpListSchema = z.array(z.looseObject({ name: z.string().min(1) }));
const ReplyIdSchema = z.looseObject({ id: z.literal(HOOKS_LIST_ID) });
const HooksListReplySchema = z.looseObject({
  id: z.literal(HOOKS_LIST_ID),
  result: z.looseObject({ data: z.array(z.looseObject({ hooks: z.array(CodexHookSchema) })) }).optional(),
  error: z.looseObject({ message: z.string() }).optional(),
});

export async function listCodexMcpServers(binaryPath: string, env: Readonly<Record<string, string>>): Promise<readonly string[]> {
  const { stdout } = await runFile(binaryPath, ["mcp", "list", "--json"], { env, timeout: MCP_LIST_TIMEOUT_MS, shell: false });
  return McpListSchema.parse(JSON.parse(stdout)).map((server) => server.name);
}

/** The tools the model would be shown, as `codex debug prompt-input` renders them; it starts no session and runs no hook. */
export async function listCodexTools(probe: CodexProbe): Promise<readonly string[]> {
  const { stdout } = await runFile(probe.binaryPath, ["debug", "prompt-input", ...probe.configArgs], {
    env: probe.env,
    cwd: probe.cwd,
    timeout: PROBE_TIMEOUT_MS,
    maxBuffer: PROMPT_INPUT_MAX_BYTES,
    shell: false,
  });
  return exposedToolNames(JSON.parse(stdout));
}

/** Every hook codex would load for the project, with its trust state, from the app-server's `hooks/list`. */
export async function listCodexHooks(probe: CodexProbe): Promise<readonly CodexHook[]> {
  const child = spawn(probe.binaryPath, ["app-server", ...probe.configArgs], {
    cwd: probe.cwd,
    env: probe.env,
    stdio: ["pipe", "pipe", "ignore"],
    shell: false,
  });
  let timer: NodeJS.Timeout | undefined;
  const hooksListed = new Promise<readonly CodexHook[]>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error("codex app-server did not list its hooks in time")), PROBE_TIMEOUT_MS);
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`codex app-server exited (${String(code)}) before listing its hooks`)));
    child.stdin.once("error", reject);
    createInterface({ input: child.stdout }).on("line", (line) => {
      const reply = readHooksReply(line);
      if (reply instanceof Error) reject(reply);
      else if (reply !== null) resolve(reply);
    });
    const send = (message: object) => child.stdin.write(`${JSON.stringify(message)}\n`);
    send({ id: 1, method: "initialize", params: { clientInfo: { name: "zkidz-studio", title: null, version: "1" }, capabilities: null } });
    send({ method: "initialized" });
    send({ id: HOOKS_LIST_ID, method: "hooks/list", params: { cwds: [probe.cwd] } });
  });
  return hooksListed.finally(() => {
    clearTimeout(timer);
    child.kill();
  });
}

/** null for any other message; an Error when the hooks/list answer is a failure or has an unknown shape. */
function readHooksReply(line: string): readonly CodexHook[] | Error | null {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    return null;
  }
  if (!ReplyIdSchema.safeParse(message).success) return null;
  const parsed = HooksListReplySchema.safeParse(message);
  if (!parsed.success) return new Error(`codex hooks/list answered in an unknown shape: ${parsed.error.message}`);
  const { result, error } = parsed.data;
  if (error !== undefined || result === undefined) return new Error(`codex hooks/list failed: ${error?.message ?? "no result"}`);
  return result.data.flatMap((entry) => entry.hooks);
}
