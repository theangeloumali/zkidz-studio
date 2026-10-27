// Created by The Angelo Umali.
// One migrated PGlite + ZKS_HOME per test file, and the app built exactly as main.ts builds it.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, type StudioDatabaseHandle } from "@zks/db";
import { projects } from "@zks/db/schema";
import type { Hono } from "hono";
import { createApp, type AppDependencies } from "../../src/app.ts";
import { ensureStudioHome } from "../../src/config.ts";
import { EventBus } from "../../src/events/event-bus.ts";
import { JobRunner } from "../../src/jobs/job-runner.ts";
import { createLogger } from "../../src/logging/logger.ts";
import { DEFAULT_UPLOAD_LIMITS } from "../../src/media-io/store.ts";
import { confinePath } from "../../src/security/confine-path.ts";
import { passthroughSecurity } from "./security-double.ts";

export const TEST_HOST = "127.0.0.1:4317";

export interface TestServer {
  readonly app: Hono;
  readonly database: StudioDatabaseHandle;
  readonly eventBus: EventBus;
  readonly jobRunner: JobRunner;
  readonly studioHome: string;
  readonly scratchDir: string;
  readonly logLines: string[];
  readonly close: () => Promise<void>;
}

/** What a function override sees, so app deps such as the agent services can be built over the same database. */
export type TestServerBase = Pick<TestServer, "eventBus" | "jobRunner" | "studioHome" | "scratchDir"> & {
  readonly database: StudioDatabaseHandle;
  readonly logger: AppDependencies["logger"];
};

export async function createTestServer(overrides: Partial<AppDependencies> | ((base: TestServerBase) => Partial<AppDependencies>) = {}): Promise<TestServer> {
  const scratchDir = await mkdtemp(join(tmpdir(), "zks-server-"));
  const studioHome = join(scratchDir, "home");
  await ensureStudioHome(studioHome);
  const database = await openDatabase({ dataDir: join(studioHome, "db") });
  await database.migrate();
  const logLines: string[] = [];
  const logger = createLogger((line) => logLines.push(line));
  const eventBus = new EventBus(database.db);
  const jobRunner = new JobRunner({ database: database.db, eventBus, logger });
  const appOverrides = typeof overrides === "function" ? overrides({ database, eventBus, jobRunner, studioHome, scratchDir, logger }) : overrides;
  const app = createApp({
    database: database.db,
    studioHome,
    security: { ...passthroughSecurity, confinePath },
    eventBus,
    ffprobePath: "ffprobe",
    uploadLimits: DEFAULT_UPLOAD_LIMITS,
    webDistDir: join(scratchDir, "web-dist"),
    logger,
    jobRunner,
    ...appOverrides,
  });
  return {
    app,
    database,
    eventBus,
    jobRunner,
    studioHome,
    scratchDir,
    logLines,
    close: async () => {
      await jobRunner.idle();
      await database.close().catch(() => undefined); // app.test closes one early on purpose
      await rm(scratchDir, { recursive: true, force: true });
    },
  };
}

export async function insertProject(server: TestServer, slug = `p-${crypto.randomUUID().slice(0, 8)}`) {
  const [project] = await server.database.db.insert(projects).values({ slug, title: slug }).returning();
  if (project === undefined) throw new Error("project insert returned no row");
  return project;
}

/** What @hono/node-server passes as env; getConnInfo reads the peer address from it. */
export function connectionFrom(remoteAddress: string) {
  return { incoming: { socket: { remoteAddress } } };
}

export function getRequest(server: TestServer, path: string, headers: Record<string, string> = {}) {
  return server.app.request(path, { headers: { host: TEST_HOST, ...headers } }, connectionFrom("127.0.0.1"));
}

export function postJson(server: TestServer, path: string, body: unknown) {
  const init = { method: "POST", headers: { host: TEST_HOST, "content-type": "application/json" }, body: JSON.stringify(body) };
  return server.app.request(path, init, connectionFrom("127.0.0.1"));
}
