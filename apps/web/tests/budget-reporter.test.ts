// Created by The Angelo Umali.
// @vitest-environment node
import type { TestCase, TestResult } from "@playwright/test/reporter";
import { afterEach, describe, expect, it, vi } from "vitest";
import BudgetReporter from "../perf/budget-reporter.ts";

function reportOf(result: Pick<TestResult, "status" | "annotations">): string[] {
  const printed: string[] = [];
  vi.spyOn(console, "log").mockImplementation((line: string) => printed.push(line));
  const reporter = new BudgetReporter();
  reporter.onTestEnd({ title: "a timeline check" } as TestCase, { steps: [], ...result } as unknown as TestResult);
  void reporter.onEnd();
  return printed;
}

const rowOf = (printed: string[], label: string) => printed.find((line) => line.startsWith(label)) ?? "";

describe("budget reporter", () => {
  afterEach(() => vi.restoreAllMocks());

  it("prints a passed timeline check's measured p95 beside its limit", () => {
    const printed = reportOf({ status: "passed", annotations: [{ type: "perf:timelineScroll", description: "16.6" }] });

    expect(rowOf(printed, "2,000-cue timeline scroll")).toMatch(/16\.6 ms\s+16\.8 ms {2}ok$/);
  });

  it("prints an over-budget p95 as OVER", () => {
    const printed = reportOf({ status: "failed", annotations: [{ type: "perf:timelineScroll", description: "33.4" }] });

    expect(rowOf(printed, "2,000-cue timeline scroll")).toMatch(/33\.4 ms\s+16\.8 ms {2}OVER$/);
  });

  it("marks a budget no check recorded as NOT MEASURED", () => {
    const printed = reportOf({ status: "failed", annotations: [] });

    expect(rowOf(printed, "2,000-cue timeline scroll")).toMatch(/—\s+16\.8 ms {2}NOT MEASURED/);
  });
});
