// Created by The Angelo Umali.
// GET and PUT /api/projects/:projectId/style: the Style panel's read and write of the project's look (slice D).
import { API_ROUTES } from "@zks/shared";
import type { Hono } from "hono";
import { parseOrBadRequest, readJsonBody } from "../http/http-error.ts";
import { readProjectStyle, writeProjectStyle, type StyleStore } from "../projects/project-style.ts";
import { findProjectOrThrow } from "../projects/project-store.ts";

export function registerStyleRoutes(app: Hono, deps: StyleStore): void {
  app.get(API_ROUTES.getProjectStyle.path, async (c) => {
    const project = await findProjectOrThrow(deps.database, c.req.param("projectId"));
    return c.json({ style: await readProjectStyle(deps.database, project) });
  });

  app.put(API_ROUTES.setProjectStyle.path, async (c) => {
    const project = await findProjectOrThrow(deps.database, c.req.param("projectId"));
    const { style } = parseOrBadRequest(API_ROUTES.setProjectStyle.body, await readJsonBody(c));
    return c.json({ style: (await writeProjectStyle(deps, project, style)).style });
  });
}
