// Created by The Angelo Umali.
// Agent panel routes: prompt, decisions, stop and kill. Each resolves the project first so an unknown id is a 404.
import type { StudioDatabase } from "@zks/db";
import { API_ROUTES } from "@zks/shared";
import type { Context, Hono } from "hono";
import { readConnection } from "../auth/connection-store.ts";
import { HttpError, notFound, parseOrBadRequest, readJsonBody } from "../http/http-error.ts";
import { findProjectOrThrow } from "../projects/project-store.ts";
import type { TerminalSessions } from "../terminal/terminal-sessions.ts";
import type { AgentManager } from "./manager.ts";

const OK = { ok: true } as const;

export interface AgentRouteDeps {
  readonly database: StudioDatabase;
  readonly manager: Pick<AgentManager, "submit" | "decide" | "stop" | "kill">;
  /** Mode T: prompt, stop and kill go to the project's PTY instead of the SDK session. */
  readonly terminal?: Pick<TerminalSessions, "submitPrompt" | "stop" | "kill">;
}

export function registerAgentRoutes(app: Hono, deps: AgentRouteDeps): void {
  const projectOf = (c: Context) => findProjectOrThrow(deps.database, c.req.param("projectId") ?? "");
  const terminalInUse = async () => (deps.terminal !== undefined && (await readConnection(deps.database))?.mode === "terminal" ? deps.terminal : undefined);

  app.post(API_ROUTES.submitPrompt.path, async (c) => {
    const project = await projectOf(c);
    const { text } = parseOrBadRequest(API_ROUTES.submitPrompt.body, await readJsonBody(c));
    const terminal = await terminalInUse();
    if (terminal === undefined) await deps.manager.submit(project, text);
    else if (!terminal.submitPrompt(project.id, text)) throw new HttpError(409, "Open the terminal before sending a prompt");
    return c.json(OK);
  });

  app.post(API_ROUTES.decide.path, async (c) => {
    const project = await projectOf(c);
    const decision = parseOrBadRequest(API_ROUTES.decide.body, await readJsonBody(c));
    if (!deps.manager.decide(project.id, decision)) throw notFound();
    return c.json(OK);
  });

  app.post(API_ROUTES.stopTurn.path, async (c) => {
    const { id } = await projectOf(c);
    const terminal = await terminalInUse();
    if (terminal === undefined) await deps.manager.stop(id);
    else terminal.stop(id);
    return c.json(OK);
  });

  app.post(API_ROUTES.killSession.path, async (c) => {
    const { id } = await projectOf(c);
    const terminal = await terminalInUse();
    if (terminal === undefined) await deps.manager.kill(id);
    else terminal.kill(id);
    return c.json(OK);
  });
}
