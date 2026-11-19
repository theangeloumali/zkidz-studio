// Created by The Angelo Umali.
import type { Stats } from "@zks/shared";

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

export function percent(part: number, whole: number): string | null {
  return whole === 0 ? null : `${Math.round((part / whole) * 100)}%`;
}

export function jobTotals(stats: Stats): { readonly jobs: number; readonly failed: number; readonly finished: number } {
  const countOf = (outcome?: string) => sum(stats.jobsByWeek.filter((row) => outcome === undefined || row.outcome === outcome).map((row) => row.count));
  const failed = countOf("failed");
  return { jobs: countOf(), failed, finished: failed + countOf("succeeded") };
}

export const jobKindLabel = (kind: string) => kind.replaceAll("_", " ");
