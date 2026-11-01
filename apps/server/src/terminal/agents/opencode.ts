// Created by The Angelo Umali.
// OpenCode in mode T (ADR 0007): the user's own sign-in, a password-protected local `opencode serve` the TUI attaches to,
// and a studio-written config, the only one it loads, that denies every tool but the studio's and asks for each read.
import { randomBytes, randomInt } from "node:crypto";
import { AGENT_MIN_VERSIONS, LOOPBACK_HOST } from "@zks/shared";
import type { TerminalTokens } from "../../auth/agent-env.ts";
import type { AgentAdapter, AgentLaunchRequest, PreparedLaunch } from "./agent-adapter.ts";
import { AgentLaunchError, buildTerminalAgentEnv } from "./agent-env.ts";
import { buildAgentInstructions } from "./instructions.ts";
import { MCP_SERVER_PATH, withSessionFolder, writeSessionFile } from "../session-files.ts";
import { assertStudioLockdown, OPENCODE_CONFIG_FILE, OPENCODE_PERMISSIONS, readListeningUrl } from "./opencode-companion.ts";
import { type OpenCodeConnection, subscribeOpenCodeEvents } from "./opencode-stream.ts";

const SERVER_USERNAME = "opencode";
const PASSWORD_ENV = "OPENCODE_SERVER_PASSWORD";
const SESSION_ID_LENGTH = 26;
const SESSION_ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const DEFAULT_RECONNECT_DELAY_MS = 500;
/** Without these OpenCode also loads the project's config, ~/.claude skills and an auto-updater. */
const ISOLATION_ENV = { OPENCODE_DISABLE_PROJECT_CONFIG: "1", OPENCODE_DISABLE_CLAUDE_CODE: "1", OPENCODE_DISABLE_AUTOUPDATE: "1" } as const;
/** The sign-in lives under XDG_DATA_HOME, so only the config dir is moved. */
const INHERITED_DIRS = ["XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"] as const;

type Environment = Readonly<Record<string, string | undefined>>;

interface OpenCodeAdapterOptions {
  readonly parentEnv?: Environment;
  readonly fetch?: typeof fetch;
  readonly reconnectDelayMs?: number;
}

export function createOpenCodeAdapter(options: OpenCodeAdapterOptions = {}): AgentAdapter {
  const parentEnv = options.parentEnv ?? process.env;
  const fetchImpl = options.fetch ?? fetch;
  const reconnectDelayMs = options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
  // Only a launch whose server passed the lockdown check has a connection, so subscribe cannot follow an unchecked one.
  const connections = new WeakMap<PreparedLaunch, OpenCodeConnection>();
  return {
    kind: "opencode",
    binaryNames: ["opencode", "opencode.exe"],
    // The prompt box's footer (agent · model) is drawn once the TUI takes input; keys typed before it are lost.
    inputReady: /Build·/,
    versionArgs: ["--version"],
    minVersion: AGENT_MIN_VERSIONS.opencode,
    async prepare(request, tokens, binaryPath) {
      const password = randomBytes(32).toString("base64url");
      const { filesDir, env } = await withSessionFolder(request.runDir, request.sessionId, async (dir) => {
        const instructionsPath = await writeSessionFile(dir, "instructions.md", await buildAgentInstructions(request));
        await writeSessionFile(dir, OPENCODE_CONFIG_FILE, JSON.stringify(buildConfig(request, instructionsPath), null, 2));
        const agentEnv = buildTerminalAgentEnv({
          parentEnv,
          inheritNames: INHERITED_DIRS,
          extraEnv: { [PASSWORD_ENV]: password, XDG_CONFIG_HOME: dir, OPENCODE_CONFIG_DIR: dir, ...ISOLATION_ENV },
        });
        return { filesDir: dir, env: agentEnv };
      });
      const sessionId = request.resumeSessionId ?? newSessionId();
      const authorization = basicAuth(password);
      const scope = { projectDir: request.projectDir, pluginDir: request.pluginDir, studioToolNames: request.studioToolNames };
      const unconnected = { file: binaryPath, env, cwd: request.projectDir, filesDir };
      return {
        ...unconnected,
        // Not runnable until connect names the server: alone, the TUI would start its own unchecked one.
        args: [request.projectDir, "--session", sessionId],
        companion: {
          file: binaryPath,
          // Port 0: the server binds its own port and prints it, so no other process can be handed the password.
          args: ["serve", "--hostname", LOOPBACK_HOST, "--port", "0"],
          // Only the server spawns the studio MCP, so only it carries the MCP token.
          env: { ...env, ...mcpEnv(tokens) },
          async connect(output, signal) {
            const serverUrl = await readListeningUrl(output, signal);
            await assertStudioLockdown({ serverUrl, authorization, fetch: fetchImpl }, filesDir, signal);
            const launch: PreparedLaunch = { ...unconnected, args: [request.projectDir, "--server", serverUrl, "--session", sessionId] };
            connections.set(launch, { serverUrl, sessionId, authorization, fetch: fetchImpl, reconnectDelayMs, scope });
            return launch;
          },
        },
      };
    },
    events: {
      kind: "stream",
      subscribe(launch, context, publish) {
        const connection = connections.get(launch);
        if (connection === undefined) throw new AgentLaunchError("companion_failed", "This OpenCode launch has no checked server to follow.");
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

function mcpEnv(tokens: TerminalTokens): Record<string, string> {
  return { ZKS_MCP_TOKEN: tokens.mcpToken, ZKS_MCP_URL: tokens.mcpUrl };
}

const basicAuth = (password: string) => `Basic ${Buffer.from(`${SERVER_USERNAME}:${password}`).toString("base64")}`;

/** OpenCode's `--session` creates a missing session, but only for an id shaped like its own. */
function newSessionId(): string {
  const suffix = Array.from({ length: SESSION_ID_LENGTH }, () => SESSION_ID_ALPHABET[randomInt(SESSION_ID_ALPHABET.length)]).join("");
  return `ses_${suffix}`;
}
