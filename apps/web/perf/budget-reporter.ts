// Created by The Angelo Umali.
// Prints every §9.5 budget against its limit, and fails the run when one is over or went unmeasured.
import type { FullResult, Reporter, TestCase, TestResult, TestStep } from "@playwright/test/reporter";
import { REPLAY_CALL_COUNT } from "../e2e/harness/script.ts";
import { BUDGET_ANNOTATION_PREFIX, BUDGETS, isBudgetKey, type BudgetKey } from "./budgets.ts";

interface Measurement {
  readonly value: number | null;
  readonly withinBudget: boolean;
  readonly note: string;
}

// The watch-build catch-up test runs as it stands; its title is how its result is found.
const CATCH_UP_TITLE = "the preview catches up within 3 s of each of 40 replayed set_cuts/add_cue calls";
/** Each replayed call's catch-up wait is an expect step titled `call N`. */
const CALL_STEP = /^call \d+$/;

const flatSteps = (steps: readonly TestStep[]): TestStep[] => steps.flatMap((step) => [step, ...flatSteps(step.steps)]);

function catchUpMeasurement(result: TestResult): Measurement {
  const waitsMs = flatSteps(result.steps)
    .filter((step) => step.category === "expect" && CALL_STEP.test(step.title))
    .map((step) => step.duration);
  if (waitsMs.length === 0) return { value: null, withinBudget: false, note: "no call reached the preview" };
  const slowestMs = Math.max(...waitsMs);
  const isComplete = waitsMs.length === REPLAY_CALL_COUNT;
  return {
    value: slowestMs,
    withinBudget: isComplete && slowestMs <= BUDGETS.previewCatchUp.limit,
    note: isComplete
      ? `median ${waitsMs.toSorted((first, second) => first - second)[waitsMs.length >> 1]} ms`
      : `${waitsMs.length} of ${REPLAY_CALL_COUNT} calls`,
  };
}

function annotatedMeasurements(result: TestResult): [BudgetKey, Measurement][] {
  return result.annotations.flatMap(({ type, description }) => {
    const key = type.slice(BUDGET_ANNOTATION_PREFIX.length);
    if (!type.startsWith(BUDGET_ANNOTATION_PREFIX) || !isBudgetKey(key)) return [];
    const value = Number(description);
    return [[key, { value, withinBudget: value <= BUDGETS[key].limit, note: "" }]];
  });
}

export default class BudgetReporter implements Reporter {
  private readonly measurements = new Map<BudgetKey, Measurement>();

  onTestEnd(test: TestCase, result: TestResult): void {
    for (const [key, measurement] of annotatedMeasurements(result)) this.measurements.set(key, measurement);
    if (test.title === CATCH_UP_TITLE) this.measurements.set("previewCatchUp", catchUpMeasurement(result));
  }

  onEnd(): Promise<Pick<FullResult, "status"> | undefined> {
    let isOverOrMissing = false;
    console.log(`\n${"Budget (plan §9.5)".padEnd(52)}${"Measured".padStart(12)}${"Limit".padStart(12)}  Verdict`);
    for (const [key, { label, limit, unit }] of Object.entries(BUDGETS)) {
      const measurement = isBudgetKey(key) ? this.measurements.get(key) : undefined;
      const measured = measurement?.value === null || measurement === undefined ? "—" : `${measurement.value} ${unit}`;
      const verdict = measurement === undefined ? "NOT MEASURED" : measurement.withinBudget ? "ok" : "OVER";
      if (verdict !== "ok") isOverOrMissing = true;
      const note = measurement?.note ? `  (${measurement.note})` : "";
      console.log(`${label.padEnd(52)}${measured.padStart(12)}${`${limit} ${unit}`.padStart(12)}  ${verdict}${note}`);
    }
    return Promise.resolve(isOverOrMissing ? { status: "failed" } : undefined);
  }
}
