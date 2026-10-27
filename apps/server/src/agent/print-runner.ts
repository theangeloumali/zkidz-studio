// Created by The Angelo Umali.
// The `claude -p` stream-json fallback (plan §6.7) behind the same QueryFunction, used when the SDK binary is absent.
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { createInterface } from "node:readline";
import type { SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { BASE_TOOLS, DISALLOWED_TOOLS } from "./init-assertion.ts";
import type { QueryFunction, QueryHandle } from "./query-function.ts";

export type SpawnClaude = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

// Approvals go through the stdio MCP twin's approve tool, since -p has no canUseTool callback.
const PERMISSION_PROMPT_TOOL = "mcp__studio__approve";

export interface PrintArgs {
  readonly mcpConfigPath: string;
  /** Holds the §6.10 PreToolUse hook, so Read confinement does not rest on --restricted alone. */
  readonly settingsPath: string;
  readonly pluginDir: string;
  readonly maxTurns: number;
  /** Mode A only, matching the SDK path's maxBudgetUsd. */
  readonly maxBudgetUsd?: number;
  readonly model?: string;
  readonly resume?: string;
  /** An owner-only file holding the rules block (plan §6.9), the same text the SDK path appends. */
  readonly rulesPath?: string;
}

/** Never --bare: it skips plugins and MCP discovery and grants Bash and file edits. */
export function buildPrintArgs(args: PrintArgs): string[] {
  return [
    ...["-p", "--restricted", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages"],
    ...["--strict-mcp-config", "--mcp-config", args.mcpConfigPath, "--plugin-dir", args.pluginDir],
    ...["--add-dir", args.pluginDir, "--settings", args.settingsPath],
    ...["--tools", BASE_TOOLS.join(","), "--disallowedTools", DISALLOWED_TOOLS.join(",")],
    ...["--permission-mode", "default", "--permission-prompt-tool", PERMISSION_PROMPT_TOOL, "--max-turns", String(args.maxTurns)],
    ...optionalFlag("--max-budget-usd", args.maxBudgetUsd),
    ...optionalFlag("--model", args.model),
    ...optionalFlag("--resume", args.resume),
    ...optionalFlag("--append-system-prompt-file", args.rulesPath),
  ];
}

export interface PrintQueryOptions {
  readonly claudePath: string;
  readonly mcpConfigPath: string;
  readonly settingsPath: string;
  readonly pluginDir: string;
  readonly rulesPath?: string;
  readonly spawn?: SpawnClaude;
}

export function createPrintQuery(config: PrintQueryOptions): QueryFunction {
  return ({ prompt, options }) => {
    if (options.maxTurns === undefined) throw new Error("The -p fallback needs maxTurns");
    const { maxBudgetUsd, model, resume } = options;
    const args = buildPrintArgs({
      mcpConfigPath: config.mcpConfigPath,
      settingsPath: config.settingsPath,
      pluginDir: config.pluginDir,
      maxTurns: options.maxTurns,
      maxBudgetUsd,
      model,
      resume,
      rulesPath: config.rulesPath,
    });
    const spawnClaude = config.spawn ?? nodeSpawn;
    const child = spawnClaude(config.claudePath, args, { cwd: options.cwd, env: options.env, stdio: ["pipe", "pipe", "ignore"] });
    const handle = new PrintProcess(child);
    options.abortController?.signal.addEventListener("abort", () => handle.close(), { once: true });
    void handle.pumpPrompts(prompt);
    return handle;
  };
}

interface ExitStatus {
  readonly code?: number | null;
  readonly error?: Error;
}

class PrintProcess implements QueryHandle {
  readonly #child: ChildProcess;
  readonly #exit: Promise<ExitStatus>;
  #isClosing = false;

  constructor(child: ChildProcess) {
    this.#child = child;
    this.#exit = new Promise((resolve) => {
      child.once("error", (error) => resolve({ error }));
      child.once("close", (code) => resolve({ code }));
    });
    // A broken stdin means the session cannot continue; the exit status reports why.
    child.stdin?.once("error", () => child.kill("SIGTERM"));
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return this.#readMessages();
  }

  /** SIGTERM exits 143 and leaves the turn unfinished, so Stop is SIGINT (headless docs). */
  interrupt(): Promise<undefined> {
    this.#child.kill("SIGINT");
    return Promise.resolve(undefined);
  }

  close(): void {
    this.#isClosing = true;
    this.#child.stdin?.end();
    this.#child.kill("SIGTERM");
  }

  async pumpPrompts(prompt: AsyncIterable<SDKUserMessage>): Promise<void> {
    for await (const message of prompt) {
      if (this.#isClosing) return;
      this.#child.stdin?.write(`${JSON.stringify(message)}\n`);
    }
    this.#child.stdin?.end();
  }

  async *#readMessages(): AsyncGenerator<SDKMessage> {
    if (this.#child.stdout === null) throw new Error("The -p child has no stdout");
    for await (const line of createInterface({ input: this.#child.stdout })) {
      const message = parseMessage(line);
      if (message !== undefined) yield message;
    }
    const exit = await this.#exit;
    if (exit.error !== undefined) throw exit.error;
    if (!this.#isClosing && exit.code !== 0) throw new Error(`claude -p exited with code ${String(exit.code)}`);
  }
}

function parseMessage(line: string): SDKMessage | undefined {
  try {
    const value: unknown = JSON.parse(line);
    return isSdkMessage(value) ? value : undefined;
  } catch (error) {
    // --verbose can print plain lines between the NDJSON messages.
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

function isSdkMessage(value: unknown): value is SDKMessage {
  return typeof value === "object" && value !== null && "type" in value && typeof value.type === "string";
}

function optionalFlag(flag: string, value: string | number | undefined): string[] {
  return value === undefined ? [] : [flag, String(value)];
}
