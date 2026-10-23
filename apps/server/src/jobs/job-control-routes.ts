// Created by The Angelo Umali.
// The UI's half of job control: resume an interrupted job (plan §6.12). Stop's cancel half runs through the agent's stop route.
import type { StudioDatabase } from "@zks/db";
import { jobs } from "@zks/db/schema";
import { API_ROUTES } from "@zks/shared";
import { and, eq } from "drizzle-orm";
import type { Hono } from "hono";
import { toJobDto } from "../dto.ts";
import { HttpError, notFound } from "../http/http-error.ts";
import { assertLoopbackPeer } from "../http/loopback-peer.ts";
import type { JobRunner } from "./job-runner.ts";

export interface JobControlRouteDeps {
  readonly database: StudioDatabase;
  readonly jobRunner: Pick<JobRunner, "resume">;
}

export function registerJobControlRoutes(app: Hono, deps: JobControlRouteDeps): void {
  // A resume restarts GPU work on this machine, so it is held to the same loopback rule as the reveal.
  app.post(API_ROUTES.resumeJob.path, async (c) => {
    assertLoopbackPeer(c);
    const [job] = await deps.database
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, c.req.param("jobId")), eq(jobs.projectId, c.req.param("projectId"))));
    if (job === undefined) throw notFound();
    if (job.status !== "interrupted") throw new HttpError(409, `Only an interrupted job can resume; this one is ${job.status}`);
    return c.json({ job: toJobDto(await deps.jobRunner.resume(job.id)) });
  });
}
