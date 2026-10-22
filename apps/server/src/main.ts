// Created by The Angelo Umali.
// Entry point: open ZKS_HOME and the database, refuse a non-loopback bind, recover dead jobs, then serve.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { openDatabase } from "@zks/db";
import { LOOPBACK_HOST, PREVIEW_PORT } from "@zks/shared";
import { createApp } from "./app.ts";
import { ensureStudioHome, loadServerConfig } from "./config.ts";
import { EventBus } from "./events/event-bus.ts";
import { JobRunner } from "./jobs/job-runner.ts";
import { createLogger } from "./logging/logger.ts";
import { DEFAULT_UPLOAD_LIMITS } from "./media-io/store.ts";
import { createSecurity } from "./security/index.ts";

const WEB_DIST_DIR = fileURLToPath(new URL("../../web/dist", import.meta.url));
/** Inside the container the port mapping is the loopback boundary (plan §3.4). */
const CONTAINER_BIND_HOST = "0.0.0.0";

async function main(): Promise<void> {
  const logger = createLogger();
  const config = loadServerConfig(process.env);
  const security = createSecurity({ appPort: config.port, previewPort: PREVIEW_PORT, container: config.isContainer });
  const bindHost = config.isContainer ? CONTAINER_BIND_HOST : LOOPBACK_HOST;
  security.assertLoopbackBind(bindHost);

  await ensureStudioHome(config.studioHome);
  const database = await openDatabase({ dataDir: join(config.studioHome, "db"), databaseUrl: config.databaseUrl });
  await database.migrate();
  const eventBus = new EventBus(database.db);
  const jobRunner = new JobRunner({ database: database.db, eventBus, logger });
  const interruptedJobs = await jobRunner.recoverInterrupted();
  if (interruptedJobs > 0) logger.warn("marked jobs from a previous run as interrupted", { count: interruptedJobs });

  const app = createApp({
    database: database.db,
    studioHome: config.studioHome,
    security,
    eventBus,
    ffprobePath: config.ffprobePath,
    uploadLimits: DEFAULT_UPLOAD_LIMITS,
    webDistDir: WEB_DIST_DIR,
    logger,
  });
  const server = serve({ fetch: app.fetch, hostname: bindHost, port: config.port }, (address) => {
    logger.info("studio server listening", { host: bindHost, port: address.port, backend: database.backend });
  });

  const shutdown = (signal: string) => {
    logger.info("shutting down", { signal });
    server.close(() => {
      void jobRunner
        .idle()
        .then(() => database.close())
        .finally(() => process.exit(0));
    });
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  createLogger().error("studio server failed to start", { error });
  process.exitCode = 1;
});
