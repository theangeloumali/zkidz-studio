// Created by The Angelo Umali.
// Reads /stats from the projects, jobs, edits and deliverables tables; no table of its own.
import type { StudioDatabase } from "@zks/db";
import { deliverables, edits, jobs, projects } from "@zks/db/schema";
import { PROJECT_STATUSES, type Stats, type StatsRange } from "@zks/shared";
import { count, desc, eq, gte, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { countBy, isoWeekOf, median, rangeStart } from "./stats-math.ts";

const MAX_RECENT_JOBS = 10;
const MAX_EDITS = 50;
const MS_PER_S = 1000;
const isFinishedStatus = (status: string): status is "succeeded" | "failed" => status === "succeeded" || status === "failed";

const since = (column: PgColumn, start: Date | null): SQL | undefined => (start === null ? undefined : gte(column, start));
const secondsBetween = (from: Date, to: Date) => (to.getTime() - from.getTime()) / MS_PER_S;

export async function readStats(database: StudioDatabase, range: StatsRange, now = new Date()): Promise<Stats> {
  const start = rangeStart(range, now);
  const [projectCounts, jobRows, editRows, deliverableRows, anyEdit] = await Promise.all([
    database.select({ status: projects.status, count: count() }).from(projects).groupBy(projects.status),
    database
      .select({
        id: jobs.id,
        kind: jobs.kind,
        status: jobs.status,
        error: jobs.error,
        queuedAt: jobs.queuedAt,
        startedAt: jobs.startedAt,
        finishedAt: jobs.finishedAt,
        projectTitle: projects.title,
      })
      .from(jobs)
      .innerJoin(projects, eq(projects.id, jobs.projectId))
      .where(since(jobs.queuedAt, start))
      .orderBy(desc(jobs.queuedAt)),
    database
      .select({
        id: edits.id,
        startedAt: edits.startedAt,
        turns: edits.turns,
        inputTokens: edits.inputTokens,
        outputTokens: edits.outputTokens,
        cacheTokens: edits.cacheTokens,
        facts: edits.facts,
        projectTitle: projects.title,
      })
      .from(edits)
      .innerJoin(projects, eq(projects.id, edits.projectId))
      .where(since(edits.startedAt, start))
      .orderBy(desc(edits.startedAt)),
    database.select({ createdAt: deliverables.createdAt }).from(deliverables).where(since(deliverables.createdAt, start)),
    database.select({ id: edits.id }).from(edits).limit(1),
  ]);

  const finished = jobRows.flatMap((job) =>
    isFinishedStatus(job.status) && job.startedAt !== null && job.finishedAt !== null
      ? [{ ...job, status: job.status, startedAt: job.startedAt, finishedAt: job.finishedAt }]
      : [],
  );
  const jobGroups = countBy(jobRows, (job) => `${isoWeekOf(job.queuedAt)}|${job.kind}|${job.status}`);
  const deliverableGroups = countBy(deliverableRows, (row) => isoWeekOf(row.createdAt));

  return {
    range,
    hasAnyEdit: anyEdit.length > 0,
    projectsByStatus: PROJECT_STATUSES.map((status) => ({ status, count: projectCounts.find((row) => row.status === status)?.count ?? 0 })),
    jobsByWeek: [...jobGroups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, { sample, count: jobCount }]) => ({ week: isoWeekOf(sample.queuedAt), kind: sample.kind, outcome: sample.status, count: jobCount })),
    medianRunS: median(finished.map((job) => secondsBetween(job.startedAt, job.finishedAt))),
    medianQueueWaitS: median(finished.map((job) => secondsBetween(job.queuedAt, job.startedAt))),
    recentJobs: finished
      .toSorted((left, right) => right.finishedAt.getTime() - left.finishedAt.getTime())
      .slice(0, MAX_RECENT_JOBS)
      .map((job) => ({
        jobId: job.id,
        projectTitle: job.projectTitle,
        kind: job.kind,
        outcome: job.status,
        runS: secondsBetween(job.startedAt, job.finishedAt),
        error: job.error,
        finishedAt: job.finishedAt.toISOString(),
      })),
    edits: editRows.slice(0, MAX_EDITS).map((edit) => ({
      id: edit.id,
      projectTitle: edit.projectTitle,
      startedAt: edit.startedAt.toISOString(),
      turns: edit.turns,
      tokens: totalTokens(edit),
    })),
    footage: {
      keptS: editRows.reduce((sum, edit) => sum + (edit.facts?.keptS ?? 0), 0),
      sourceS: editRows.reduce((sum, edit) => sum + (edit.facts?.sourceS ?? 0), 0),
    },
    deliverablesByWeek: [...deliverableGroups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([week, { count: weekCount }]) => ({ week, count: weekCount })),
  };
}

function totalTokens(edit: { inputTokens: number | null; outputTokens: number | null; cacheTokens: number | null }): number | null {
  const parts = [edit.inputTokens, edit.outputTokens, edit.cacheTokens].filter((tokens) => tokens !== null);
  return parts.length === 0 ? null : parts.reduce((sum, tokens) => sum + tokens, 0);
}
