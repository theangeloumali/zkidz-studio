// Created by The Angelo Umali.
// Agent panel routes: prompt, decisions, stop and kill. Each resolves the project first so an unknown id is a 404.
import type { StudioDatabase } from "@zks/db";
import { API_ROUTES } from "@zks/shared";
import type { Context, Hono } from "hono";
import { readConnection } from "../auth/connection-store.ts";
import type { ProjectRow } from "../dto.ts";
import { HttpError, notFound, parseOrBadRequest, readJsonBody } from "../http/http-error.ts";
import { findProjectOrThrow } from "../projects/project-store.ts";
import type { TerminalSessions } from "../terminal/terminal-sessions.ts";
import type { AgentManager } from "./manager.ts";

const OK = { ok: true } as const;

export interface AgentRouteDeps {
  readonly database: StudioDatabase;
  readonly manager: Pick<AgentManager, "submit" | "decide" | "stop" | "kill">;
  /** Mode T: prompt, stop and kill go to the project's PTY instead of the SDK session. */
  readonly terminal?: {
    readonly sessions: Pick<TerminalSessions, "submitPrompt" | "stop" | "kill">;
    /** A prompt opens the project's terminal when none is live; the sessions hold it until SessionStart. */
    readonly open: (project: ProjectRow) => Promise<unknown>;
  };
}

export function registerAgentRoutes(app: Hono, deps: AgentRouteDeps): void {
  const projectOf = (c: Context) => findProjectOrThrow(deps.database, c.req.param("projectId") ?? "");
  const terminalInUse = async () => (deps.terminal !== undefined && (await readConnection(deps.database))?.mode === "terminal" ? deps.terminal : undefined);

  app.post(API_ROUTES.submitPrompt.path, async (c) => {
    const project = await projectOf(c);
    const { text } = parseOrBadRequest(API_ROUTES.submitPrompt.body, await readJsonBody(c));
    const terminal = await terminalInUse();
    if (terminal === undefined) {
      await deps.manager.submit(project, text);
      return c.json(OK);
    }
    await terminal.open(project);
    // The PTY can exit between the open and the write; the user reopens the Terminal tab and resends.
    if (!terminal.sessions.submitPrompt(project.id, text))
      throw new HttpError(409, "The terminal closed before the prompt was sent. Open it again and resend.");
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
    else terminal.sessions.stop(id);
    return c.json(OK);
  });

  app.post(API_ROUTES.killSession.path, async (c) => {
    const { id } = await projectOf(c);
    const terminal = await terminalInUse();
    if (terminal === undefined) await deps.manager.kill(id);
    else terminal.sessions.kill(id);
    return c.json(OK);
  });
}
