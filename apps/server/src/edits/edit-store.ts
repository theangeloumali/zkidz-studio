// Created by The Angelo Umali.
// Edit rows in and out: the routes, the recorder's restart and the history block for new sessions all read through here.
import type { StudioDatabase } from "@zks/db";
import { edits, projects } from "@zks/db/schema";
import { EditSummarySchema, type EditFacts, type EditSummary } from "@zks/shared";
import { and, desc, eq, isNotNull } from "drizzle-orm";

export type EditRow = typeof edits.$inferSelect;

/** A closed edit as the history block shows it; tokens are input plus output, as the meter counts them. */
export interface FinishedEdit {
  readonly title: string;
  readonly finishedAt: Date;
  readonly durationMs: number;
  readonly costUsd: number | null;
  readonly tokens: number | null;
  readonly facts: EditFacts | null;
}

/** numeric columns come back as strings; parsing also narrows the text enum columns. */
function toEditSummaryDto(row: EditRow): EditSummary {
  const { exportJobId: _exportJobId, ...summary } = row;
  return EditSummarySchema.parse({
    ...summary,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    costUsd: numberOrNull(row.costUsd),
  });
}

export function numberOrNull(numeric: string | null): number | null {
  return numeric === null ? null : Number(numeric);
}

export async function listProjectEdits(database: StudioDatabase, projectId: string): Promise<EditSummary[]> {
  const rows = await database.select().from(edits).where(eq(edits.projectId, projectId)).orderBy(desc(edits.startedAt));
  return rows.map(toEditSummaryDto);
}

/** Each project's newest edit, newest project activity first. */
export async function listLatestEdits(database: StudioDatabase): Promise<EditSummary[]> {
  const rows = await database.selectDistinctOn([edits.projectId]).from(edits).orderBy(edits.projectId, desc(edits.startedAt));
  return rows.sort((first, second) => second.startedAt.getTime() - first.startedAt.getTime()).map(toEditSummaryDto);
}

export async function listOpenEdits(database: StudioDatabase): Promise<EditRow[]> {
  return database.select().from(edits).where(eq(edits.status, "open")).orderBy(desc(edits.startedAt));
}

export async function listRecentFinishedEdits(database: StudioDatabase, limit: number): Promise<FinishedEdit[]> {
  const rows = await database
    .select({ edit: edits, title: projects.title })
    .from(edits)
    .innerJoin(projects, eq(projects.id, edits.projectId))
    .where(and(eq(edits.status, "closed"), isNotNull(edits.finishedAt)))
    .orderBy(desc(edits.finishedAt))
    .limit(limit);
  return rows.flatMap(({ edit, title }) => (edit.finishedAt === null ? [] : [toFinishedEdit(edit, edit.finishedAt, title)]));
}

function toFinishedEdit(edit: EditRow, finishedAt: Date, title: string): FinishedEdit {
  const isTokenless = edit.inputTokens === null && edit.outputTokens === null && edit.cacheTokens === null;
  return {
    title,
    finishedAt,
    durationMs: finishedAt.getTime() - edit.startedAt.getTime(),
    costUsd: numberOrNull(edit.costUsd),
    // Cached input counts: a cached session reads almost all of its input from the cache.
    tokens: isTokenless ? null : (edit.inputTokens ?? 0) + (edit.outputTokens ?? 0) + (edit.cacheTokens ?? 0),
    facts: edit.facts,
  };
}
