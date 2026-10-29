// Created by The Angelo Umali.
// Opens a Codex or OpenCode session through its adapter (ADR 0007): its locked-down files, its companion server, the PTY.
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { studioMcpUrl } from "../tools/mcp-paths.ts";
import type { AgentAdapter, PreparedLaunch } from "./agents/agent-adapter.ts";
import { resolveAgentBinary } from "./agents/agent-binary.ts";
import { createCodexAdapter } from "./agents/codex.ts";
import { createOpenCodeAdapter } from "./agents/opencode.ts";
import type { TerminalAgentKind } from "./agents/agent-versions.ts";
import { TerminalLaunchError } from "./pty-host.ts";
import { freshSessionState, type OpenTerminalRequest, type SessionRecord, type TerminalSessionsDeps } from "./session-launch.ts";

/** OpenCode's serve answers within seconds; past this it is stuck, and the session fails instead of hanging. */
const COMPANION_READY_TIMEOUT_MS = 30_000;

export interface TerminalAgent {
  readonly adapter: AgentAdapter;
  /** Resolved once at startup, like claude's path; pty-host refuses any other file. */
  readonly binaryPath: string;
}

export type TerminalAgents = ReadonlyMap<TerminalAgentKind, TerminalAgent>;

export interface AgentRuntime {
  readonly adapter: AgentAdapter;
  readonly launch: PreparedLaunch;
  readonly companion?: ChildProcess;
  /** The agent's own session id, from its SessionStart hook; the adapter reads usage by it. */
  agentSessionId?: string;
  unsubscribe?: () => void;
}

/** The installed agents among Codex and OpenCode; a missing one is simply absent. */
export async function resolveTerminalAgents(env: Readonly<Record<string, string | undefined>>): Promise<TerminalAgents> {
  const adapters = [createCodexAdapter(), createOpenCodeAdapter()];
  const resolved = await Promise.all(adapters.map(async (adapter) => ({ adapter, binaryPath: await resolveAgentBinary(adapter.binaryNames, env) })));
  const agents = new Map<TerminalAgentKind, TerminalAgent>();
  for (const { adapter, binaryPath } of resolved) {
    if (binaryPath !== null && (adapter.kind === "codex" || adapter.kind === "opencode")) agents.set(adapter.kind, { adapter, binaryPath });
  }
  return agents;
}

/** Fresh sessions only: these agents mint their own session ids, so the studio cannot hand one back to resume. */
export async function launchAgentSession(deps: TerminalSessionsDeps, request: OpenTerminalRequest, kind: TerminalAgentKind): Promise<SessionRecord> {
  const agent = deps.agents?.get(kind);
  if (agent === undefined) {
    const label = kind === "codex" ? "Codex" : "OpenCode";
    const message = `${label} was not found. Install it, then open the terminal again.`;
    await deps.eventBus.publish({ type: "session.error", projectId: request.projectId, kind: "agent_missing", message });
    throw new TerminalLaunchError("agent_missing", message);
  }
  const sessionId = randomUUID();
  const tokens = { hookToken: deps.createToken(), mcpToken: deps.createToken() };
  const launch = await agent.adapter.prepare(
    {
      sessionId,
      projectId: request.projectId,
      projectDir: request.projectDir,
      runDir: deps.runDir,
      appPort: deps.appPort,
      nodePath: process.execPath,
      rulesText: request.rulesText,
      pluginDir: deps.pluginDir,
      studioToolNames: deps.studioToolNames,
    },
    { ...tokens, mcpUrl: studioMcpUrl(deps.appPort, sessionId) },
    agent.binaryPath,
  );
  let companion: ChildProcess | undefined;
  try {
    let connected = launch;
    if (launch.companion !== undefined) ({ child: companion, connected } = await startCompanion(launch.companion, launch.cwd));
    const pty = await deps.ptyHost.launch(sessionId, { argv: [connected.file, ...connected.args], cwd: connected.cwd, env: { ...connected.env } });
    const runtime: AgentRuntime = { adapter: agent.adapter, launch: connected, ...(companion === undefined ? {} : { companion }) };
    return {
      ...request,
      ...tokens,
      sessionId,
      pty,
      files: { dir: launch.filesDir },
      agent: runtime,
      ...freshSessionState(),
      // A stream-driven agent has no SessionStart hook; its companion answering is the start.
      hasStarted: agent.adapter.events.kind === "stream",
    };
  } catch (error) {
    companion?.kill();
    await rm(launch.filesDir, { recursive: true, force: true });
    throw error;
  }
}

// The adapter reads the companion's own stdout for its address, so the PTY only connects to the server it spawned.
// A companion that dies before it answers fails the launch at once.
async function startCompanion(companion: NonNullable<PreparedLaunch["companion"]>, cwd: string): Promise<{ child: ChildProcess; connected: PreparedLaunch }> {
  const child = spawn(companion.file, [...companion.args], { cwd, env: { ...companion.env }, stdio: ["ignore", "pipe", "ignore"], shell: false });
  const readiness = new AbortController();
  const died = new Promise<never>((_resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) =>
      reject(new TerminalLaunchError("agent_missing", `The agent's companion server exited (code ${code ?? "none"}) before it was ready.`)),
    );
  });
  try {
    const signal = AbortSignal.any([readiness.signal, AbortSignal.timeout(COMPANION_READY_TIMEOUT_MS)]);
    const connected = await Promise.race([companion.connect(child.stdout, signal), died]);
    return { child, connected };
  } catch (error) {
    readiness.abort();
    child.kill();
    throw error;
  } finally {
    died.catch(() => undefined);
  }
}
