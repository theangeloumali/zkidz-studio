// Created by The Angelo Umali.
// GET /api/hardware and GET /api/projects/:projectId/qc for the Render screen (plan §9.1).
import type { StudioDatabase } from "@zks/db";
import { API_ROUTES } from "@zks/shared";
import type { Hono } from "hono";
import { projectDir } from "../config.ts";
import { findProjectOrThrow } from "../projects/project-store.ts";
import { describeHardware, SYSTEM_METER_READERS, type HardwareMeterReaders } from "./hardware.ts";
import { readRenderProfile } from "./master-files.ts";
import { listQcChecks } from "./qc-checks.ts";

export interface RenderStatusRouteDeps {
  readonly database: StudioDatabase;
  readonly studioHome: string;
  readonly meterReaders?: HardwareMeterReaders;
}

export function registerRenderStatusRoutes(app: Hono, deps: RenderStatusRouteDeps): void {
  app.get(API_ROUTES.getHardware.path, async (c) => {
    const profile = await readRenderProfile(deps.studioHome);
    if (profile === undefined) return c.json(null);
    return c.json(await describeHardware(profile, deps.meterReaders ?? SYSTEM_METER_READERS));
  });

  app.get(API_ROUTES.listQcChecks.path, async (c) => {
    const project = await findProjectOrThrow(deps.database, c.req.param("projectId"));
    return c.json({ checks: await listQcChecks(projectDir(deps.studioHome, project.slug), project.videoId) });
  });
}
