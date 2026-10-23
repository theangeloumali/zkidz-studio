// Created by The Angelo Umali.
// `claude -p` runs (plan §6.7): each gets its own MCP twin session and hook token, valid only while the child runs.
import { randomUUID } from "node:crypto";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { HookPayload, HookResponse } from "@zks/shared";
import { MCP_SERVER_PATH, removeSessionFiles, writePrintSessionFiles } from "../terminal/session-files.ts";
import { answerRead, type ReadRoots } from "./confine-reads.ts";
import { createPrintQuery, type SpawnClaude } from "./print-runner.ts";
import type { QueryFunction, QueryHandle } from "./query-function.ts";

export interface PrintSessionsDeps {
  readonly claudePath: string;
  readonly runDir: string;
  readonly appPort: number;
  readonly pluginDir: string;
  readonly createToken: () => string;
  readonly tokensMatch: (expected: string, presented: string | undefined) => boolean;
  readonly spawn?: SpawnClaude;
}

interface PrintSession {
  readonly projectId: string;
  readonly mcpToken: string;
}

export interface PrintSessions {
  readonly query: QueryFunction;
  find(sessionId: string): PrintSession | undefined;
  isHookAuthorized(sessionId: string, presentedToken: string | undefined): boolean;
  handleHook(sessionId: string, payload: HookPayload): Promise<HookResponse>;
}

interface PrintRecord extends PrintSession {
  readonly hookToken: string;
  readonly roots: ReadRoots;
}

export function createPrintSessions(deps: PrintSessionsDeps): PrintSessions {
  const records = new Map<string, PrintRecord>();

  const query: QueryFunction = ({ prompt, projectId, options }) => {
    let inner: QueryHandle | undefined;
    let isClosed = false;
    // Stop can land while the session files are still being written; the child gets it once it exists.
    let isInterruptPending = false;
    const isStopped = () => isClosed || options.abortController?.signal.aborted === true;

    async function* run(): AsyncGenerator<SDKMessage> {
      if (isStopped()) return;
      if (options.cwd === undefined) throw new Error("The -p fallback needs the project folder as cwd");
      const sessionId = randomUUID();
      const record: PrintRecord = {
        projectId,
        mcpToken: deps.createToken(),
        hookToken: deps.createToken(),
        roots: { projectDir: options.cwd, pluginDir: deps.pluginDir },
      };
      const files = await writePrintSessionFiles({
        runDir: deps.runDir,
        sessionId,
        appPort: deps.appPort,
        nodePath: process.execPath,
        mcpServerPath: MCP_SERVER_PATH,
      });
      records.set(sessionId, record);
      try {
        if (isStopped()) return;
        const env = { ...options.env, ZKS_MCP_URL: files.mcpUrl, ZKS_MCP_TOKEN: record.mcpToken, ZKS_HOOK_TOKEN: record.hookToken };
        const printQuery = createPrintQuery({ ...files, claudePath: deps.claudePath, pluginDir: deps.pluginDir, spawn: deps.spawn });
        inner = printQuery({ prompt, projectId, options: { ...options, env } });
        if (isInterruptPending) await inner.interrupt?.();
        yield* inner;
      } finally {
        // A consumer that stops early must not leave the child or its tokens behind.
        inner?.close?.();
        records.delete(sessionId);
        await removeSessionFiles(files);
      }
    }

    const messages = run();
    return {
      [Symbol.asyncIterator]: () => messages,
      interrupt: () => {
        if (inner === undefined) isInterruptPending = true;
        return inner?.interrupt?.() ?? Promise.resolve(undefined);
      },
      close: () => {
        isClosed = true;
        inner?.close?.();
      },
    };
  };

  return {
    query,
    find(sessionId) {
      const record = records.get(sessionId);
      return record === undefined ? undefined : { projectId: record.projectId, mcpToken: record.mcpToken };
    },
    isHookAuthorized(sessionId, presentedToken) {
      const record = records.get(sessionId);
      return record !== undefined && deps.tokensMatch(record.hookToken, presentedToken);
    },
    // Deny-only: a hook "allow" would skip the approve permission-prompt tool (c2507e7).
    handleHook(sessionId, payload) {
      const record = records.get(sessionId);
      if (record === undefined || payload.hook_event_name !== "PreToolUse") return Promise.resolve({});
      return answerRead(record.roots, payload.tool_name, payload.tool_input);
    },
  };
}
