// Created by The Angelo Umali.
// Plan §9.5's budgets. A check records its value under `perf:<key>`; budget-reporter.ts prints every row against these limits.
import { expect, test } from "@playwright/test";

interface Budget {
  readonly label: string;
  readonly limit: number;
  readonly unit: "kB" | "MB" | "ms";
}

export const BUDGETS = {
  initialJs: { label: "Initial JS (gzip)", limit: 250, unit: "kB" },
  firstContentfulPaint: { label: "FCP on localhost", limit: 1_000, unit: "ms" },
  feedRowPaint: { label: "Server event → painted feed row (p95 of 40)", limit: 250, unit: "ms" },
  previewCatchUp: { label: "Spec change → preview re-seeked (slowest of 40)", limit: 3_000, unit: "ms" },
  // One 60 Hz frame (plan §9.2), plus Chrome's 0.1 ms performance.now() coarsening: an on-time frame reads 16.6-16.8.
  timelineScroll: { label: "2,000-cue timeline scroll (frame p95)", limit: 16.8, unit: "ms" },
  timelineZoom: { label: "2,000-cue timeline zoom (frame p95)", limit: 16.8, unit: "ms" },
  serverIdleRss: { label: "Server idle RSS (PGlite)", limit: 600, unit: "MB" },
  serverReady: { label: "Server warm start → ready (zks doctor --bench)", limit: 2_000, unit: "ms" },
} as const satisfies Record<string, Budget>;

export type BudgetKey = keyof typeof BUDGETS;

export const BUDGET_ANNOTATION_PREFIX = "perf:";

export const isBudgetKey = (key: string): key is BudgetKey => Object.hasOwn(BUDGETS, key);

/** Records the measurement for the report and fails the test when over; soft, so later budgets in a test still record. */
export function expectWithinBudget(key: BudgetKey, measured: number): void {
  const { label, limit, unit } = BUDGETS[key];
  test.info().annotations.push({ type: `${BUDGET_ANNOTATION_PREFIX}${key}`, description: String(measured) });
  expect.soft(measured, `${label}: ${measured} ${unit}, budget ${limit} ${unit}`).toBeLessThanOrEqual(limit);
}

/** The p95 sample, nearest-rank. */
export function percentile95(samples: readonly number[]): number {
  const sorted = samples.toSorted((first, second) => first - second);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
}
