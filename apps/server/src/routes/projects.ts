// Created by The Angelo Umali.
import type { StudioDatabase } from "@zks/db";
import { projects } from "@zks/db/schema";
import { API_ROUTES } from "@zks/shared";
import { desc } from "drizzle-orm";
import type { Hono } from "hono";
import { toProjectDto } from "../dto.ts";
import { parseOrBadRequest, readJsonBody } from "../http/http-error.ts";
import { createProject, findProjectOrThrow } from "../projects/project-store.ts";

export function registerProjectRoutes(app: Hono, deps: { readonly database: StudioDatabase; readonly studioHome: string }): void {
  app.get(API_ROUTES.listProjects.path, async (c) => {
    const rows = await deps.database.select().from(projects).orderBy(desc(projects.createdAt));
    return c.json({ projects: rows.map(toProjectDto) });
  });

  app.post(API_ROUTES.createProject.path, async (c) => {
    const { title } = parseOrBadRequest(API_ROUTES.createProject.body, await readJsonBody(c));
    const project = await createProject(deps.database, deps.studioHome, title);
    return c.json(toProjectDto(project), 201);
  });

  app.get(API_ROUTES.getProject.path, async (c) => {
    return c.json(toProjectDto(await findProjectOrThrow(deps.database, c.req.param("projectId"))));
  });
}
