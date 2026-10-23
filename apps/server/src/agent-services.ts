// Created by The Angelo Umali.
// The Phase 2 graph (plan §6): one broker, the SDK manager, mode T sessions and the studio tools, mounted by createApp.
import { join } from "node:path";
import type { StudioDatabase } from "@zks/db";
import type { Hono } from "hono";
import { DecisionBroker } from "./agent/decisions.ts";
import { AgentManager } from "./agent/manager.ts";
import { createPrintSessions, type PrintSessions } from "./agent/print-sessions.ts";
import type { QueryFunction } from "./agent/query-function.ts";
import { registerAgentRoutes } from "./agent/routes.ts";
import { hasBundledClaudeBinary } from "./agent/sdk-binary.ts";
import { buildAgentEnv } from "./auth/agent-env.ts";
import type { FetchFunction } from "./auth/key-check.ts";
import { registerConnectRoutes } from "./auth/routes.ts";
import type { SecretStore } from "./auth/secret-store.ts";
import type { EventBus } from "./events/event-bus.ts";
import type { JobRunner } from "./jobs/job-runner.ts";
import type { Logger } from "./logging/logger.ts";
import { allowedHostsFor } from "./security/request-guards.ts";
import { createSessionToken, tokensMatch } from "./security/token.ts";
import { checkWebSocketUpgrade, createTicketStore } from "./security/ws-guard.ts";
import { registerProjectTerminalRoutes } from "./terminal/project-routes.ts";
import { createPtyHost } from "./terminal/pty-host.ts";
import { registerTerminalRoutes } from "./terminal/routes.ts";
import { createTerminalSessions, type TerminalSessions } from "./terminal/terminal-sessions.ts";
import { studioTwinCatalog } from "./tools/catalog.ts";
import type { ToolContext } from "./tools/context.ts";
import { createStudioMcpServer, registerEngineJobHandlers, registerStudioToolRoutes, type EngineRunner } from "./tools/index.ts";

const REQUIRED_SKILLS = ["zkidz-studio:edit-director", "zkidz-studio:cut-spec"];
// ASSUMPTION: defaults until §6b's per-project settings land.
const SESSION_LIMITS = { maxTurns: 40, maxBudgetUsd: 5 };
const TERMINAL_MODEL = "sonnet";
/** No claude on PATH: pty-host still needs an absolute path, and this one makes every open fail as claude_missing. */
const MISSING_CLAUDE_NAME = "claude-not-installed";

export interface AgentServicesDeps {
  readonly database: StudioDatabase;
  readonly studioHome: string;
  readonly eventBus: EventBus;
  readonly jobRunner: JobRunner;
  readonly logger: Logger;
  readonly appPort: number;
  readonly appVersion: string;
  readonly pluginDir: string;
  /** §11 ZKS_RUN; main.ts empties it at startup. */
  readonly runDir: string;
  readonly claudePath: string | null;
  readonly claudeVersion: string | null;
  readonly secretStore: SecretStore;
  readonly query: QueryFunction;
  /** Without the SDK's bundled binary, sessions run through `claude -p` (plan §6.7). */
  readonly hasSdkBinary?: () => boolean;
  readonly engine: EngineRunner;
  readonly fetch?: FetchFunction;
}

export interface AgentServices {
  readonly terminalSessions: TerminalSessions;
  readonly agentRunner: "sdk" | "print";
  readonly registerRoutes: (app: Hono) => void;
  /** Kills every PTY and SDK child so none outlives the server. */
  readonly shutdown: () => void;
}

export function createAgentServices(deps: AgentServicesDeps): AgentServices {
  const broker = new DecisionBroker({ publish: (event) => deps.eventBus.publish(event) });
  const cancelProjectJobs = (projectId: string) => deps.jobRunner.cancelQueued(projectId).then(() => undefined);
  const toolContextFor = (projectId: string): ToolContext => ({
    projectId,
    studioHome: deps.studioHome,
    db: deps.database,
    events: deps.eventBus,
    jobs: deps.jobRunner,
    requestApproval: (card, signal) => broker.requestApproval(projectId, card, signal),
    askQuestions: (questions, signal) => broker.askQuestions(projectId, questions, signal),
  });

  const printSessions = choosePrintSessions(deps);
  const manager = new AgentManager({
    database: deps.database,
    secretStore: deps.secretStore,
    logger: deps.logger,
    studioHome: deps.studioHome,
    appVersion: deps.appVersion,
    pluginDir: deps.pluginDir,
    requiredSkills: REQUIRED_SKILLS,
    query: printSessions?.query ?? deps.query,
    broker,
    limits: SESSION_LIMITS,
    studioMcpServer: printSessions === undefined ? (project) => createStudioMcpServer(toolContextFor(project.id)) : null,
    cancelProjectJobs,
  });
  const terminalSessions = createTerminalSessions({
    ptyHost: createPtyHost({ claudePath: deps.claudePath ?? join(deps.runDir, MISSING_CLAUDE_NAME) }),
    eventBus: deps.eventBus,
    runDir: deps.runDir,
    appPort: deps.appPort,
    pluginDir: deps.pluginDir,
    studioToolNames: studioTwinCatalog().map((studioTool) => studioTool.qualifiedName),
    createToken: createSessionToken,
    tokensMatch,
    // ASSUMPTION: proxy opt-in is read per SDK start only; buildEnv is synchronous, so mode T keeps it off.
    buildEnv: (tokens) => buildAgentEnv({ kind: "terminal", tokens }, { studioHome: deps.studioHome, appVersion: deps.appVersion, proxyOptIn: false }),
    cancelProjectJobs,
    logger: deps.logger,
  });
  registerEngineJobHandlers(deps.jobRunner, { db: deps.database, studioHome: deps.studioHome, engine: deps.engine });

  const registerRoutes = (app: Hono) => {
    registerConnectRoutes(app, {
      database: deps.database,
      secretStore: deps.secretStore,
      fetch: deps.fetch ?? globalThis.fetch,
      logger: deps.logger,
      claudeVersion: deps.claudeVersion,
      onConnectionChanged: () => manager.closeAll(),
    });
    registerAgentRoutes(app, { database: deps.database, manager, terminal: terminalSessions });
    registerProjectTerminalRoutes(app, { database: deps.database, studioHome: deps.studioHome, model: TERMINAL_MODEL, sessions: terminalSessions });
    registerTerminalRoutes(app, {
      sessions: {
        find: (sessionId) => terminalSessions.find(sessionId),
        isHookAuthorized: (sessionId, token) =>
          terminalSessions.isHookAuthorized(sessionId, token) || printSessions?.isHookAuthorized(sessionId, token) === true,
        handleHook: (sessionId, payload) =>
          printSessions?.find(sessionId) === undefined ? terminalSessions.handleHook(sessionId, payload) : printSessions.handleHook(sessionId, payload),
      },
      tickets: createTicketStore(),
      checkWebSocketUpgrade,
      allowedHosts: allowedHostsFor(deps.appPort),
      allowedOrigin: `http://127.0.0.1:${deps.appPort}`,
      logger: deps.logger,
    });
    registerStudioToolRoutes(app, {
      findSession: (sessionId) => {
        const session = terminalSessions.find(sessionId);
        if (session !== undefined) {
          return {
            token: session.mcpToken,
            context: toolContextFor(session.projectId),
            isReady: () => terminalSessions.isMcpCallAllowed(sessionId, session.mcpToken),
          };
        }
        // A -p session is registered only while its child runs, so it is ready as soon as it exists.
        const printSession = printSessions?.find(sessionId);
        return printSession === undefined ? undefined : { token: printSession.mcpToken, context: toolContextFor(printSession.projectId), isReady: () => true };
      },
      tokensMatch,
    });
  };

  return {
    terminalSessions,
    agentRunner: printSessions === undefined ? "sdk" : "print",
    registerRoutes,
    shutdown: () => {
      terminalSessions.killAll();
      manager.closeAll();
    },
  };
}

function choosePrintSessions(deps: AgentServicesDeps): PrintSessions | undefined {
  // ASSUMPTION: with neither the SDK binary nor claude on PATH the SDK path stays, and its start error names the gap.
  if ((deps.hasSdkBinary ?? hasBundledClaudeBinary)() || deps.claudePath === null) return undefined;
  return createPrintSessions({
    claudePath: deps.claudePath,
    runDir: deps.runDir,
    appPort: deps.appPort,
    pluginDir: deps.pluginDir,
    createToken: createSessionToken,
    tokensMatch,
  });
}
