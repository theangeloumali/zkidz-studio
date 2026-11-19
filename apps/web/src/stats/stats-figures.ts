// Created by The Angelo Umali.
import type { Stats } from "@zks/shared";

export interface WeekRow {
  readonly week: string;
  readonly jobs: number;
  readonly failed: number;
  readonly deliverables: number;
}

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

export function percent(part: number, whole: number): string | null {
  return whole === 0 ? null : `${Math.round((part / whole) * 100)}%`;
}

export function jobTotals(stats: Stats): { readonly jobs: number; readonly failed: number; readonly finished: number } {
  const countOf = (outcome?: string) => sum(stats.jobsByWeek.filter((row) => outcome === undefined || row.outcome === outcome).map((row) => row.count));
  const failed = countOf("failed");
  return { jobs: countOf(), failed, finished: failed + countOf("succeeded") };
}

/** One row per ISO week that had a job or a deliverable, oldest first. */
export function weekRows(stats: Stats): WeekRow[] {
  const weeks = [...new Set([...stats.jobsByWeek.map((row) => row.week), ...stats.deliverablesByWeek.map((row) => row.week)])].sort();
  return weeks.map((week) => {
    const jobs = stats.jobsByWeek.filter((row) => row.week === week);
    return {
      week,
      jobs: sum(jobs.map((row) => row.count)),
      failed: sum(jobs.filter((row) => row.outcome === "failed").map((row) => row.count)),
      deliverables: stats.deliverablesByWeek.find((row) => row.week === week)?.count ?? 0,
    };
  });
}

export const jobKindLabel = (kind: string) => kind.replaceAll("_", " ");
