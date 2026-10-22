// Created by The Angelo Umali.
import type { StudioDatabase } from "@zks/db";
import { jobs } from "@zks/db/schema";
import { API_ROUTES } from "@zks/shared";
import { desc, eq } from "drizzle-orm";
import type { Hono } from "hono";
import { toJobDto } from "../dto.ts";
import { findProjectOrThrow } from "../projects/project-store.ts";

export function registerJobRoutes(app: Hono, database: StudioDatabase): void {
  app.get(API_ROUTES.listJobs.path, async (c) => {
    const project = await findProjectOrThrow(database, c.req.param("projectId"));
    const rows = await database.select().from(jobs).where(eq(jobs.projectId, project.id)).orderBy(desc(jobs.queuedAt));
    return c.json({ jobs: rows.map(toJobDto) });
  });
}
