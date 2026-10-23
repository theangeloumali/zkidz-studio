// Created by The Angelo Umali.
// Shared setup for the jobs tests: a runner over the test server's database, and row reads.
import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { jobs } from "@zks/db/schema";
import { eq } from "drizzle-orm";
import { JobRunner } from "../../src/jobs/job-runner.ts";
import { findLatestMaster } from "../../src/jobs/master-files.ts";
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

/** What a passing `zks-engine qc-status --video <v>` prints: the newest master in <workDir>/out, named as QC judged it. */
export async function passingQcVerdict(workDir: string, videoId: string) {
  const projectRoot = dirname(workDir);
  const master = await findLatestMaster(projectRoot, videoId);
  if (master === undefined) throw new Error(`zks-engine qc-status failed: ${videoId} has no master`);
  const stats = await stat(join(projectRoot, master.relPath), { bigint: true });
  return { ok: true, master: master.relPath.replace(/^work\//, ""), bytes: Number(stats.size), mtimeNs: String(stats.mtimeNs) };
}

/** Resolves once the handler has started, so a test can act while the job is running. */
export function startedSignal() {
  const { promise, resolve } = Promise.withResolvers<void>();
  return { hasStarted: promise, markStarted: resolve };
}
