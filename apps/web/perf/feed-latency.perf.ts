// Created by The Angelo Umali.
// Server event → painted feed row: replays the agent's 40 spec writes and times each `Saved …` row from the event's
// server stamp to the first frame after React inserts it. Server and browser share this machine's clock.
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { HarnessProject } from "../e2e/harness/script.ts";
import { expectWithinBudget, percentile95 } from "./budgets.ts";

interface FeedTiming {
  readonly stampedAt: Map<string, number>;
  readonly paintedAt: Map<string, number>;
}

declare global {
  interface Window {
    feedTiming?: FeedTiming;
  }
}

interface ReplayedVersions {
  readonly cuts: number;
  readonly cues: number;
}

async function control<Result>(request: APIRequestContext, path: string): Promise<Result> {
  const response = await request.get(`/__control/${path}`);
  expect(response.ok(), `/__control/${path} answered ${response.status()}`).toBe(true);
  return (await response.json()) as Result;
}

/** The feed only renders once Claude is connected; the harness accepts any key. */
async function connectClaude(page: Page): Promise<void> {
  await page.goto("/setup");
  await page.getByRole("radio", { name: "Paste an Anthropic API key" }).check();
  await page.getByRole("textbox", { name: "API key" }).fill("sk-ant-perf-check-0000");
  await page.getByRole("button", { name: "Check key" }).click();
  await expect(page.getByText(/Key works · ending in/)).toBeVisible();
}

/** Stamps each spec.version's server time and each Saved row's paint time, keyed `<kind> v<version>`. */
function startTiming(projectId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timing: FeedTiming = { stampedAt: new Map(), paintedAt: new Map() };
    window.feedTiming = timing;
    new MutationObserver(() => {
      for (const row of document.querySelectorAll('ol[aria-label="Agent activity"] > li')) {
        const match = /Saved (cuts|cues) v(\d+)/.exec(row.textContent ?? "");
        const key = match ? `${match[1]} v${match[2]}` : undefined;
        if (key === undefined || timing.paintedAt.has(key)) continue;
        timing.paintedAt.set(key, Number.NaN);
        // A rAF callback runs before the frame paints; a task queued from it runs after.
        requestAnimationFrame(() => setTimeout(() => timing.paintedAt.set(key, Date.now())));
      }
    }).observe(document.body, { childList: true, subtree: true });
    const stream = new EventSource(`/api/events?project=${encodeURIComponent(projectId)}`);
    stream.onopen = () => resolve();
    stream.onerror = () => reject(new Error("the timing stream did not open"));
    stream.onmessage = (message) => {
      const event = JSON.parse(String(message.data)) as { type?: string; kind?: string; version?: number; at?: string };
      if (event.type === "spec.version" && event.at !== undefined) timing.stampedAt.set(`${event.kind} v${event.version}`, Date.parse(event.at));
    };
  });
}

function rowLatencyMs(page: Page, key: string): Promise<number> {
  return page.evaluate((rowKey) => {
    const paintedMs = window.feedTiming?.paintedAt.get(rowKey) ?? Number.NaN;
    return paintedMs - (window.feedTiming?.stampedAt.get(rowKey) ?? Number.NaN);
  }, key);
}

test("each replayed spec write paints its feed row within 250 ms at p95", async ({ page, request }) => {
  await connectClaude(page);
  const project = await control<HarnessProject>(request, "project");
  await page.goto(`/p/${project.projectId}`);
  await expect(page.getByText("Events: Live")).toBeVisible();
  await page.evaluate(startTiming, project.projectId);

  const latenciesMs: number[] = [];
  for (let step = 0; step < project.replayCallCount; step += 1) {
    const versions = await control<ReplayedVersions>(request, `replay?step=${step}`);
    const key = step % 2 === 0 ? `cuts v${versions.cuts}` : `cues v${versions.cues}`;
    // NaN until both the event and the painted row are seen.
    await expect.poll(() => rowLatencyMs(page, key), { message: `row "Saved ${key}" never painted` }).toBeGreaterThanOrEqual(0);
    latenciesMs.push(await rowLatencyMs(page, key));
  }
  expectWithinBudget("feedRowPaint", percentile95(latenciesMs));
});
