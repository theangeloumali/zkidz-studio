// Created by The Angelo Umali.
// Shared setup for the jobs tests: a runner over the test server's database, and row reads.
import { jobs } from "@zks/db/schema";
import { eq } from "drizzle-orm";
import { JobRunner } from "../../src/jobs/job-runner.ts";
import { createLogger } from "../../src/logging/logger.ts";
import type { TestServer } from "../support/test-server.ts";

export function newRunner(server: TestServer): JobRunner {
  return new JobRunner({ database: server.database.db, eventBus: server.eventBus, logger: createLogger(() => undefined) });
}

export async function readJob(server: TestServer, jobId: string) {
  const [row] = await server.database.db.select().from(jobs).where(eq(jobs.id, jobId));
  if (row === undefined) throw new Error(`job ${jobId} is missing`);
  return row;
}

/** Resolves once the handler has started, so a test can act while the job is running. */
export function startedSignal() {
  const { promise, resolve } = Promise.withResolvers<void>();
  return { hasStarted: promise, markStarted: resolve };
}
