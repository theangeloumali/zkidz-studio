// Created by The Angelo Umali.
// Per-session --settings, --mcp-config and rules files for mode T (plan §6.3). They hold no secret: tokens stay in the child env.
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { API_ROUTES, IdSchema, LOOPBACK_HOST } from "@zks/shared";
import { studioMcpUrl } from "../tools/mcp-paths.ts";

/** The SessionStart relay; Claude Code skips an `http` SessionStart hook (spike 07). */
export const HOOK_RELAY_PATH = fileURLToPath(new URL("../../bin/zks-hook.mjs", import.meta.url));
/** The stdio MCP twin that reaches the server's loopback MCP routes (plan §6.7). */
export const MCP_SERVER_PATH = fileURLToPath(new URL("../../bin/zks-mcp.mjs", import.meta.url));

const HOOK_TIMEOUT_S = 30;
const RELAY_TIMEOUT_S = 10;

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

export type PrintSessionFilesRequest = Omit<SessionFilesRequest, "hookRelayPath" | "rulesText">;
export type PrintSessionFiles = Omit<SessionFiles, "rulesPath">;

export async function writeSessionFiles(request: SessionFilesRequest): Promise<SessionFiles> {
  for (const commandPath of [request.nodePath, request.hookRelayPath]) {
    if (commandPath.includes('"')) throw new Error("A hook command path must not contain a quote.");
  }
  const files = await createSessionDir(request);
  const rulesPath = join(files.dir, "rules.md");
  await Promise.all([
    writeOwnerOnly(files.settingsPath, JSON.stringify(buildHookSettings(request, files.hookUrl), null, 2)),
    writeOwnerOnly(files.mcpConfigPath, JSON.stringify(buildMcpConfig(request), null, 2)),
    writeOwnerOnly(rulesPath, request.rulesText),
  ]);
  return { ...files, rulesPath };
}

/** The `claude -p` run (plan §6.7): the same MCP twin, and one hook, the deny-only Read backstop of §6.10. */
export async function writePrintSessionFiles(request: PrintSessionFilesRequest): Promise<PrintSessionFiles> {
  const files = await createSessionDir(request);
  const settings = { hooks: { PreToolUse: [{ matcher: "Read", hooks: [{ ...httpHook(files.hookUrl), onFailure: "block" }] }] } };
  await Promise.all([
    writeOwnerOnly(files.settingsPath, JSON.stringify(settings, null, 2)),
    writeOwnerOnly(files.mcpConfigPath, JSON.stringify(buildMcpConfig(request), null, 2)),
  ]);
  return files;
}

export async function clearSessionFiles(runDir: string): Promise<void> {
  await rm(runDir, { recursive: true, force: true });
}

export async function removeSessionFiles(files: Pick<SessionFiles, "dir">): Promise<void> {
  await rm(files.dir, { recursive: true, force: true });
}

async function createSessionDir(request: PrintSessionFilesRequest): Promise<PrintSessionFiles> {
  const sessionId = IdSchema.parse(request.sessionId);
  // One folder per launch: a reopen resumes the same session id while the killed launch's cleanup may still be running.
  const dir = join(request.runDir, `${sessionId}.${randomUUID()}`);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return {
    dir,
    settingsPath: join(dir, "settings.json"),
    mcpConfigPath: join(dir, "mcp.json"),
    mcpUrl: studioMcpUrl(request.appPort, sessionId),
    hookUrl: `http://${LOOPBACK_HOST}:${request.appPort}${API_ROUTES.terminalHooks.path.replace(":sessionId", sessionId)}`,
  };
}

// Claude Code expands $ZKS_HOOK_TOKEN from the child env, and only because allowedEnvVars names it.
function httpHook(hookUrl: string) {
  return { type: "http", url: hookUrl, headers: { Authorization: "Bearer $ZKS_HOOK_TOKEN" }, allowedEnvVars: ["ZKS_HOOK_TOKEN"], timeout: HOOK_TIMEOUT_S };
}

function buildHookSettings(request: SessionFilesRequest, hookUrl: string) {
  const hook = httpHook(hookUrl);
  const relayCommand = `"${request.nodePath}" "${request.hookRelayPath}" "${hookUrl}"`;
  return {
    hooks: {
      SessionStart: [{ hooks: [{ type: "command", command: relayCommand, timeout: RELAY_TIMEOUT_S }] }],
      // A bridge that is down must stop the prompt or tool, not wave it through unaudited.
      UserPromptSubmit: [{ hooks: [{ ...hook, onFailure: "block" }] }],
      PreToolUse: [{ matcher: "*", hooks: [{ ...hook, onFailure: "block" }] }],
      PostToolUse: [{ matcher: "*", hooks: [hook] }],
      Stop: [{ hooks: [hook] }],
      Notification: [{ hooks: [hook] }],
    },
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
  await writeFile(path, contents, { mode: 0o600, flag: "wx" });
}
