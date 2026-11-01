// Created by The Angelo Umali.
// Per-session --settings, --mcp-config and rules files for mode T (plan §6.3) and claude -p (§6.7). They hold no secret: tokens stay in the child env.
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { IdSchema } from "@zks/shared";
import { studioMcpUrl, terminalHookUrl } from "../tools/mcp-paths.ts";

/** The SessionStart relay; Claude Code skips an `http` SessionStart hook (spike 07). */
export const HOOK_RELAY_PATH = fileURLToPath(new URL("../../bin/zks-hook.mjs", import.meta.url));
/** The stdio MCP twin that reaches the server's loopback MCP routes (plan §6.7). */
export const MCP_SERVER_PATH = fileURLToPath(new URL("../../bin/zks-mcp.mjs", import.meta.url));

const OWNER_ONLY_DIR_MODE = 0o700;
const OWNER_ONLY_FILE_MODE = 0o600;
const HOOK_TIMEOUT_S = 30;
const RELAY_TIMEOUT_S = 10;
/** The AskUserQuestion hook holds while the user answers the card in Activity (terminal-sessions.ts). */
export const QUESTION_HOOK_TIMEOUT_S = 3600;
/** Claude Code holds each streamed batch until this hook answers, so it stays short. */
const MESSAGE_DISPLAY_TIMEOUT_S = 5;
const QUESTION_TOOL = "AskUserQuestion";

export interface SessionFilesRequest {
  /** The runtime dir (§11 ZKS_RUN), cleared at startup so a crashed session leaves nothing behind. */
  readonly runDir: string;
  readonly sessionId: string;
  readonly appPort: number;
  readonly nodePath: string;
  readonly hookRelayPath: string;
  readonly mcpServerPath: string;
  readonly rulesText: string;
}

export interface SessionFiles {
  readonly dir: string;
  readonly settingsPath: string;
  readonly mcpConfigPath: string;
  readonly rulesPath: string;
  /** The twin's ZKS_MCP_URL; it appends /tools and /call. */
  readonly mcpUrl: string;
  readonly hookUrl: string;
}

export type PrintSessionFilesRequest = Omit<SessionFilesRequest, "hookRelayPath">;

export async function writeSessionFiles(request: SessionFilesRequest): Promise<SessionFiles> {
  for (const commandPath of [request.nodePath, request.hookRelayPath]) {
    if (commandPath.includes('"')) throw new Error("A hook command path must not contain a quote.");
  }
  const files = await createSessionDir(request);
  await Promise.all([
    writeOwnerOnly(files.settingsPath, JSON.stringify(buildHookSettings(request, files.hookUrl), null, 2)),
    writeOwnerOnly(files.mcpConfigPath, JSON.stringify(buildMcpConfig(request), null, 2)),
    writeOwnerOnly(files.rulesPath, request.rulesText),
  ]);
  return files;
}

/** The `claude -p` run (plan §6.7): the same MCP twin, and one hook, the deny-only Read backstop of §6.10. */
export async function writePrintSessionFiles(request: PrintSessionFilesRequest): Promise<SessionFiles> {
  const files = await createSessionDir(request);
  const settings = { hooks: { PreToolUse: [{ matcher: "Read", hooks: [{ ...httpHook(files.hookUrl), onFailure: "block" }] }] } };
  await Promise.all([
    writeOwnerOnly(files.settingsPath, JSON.stringify(settings, null, 2)),
    writeOwnerOnly(files.mcpConfigPath, JSON.stringify(buildMcpConfig(request), null, 2)),
    writeOwnerOnly(files.rulesPath, request.rulesText),
  ]);
  return files;
}

/** One owner-only folder per launch: a reopen may reuse the session id while the killed launch's cleanup still runs. */
export async function createSessionFolder(runDir: string, sessionId: string): Promise<string> {
  const dir = join(runDir, `${IdSchema.parse(sessionId)}.${randomUUID()}`);
  // Startup clears ZKS_RUN, so the first launch after it creates it; the session folder itself must be new.
  await mkdir(runDir, { recursive: true, mode: OWNER_ONLY_DIR_MODE });
  await mkdir(dir, { mode: OWNER_ONLY_DIR_MODE });
  return dir;
}

/** Builds a session's files in a fresh folder, and removes the folder if any step throws. */
export async function withSessionFolder<T>(runDir: string, sessionId: string, build: (dir: string) => Promise<T>): Promise<T> {
  const dir = await createSessionFolder(runDir, sessionId);
  try {
    return await build(dir);
  } catch (error) {
    await removeSessionFiles({ dir });
    throw error;
  }
}

/** "wx": a file that already exists is never reused, so nothing planted beforehand can be read as ours. */
export async function writeSessionFile(dir: string, fileName: string, contents: string): Promise<string> {
  const path = join(dir, fileName);
  await writeOwnerOnly(path, contents);
  return path;
}

export async function clearSessionFiles(runDir: string): Promise<void> {
  await rm(runDir, { recursive: true, force: true });
}

export async function removeSessionFiles(files: Pick<SessionFiles, "dir">): Promise<void> {
  await rm(files.dir, { recursive: true, force: true });
}

async function createSessionDir(request: Pick<SessionFilesRequest, "runDir" | "sessionId" | "appPort">): Promise<SessionFiles> {
  const sessionId = IdSchema.parse(request.sessionId);
  const dir = await createSessionFolder(request.runDir, sessionId);
  return {
    dir,
    settingsPath: join(dir, "settings.json"),
    mcpConfigPath: join(dir, "mcp.json"),
    rulesPath: join(dir, "rules.md"),
    mcpUrl: studioMcpUrl(request.appPort, sessionId),
    hookUrl: terminalHookUrl(request.appPort, sessionId),
  };
}

// Claude Code expands $ZKS_HOOK_TOKEN from the child env, and only because allowedEnvVars names it.
function httpHook(hookUrl: string, timeout = HOOK_TIMEOUT_S) {
  return { type: "http", url: hookUrl, headers: { Authorization: "Bearer $ZKS_HOOK_TOKEN" }, allowedEnvVars: ["ZKS_HOOK_TOKEN"], timeout };
}

function buildHookSettings(request: SessionFilesRequest, hookUrl: string) {
  const hook = httpHook(hookUrl);
  const relay = `"${request.nodePath}" "${request.hookRelayPath}"`;
  return {
    hooks: {
      SessionStart: [{ hooks: [{ type: "command", command: `${relay} "${hookUrl}"`, timeout: RELAY_TIMEOUT_S }] }],
      // A bridge that is down must stop the prompt or tool, not wave it through unaudited.
      UserPromptSubmit: [{ hooks: [{ ...hook, onFailure: "block" }] }],
      // Two entries, never overlapping: Claude Code runs every matching hook and leaves two updatedInputs undefined.
      PreToolUse: [
        { matcher: QUESTION_TOOL, hooks: [{ ...httpHook(hookUrl, QUESTION_HOOK_TIMEOUT_S), onFailure: "block" }] },
        { matcher: `^(?!${QUESTION_TOOL}$)`, hooks: [{ ...hook, onFailure: "block" }] },
      ],
      PostToolUse: [{ matcher: "*", hooks: [hook] }],
      Stop: [{ hooks: [hook] }],
      Notification: [{ hooks: [hook] }],
      // A failed display hook shows the original text, so it never blocks.
      MessageDisplay: [{ hooks: [httpHook(hookUrl, MESSAGE_DISPLAY_TIMEOUT_S)] }],
    },
    statusLine: { type: "command", command: `${relay} --status "${hookUrl}"` },
  };
}

function buildMcpConfig(request: Pick<SessionFilesRequest, "nodePath" | "mcpServerPath">) {
  return {
    mcpServers: {
      studio: {
        type: "stdio",
        command: request.nodePath,
        args: [request.mcpServerPath],
        env: { ZKS_MCP_TOKEN: "${ZKS_MCP_TOKEN}", ZKS_MCP_URL: "${ZKS_MCP_URL}" },
      },
    },
  };
}

async function writeOwnerOnly(path: string, contents: string): Promise<void> {
  await writeFile(path, contents, { mode: OWNER_ONLY_FILE_MODE, flag: "wx" });
}
