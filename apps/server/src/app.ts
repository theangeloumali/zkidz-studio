// Created by The Angelo Umali.
// The Hono app: Kai's security middleware first, then the API, then the built web UI with an SPA fallback.
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import type { StudioDatabase } from "@zks/db";
import { Hono } from "hono";
import type { AgentServices } from "./agent-services.ts";
import type { EventBus } from "./events/event-bus.ts";
import { notFound, toHttpError } from "./http/http-error.ts";
import type { Logger } from "./logging/logger.ts";
import type { UploadLimits } from "./media-io/store.ts";
import { registerEventRoutes } from "./routes/events.ts";
import { registerFsRoutes } from "./routes/fs.ts";
import { registerJobRoutes } from "./routes/jobs.ts";
import { registerMediaStreamRoute } from "./routes/media-stream.ts";
import { registerMediaRoutes } from "./routes/media.ts";
import { registerProjectRoutes } from "./routes/projects.ts";
import type { Security } from "./security/index.ts";

export interface AppDependencies {
  readonly database: StudioDatabase;
  readonly studioHome: string;
  readonly security: Pick<Security, "middleware" | "confinePath">;
  readonly eventBus: EventBus;
  readonly ffprobePath: string;
  readonly uploadLimits: UploadLimits;
  readonly webDistDir: string;
  readonly logger: Logger;
  /** The Phase 2 connect, agent, terminal and studio-tool routes; main.ts always passes it. */
  readonly agent?: Pick<AgentServices, "registerRoutes">;
}

export function createApp(deps: AppDependencies): Hono {
  const app = new Hono();
  app.use("*", deps.security.middleware);

  registerProjectRoutes(app, deps);
  registerMediaRoutes(app, deps);
  registerMediaStreamRoute(app, { ...deps, confinePath: deps.security.confinePath });
  registerFsRoutes(app, deps);
  registerJobRoutes(app, deps.database);
  registerEventRoutes(app, deps.eventBus);
  deps.agent?.registerRoutes(app);
  app.all("/api/*", () => {
    throw notFound();
  });

  // serveStatic resolves `root` against cwd, so the dist path is made relative to it.
  app.use("*", serveStatic({ root: relative(process.cwd(), deps.webDistDir) }));
  app.get("*", async (c) => {
    const indexHtml = await readFile(join(deps.webDistDir, "index.html"), "utf8").catch(() => null);
    return indexHtml === null ? c.json({ error: "Not found" }, 404) : c.html(indexHtml);
  });

  app.onError((error, c) => {
    const httpError = toHttpError(error);
    if (httpError.status >= 500) deps.logger.error("request failed", { method: c.req.method, path: c.req.path, error });
    return c.json({ error: httpError.message }, httpError.status);
  });
  return app;
}
