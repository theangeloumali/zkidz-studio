// Created by The Angelo Umali.
// A size cap on every JSON API body, so a client cannot make the server buffer an unbounded request.
import { API_ROUTES } from "@zks/shared";
import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

export const JSON_BODY_MAX_BYTES = 64 * 1024;

/** Uploads have their own streaming caps; hook payloads carry Claude Code's tool output, which can be large. */
const UNCAPPED_ROUTES: ReadonlySet<unknown> = new Set([API_ROUTES.terminalHooks]);

/** Register before the routes: Hono runs matching handlers in registration order. */
export function registerJsonBodyLimit(app: Hono): void {
  const limit = bodyLimit({ maxSize: JSON_BODY_MAX_BYTES, onError: (c) => c.json({ error: "The request body is too large" }, 413) });
  for (const route of Object.values(API_ROUTES)) {
    if (route.method === "GET" || route.body === "binary" || UNCAPPED_ROUTES.has(route)) continue;
    app.on(route.method, route.path, limit);
  }
}
