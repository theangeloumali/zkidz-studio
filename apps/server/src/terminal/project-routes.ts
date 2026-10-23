// Created by The Angelo Umali.
// Opens or reattaches a project's mode T terminal (plan §6.3). The folder and resume id come from the server, never the request.
import type { StudioDatabase } from "@zks/db";
import { API_ROUTES } from "@zks/shared";
import type { Hono } from "hono";
import { findResumeSessionId, recordCurrentSession } from "../agent/session-records.ts";
import { readConnection } from "../auth/connection-store.ts";
import { projectDir } from "../config.ts";
import type { ProjectRow } from "../dto.ts";
import { HttpError } from "../http/http-error.ts";
import { findProjectOrThrow } from "../projects/project-store.ts";
import { loadRulesPromptBlock } from "../rules/session-setup.ts";
import type { TerminalSession, TerminalSessions } from "./terminal-sessions.ts";

const TERMINAL_AUTH_MODES = ["terminal"] as const;

export interface ProjectTerminalRouteDeps {
  readonly database: StudioDatabase;
  readonly studioHome: string;
  readonly model?: string;
  readonly sessions: Pick<TerminalSessions, "open" | "findByProject">;
}

export function registerProjectTerminalRoutes(app: Hono, deps: ProjectTerminalRouteDeps): void {
  // Two opens racing in before the first spawn finishes share one PTY.
  const opening = new Map<string, Promise<TerminalSession>>();

  const openOnce = (project: ProjectRow): Promise<TerminalSession> => {
    const pending = opening.get(project.id) ?? openSession(deps, project).finally(() => opening.delete(project.id));
    opening.set(project.id, pending);
    return pending;
  };

  app.post(API_ROUTES.openTerminal.path, async (c) => {
    const project = await findProjectOrThrow(deps.database, c.req.param("projectId") ?? "");
    const connection = await readConnection(deps.database);
    if (connection?.mode !== "terminal") throw new HttpError(409, "Turn on terminal mode before opening the terminal");
    const session = deps.sessions.findByProject(project.id) ?? (await openOnce(project));
    return c.json({ sessionId: session.sessionId });
  });
}

async function openSession(deps: ProjectTerminalRouteDeps, project: ProjectRow): Promise<TerminalSession> {
  const { database, model } = deps;
  const [resumeSessionId, rulesText] = await Promise.all([findResumeSessionId(database, project.id, TERMINAL_AUTH_MODES), loadRulesPromptBlock(database)]);
  const session = await deps.sessions.open({
    projectId: project.id,
    projectDir: projectDir(deps.studioHome, project.slug),
    model,
    rulesText,
    ...(resumeSessionId === undefined ? {} : { resumeSessionId }),
  });
  await recordCurrentSession(database, { projectId: project.id, sdkSessionId: session.sessionId, model: model ?? null, authMode: "terminal" });
  return session;
}
