// Created by The Angelo Umali.
import type { StudioDatabase } from "@zks/db";
import { API_ROUTES } from "@zks/shared";
import type { Hono } from "hono";
import { parseOrBadRequest } from "../http/http-error.ts";
import { readStats } from "./stats-store.ts";

export function registerStatsRoutes(app: Hono, deps: { readonly database: StudioDatabase }): void {
  app.get(API_ROUTES.getStats.path, async (c) => {
    const { range } = parseOrBadRequest(API_ROUTES.getStats.query, c.req.query());
    return c.json(await readStats(deps.database, range));
  });
}
