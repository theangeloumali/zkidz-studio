// Created by The Angelo Umali.
// OpenCode in mode T (ADR 0007): the user's own sign-in, a password-protected local `opencode serve` the TUI attaches to,
// and a studio-written config that denies every tool but the studio's and project reads.
import { randomBytes, randomInt } from "node:crypto";
import { createServer } from "node:net";
import { LOOPBACK_HOST } from "@zks/shared";
import type { TerminalTokens } from "../../auth/agent-env.ts";
import type { AgentAdapter, AgentLaunchRequest, PreparedLaunch } from "./agent-adapter.ts";
import { AgentLaunchError, buildTerminalAgentEnv } from "./agent-env.ts";
import { createAgentFilesDir, writeAgentFile } from "./agent-files.ts";
import { buildAgentInstructions } from "./instructions.ts";
import { MCP_SERVER_PATH } from "../session-files.ts";
import { subscribeOpenCodeEvents } from "./opencode-stream.ts";

const SERVER_USERNAME = "opencode";
const PASSWORD_ENV = "OPENCODE_SERVER_PASSWORD";
const SESSION_ID_LENGTH = 26;
const SESSION_ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const READY_POLL_MS = 200;
const DEFAULT_RECONNECT_DELAY_MS = 500;
/** OpenCode checks the most specific rule last-wins; "*" deny first makes everything else opt-in. */
export const OPENCODE_PERMISSIONS = { "*": "deny", "studio_*": "allow", read: "allow", external_directory: "deny" } as const;
/** Without these OpenCode also loads the project's config, ~/.claude skills and an auto-updater. */
const ISOLATION_ENV = { OPENCODE_DISABLE_PROJECT_CONFIG: "1", OPENCODE_DISABLE_CLAUDE_CODE: "1", OPENCODE_DISABLE_AUTOUPDATE: "1" } as const;
const INHERITED_DIRS = ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"] as const;

type Environment = Readonly<Record<string, string | undefined>>;

interface OpenCodeAdapterOptions {
  readonly parentEnv?: Environment;
  readonly findFreePort?: () => Promise<number>;
  readonly fetch?: typeof fetch;
  readonly reconnectDelayMs?: number;
}

export function createOpenCodeAdapter(options: OpenCodeAdapterOptions = {}): AgentAdapter {
  const parentEnv = options.parentEnv ?? process.env;
  const findPort = options.findFreePort ?? findFreeLoopbackPort;
  const fetchImpl = options.fetch ?? fetch;
  const reconnectDelayMs = options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
  return {
    kind: "opencode",
    label: "OpenCode",
    binaryNames: ["opencode", "opencode.exe", "opencode.cmd"],
    versionArgs: ["--version"],
    minVersion: "2.2.0",
    async prepare(request, tokens, binaryPath) {
      const serverUrl = `http://${LOOPBACK_HOST}:${await findPort()}`;
      const password = randomBytes(32).toString("base64url");
      const filesDir = await createAgentFilesDir(request.runDir, request.sessionId);
      const instructionsPath = await writeAgentFile(filesDir, "instructions.md", await buildAgentInstructions(request));
      await writeAgentFile(filesDir, "opencode.json", JSON.stringify(buildConfig(request, instructionsPath), null, 2));
      const env = buildTerminalAgentEnv({
        parentEnv,
        inheritNames: INHERITED_DIRS,
        extraEnv: { [PASSWORD_ENV]: password, OPENCODE_CONFIG_DIR: filesDir, ...ISOLATION_ENV },
      });
      const sessionId = request.resumeSessionId ?? newSessionId();
      const authorization = basicAuth(password);
      return {
        file: binaryPath,
        args: [request.projectDir, "--server", serverUrl, "--session", sessionId],
        env,
        cwd: request.projectDir,
        filesDir,
        companion: {
          file: binaryPath,
          args: ["serve", "--hostname", LOOPBACK_HOST, "--port", new URL(serverUrl).port],
          // Only the server spawns the studio MCP, so only it carries the MCP token.
          env: { ...env, ...mcpEnv(tokens) },
          isReady: (signal) => waitUntilServing({ serverUrl, authorization, fetch: fetchImpl }, signal),
        },
      };
    },
    events: {
      kind: "stream",
      subscribe(launch, context, publish) {
        const connection = { ...connectionOf(launch), fetch: fetchImpl, reconnectDelayMs };
        return subscribeOpenCodeEvents(connection, context, publish);
      },
    },
  };
}

function buildConfig(request: AgentLaunchRequest, instructionsPath: string) {
  return {
    $schema: "https://opencode.ai/config.json",
    share: "disabled",
    autoupdate: false,
    ...(request.model === undefined ? {} : { model: request.model }),
    // {env:...} is resolved by OpenCode when it loads the file, so the token is never written to disk.
    mcp: {
      studio: {
        type: "local",
        command: [request.nodePath, MCP_SERVER_PATH],
        environment: { ZKS_MCP_TOKEN: "{env:ZKS_MCP_TOKEN}", ZKS_MCP_URL: "{env:ZKS_MCP_URL}" },
      },
    },
    permission: OPENCODE_PERMISSIONS,
    instructions: [instructionsPath],
  };
}

function connectionOf(launch: PreparedLaunch): { readonly serverUrl: string; readonly sessionId: string; readonly authorization: string } {
  const serverUrl = launch.args[launch.args.indexOf("--server") + 1];
  const sessionId = launch.args[launch.args.indexOf("--session") + 1];
  const password = launch.env[PASSWORD_ENV];
  if (serverUrl === undefined || sessionId === undefined || password === undefined)
    throw new AgentLaunchError("companion_failed", "This launch was not prepared by the OpenCode adapter.");
  return { serverUrl, sessionId, authorization: basicAuth(password) };
}

interface ServerProbe {
  readonly serverUrl: string;
  readonly authorization: string;
  readonly fetch: typeof fetch;
}

async function waitUntilServing(probe: ServerProbe, signal: AbortSignal): Promise<void> {
  while (!(await isServing(probe, signal))) {
    signal.throwIfAborted();
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }
}

async function isServing(probe: ServerProbe, signal: AbortSignal): Promise<boolean> {
  signal.throwIfAborted();
  try {
    const response = await probe.fetch(`${probe.serverUrl}/api/config`, { headers: { authorization: probe.authorization }, signal });
    return response.ok;
  } catch {
    return false;
  }
}

function mcpEnv(tokens: TerminalTokens): Record<string, string> {
  return { ZKS_MCP_TOKEN: tokens.mcpToken, ZKS_MCP_URL: tokens.mcpUrl };
}

const basicAuth = (password: string) => `Basic ${Buffer.from(`${SERVER_USERNAME}:${password}`).toString("base64")}`;

/** OpenCode's `--session` creates a missing session, but only for an id shaped like its own. */
function newSessionId(): string {
  const suffix = Array.from({ length: SESSION_ID_LENGTH }, () => SESSION_ID_ALPHABET[randomInt(SESSION_ID_ALPHABET.length)]).join("");
  return `ses_${suffix}`;
}

function findFreeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, LOOPBACK_HOST, () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => (port > 0 ? resolve(port) : reject(new AgentLaunchError("companion_failed", "No free local port for the OpenCode server."))));
    });
  });
}
