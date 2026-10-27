// Created by The Angelo Umali.
// Spec history routes and the cut-candidate decision route.
import type { StudioDatabase } from "@zks/db";
import { API_ROUTES, CutReviewDecisionSchema, SpecKindSchema, VideoIdSchema } from "@zks/shared";
import type { Context, Hono } from "hono";
import type { EventBus } from "../events/event-bus.ts";
import { notFound, parseOrBadRequest, readJsonBody } from "../http/http-error.ts";
import { findProjectOrThrow } from "../projects/project-store.ts";
import { resolveCutReview } from "../tools/cut-review.ts";
import type { SpecAddress } from "./spec-files.ts";
import { listSpecSummaries, listSpecVersions, readSpecVersion, restoreSpecVersion } from "./spec-versions.ts";

export interface SpecRouteDependencies {
  readonly database: StudioDatabase;
  readonly eventBus: EventBus;
  readonly studioHome: string;
}

export function registerSpecRoutes(app: Hono, deps: SpecRouteDependencies): void {
  const { database } = deps;

  app.get(API_ROUTES.listSpecs.path, async (c) => {
    const project = await findProjectOrThrow(database, c.req.param("projectId"));
    return c.json({ specs: await listSpecSummaries(database, project.id) });
  });

  app.get(API_ROUTES.listSpecVersions.path, async (c) => {
    const project = await findProjectOrThrow(database, c.req.param("projectId"));
    return c.json({ versions: await listSpecVersions(database, project.id, specAddressOf(c)) });
  });

  app.get(API_ROUTES.getSpecVersion.path, async (c) => {
    const project = await findProjectOrThrow(database, c.req.param("projectId"));
    const query = parseOrBadRequest(API_ROUTES.getSpecVersion.query, c.req.query());
    return c.json(await readSpecVersion(database, project.id, specAddressOf(c), query.version));
  });

  app.post(API_ROUTES.restoreSpecVersion.path, async (c) => {
    const project = await findProjectOrThrow(database, c.req.param("projectId"));
    const address = specAddressOf(c);
    const body = parseOrBadRequest(API_ROUTES.restoreSpecVersion.body, await readJsonBody(c));
    return c.json(await restoreSpecVersion({ ...deps, project }, address, body.version));
  });

  app.post(API_ROUTES.decideCutCandidates.path, async (c) => {
    const project = await findProjectOrThrow(database, c.req.param("projectId"));
    const decision = parseOrBadRequest(CutReviewDecisionSchema, await readJsonBody(c));
    if (!resolveCutReview(project.id, c.req.param("requestId"), decision)) throw notFound();
    return c.json({ ok: true as const });
  });
}

/** An unknown kind or a malformed video id names no spec, so it is a 404. */
function specAddressOf(c: Context): SpecAddress {
  const videoId = VideoIdSchema.safeParse(c.req.param("videoId"));
  const kind = SpecKindSchema.safeParse(c.req.param("kind"));
  if (!videoId.success || !kind.success) throw notFound();
  return { videoId: videoId.data, kind: kind.data };
}
