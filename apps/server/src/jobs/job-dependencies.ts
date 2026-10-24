// Created by The Angelo Umali.
// Dependency chains: a job waits on every id in depends_on, and one failed or cancelled dependency cancels it.
import type { StudioDatabase } from "@zks/db";
import { jobs } from "@zks/db/schema";
import { and, eq, exists, inArray, ne, notExists, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { JobRow } from "../dto.ts";

const dependency = alias(jobs, "dependency");
const DEAD_END_STATUSES = ["failed", "cancelled"] as const;
const DEPENDENCY_FAILED_ERROR = "Cancelled: a job it depends on failed or was cancelled";

function dependenciesWhere(database: StudioDatabase, condition: SQL) {
  return database
    .select({ id: dependency.id })
    .from(dependency)
    .where(and(sql`${dependency.id} = any(${jobs.dependsOn})`, condition));
}

/** True for a job whose dependencies have all succeeded. An interrupted one keeps it waiting, since it can resume. */
export function hasDependenciesMet(database: StudioDatabase): SQL {
  return notExists(dependenciesWhere(database, ne(dependency.status, "succeeded")));
}

export async function assertSameProjectDependencies(database: StudioDatabase, projectId: string, dependsOn: readonly string[]): Promise<void> {
  const uniqueIds = [...new Set(dependsOn)];
  if (uniqueIds.length === 0) return;
  const found = await database
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(inArray(jobs.id, uniqueIds), eq(jobs.projectId, projectId)));
  if (found.length !== uniqueIds.length) throw new Error("dependsOn names a job id that is not a job of this project");
}

/** Cancels queued jobs downstream of a dead end, repeating until the whole chain is cancelled. */
export async function cancelBlockedDependents(database: StudioDatabase): Promise<JobRow[]> {
  const cancelled: JobRow[] = [];
  for (;;) {
    const batch = await database
      .update(jobs)
      .set({ status: "cancelled", error: DEPENDENCY_FAILED_ERROR, finishedAt: new Date() })
      .where(and(eq(jobs.status, "queued"), exists(dependenciesWhere(database, inArray(dependency.status, DEAD_END_STATUSES)))))
      .returning();
    if (batch.length === 0) return cancelled;
    cancelled.push(...batch);
  }
}
