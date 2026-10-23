// Created by The Angelo Umali.
// Watching the agent build against the real preview build: spec writes reach the 4318 frame within 3 s, playback seeks
// it, hostile cue text stays text, restore swaps the preview, rejected cuts stay out, and the timeline holds 60 fps.
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { CUE_CALL_TEXT, HOSTILE_CUE_TEXT, type HarnessProject } from "./harness/script.ts";

const CATCH_UP_MS = 3_000;
/** For waits where the build is setup, not the thing measured. */
const BUILD_WAIT_MS = 60_000;
/** One frame at 60 Hz (plan §9.2), plus Chrome's 0.1 ms performance.now() coarsening: an on-time frame reads 16.6-16.8. */
const FRAME_BUDGET_MS = 16.7 + 0.1;
const FRAME_SAMPLE_MS = 3_000;
const appApiUrl = `http://127.0.0.1:${process.env["ZKS_E2E_PORT"]}/api/projects`;

async function control<Result>(request: APIRequestContext, path: string): Promise<Result> {
  const response = await request.get(`/__control/${path}`);
  expect(response.ok()).toBe(true);
  return (await response.json()) as Result;
}

async function openEditor(page: Page, request: APIRequestContext, pickProject = (project: HarnessProject) => project.projectId) {
  const project = await control<HarnessProject>(request, "project");
  await page.goto(`/p/${pickProject(project)}`);
  await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
  // A fresh stream replays nothing, so an event published before it opens never reaches the page.
  await expect(page.getByText("Events: Live")).toBeVisible();
  return project;
}

const overlay = (page: Page) => page.getByTitle("Overlay preview");
const overlayFrame = (page: Page) => page.frameLocator('iframe[title="Overlay preview"]');

test("the preview catches up within 3 s of each of 40 replayed set_cuts/add_cue calls", async ({ page, request }) => {
  const { replayCallCount } = await openEditor(page, request);
  await expect(overlay(page)).toBeAttached({ timeout: BUILD_WAIT_MS });
  for (let step = 0; step < replayCallCount; step += 1) {
    const versions = await control<{ cuts: number; cues: number }>(request, `replay?step=${step}`);
    if (step % 2 === 0) await expect(overlay(page), `call ${step + 1}`).toHaveAttribute("data-edl-version", String(versions.cuts), { timeout: CATCH_UP_MS });
    else await expect(overlayFrame(page).getByText(`${CUE_CALL_TEXT} ${step}`), `call ${step + 1}`).toBeAttached({ timeout: CATCH_UP_MS });
  }
  await expect(overlay(page)).toHaveAttribute("src", /\/compositions\/[^/]+\/v1\/index\.html\?build=\d+$/);
  await expect(page.getByTestId("lane-cues").getByRole("listitem").first()).toBeVisible();
});

test("playing seeks the overlay so a cue shows over its words", async ({ page, request }) => {
  await openEditor(page, request);
  await control(request, "hostile-cue");
  await control(request, "replay?step=101");
  const cueText = overlayFrame(page).getByText(HOSTILE_CUE_TEXT);
  await expect(cueText).toBeAttached({ timeout: BUILD_WAIT_MS });
  await expect(cueText).toBeHidden();
  await page.getByRole("button", { name: "Play" }).click();
  await expect(cueText).toBeVisible({ timeout: CATCH_UP_MS });
});

test("hostile cue text renders as text, and the frame can neither reach the API nor post a form", async ({ page, request }) => {
  let dialogCount = 0;
  page.on("dialog", (dialog) => {
    dialogCount += 1;
    void dialog.dismiss();
  });
  const posts: string[] = [];
  page.on("request", (sent) => {
    if (sent.method() === "POST") posts.push(sent.url());
  });
  await openEditor(page, request);
  await control(request, "hostile-cue");
  await control(request, "replay?step=103");
  await expect(overlayFrame(page).getByText(HOSTILE_CUE_TEXT)).toBeAttached({ timeout: BUILD_WAIT_MS });
  await expect(overlayFrame(page).locator('img[src="x"]')).toHaveCount(0);

  const frame = page.frame({ url: /\/compositions\// });
  expect(frame).not.toBeNull();
  const fetchOutcome = await frame?.evaluate(
    (url) =>
      fetch(url).then(
        () => "reached",
        () => "blocked",
      ),
    appApiUrl,
  );
  expect(fetchOutcome).toBe("blocked");
  await frame?.evaluate((url) => {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = url;
    document.body.append(form);
    form.submit();
  }, appApiUrl);
  // A blocked submit fires nothing to wait on, so give a real one time to leave.
  await page.waitForTimeout(500);
  expect(posts).toEqual([]);
  expect(dialogCount).toBe(0);
});

test("restoring v3 changes the preview", async ({ page, request }) => {
  await openEditor(page, request);
  // A step no other test writes, so the cut spec gets a new version and the page gets a preview.
  const { cuts } = await control<{ cuts: number }>(request, "replay?step=100");
  await expect(overlay(page)).toHaveAttribute("data-edl-version", String(cuts), { timeout: BUILD_WAIT_MS });
  const before = String(cuts);
  await page.getByRole("button", { name: "v3", exact: true }).click();
  await expect(page.getByText("Edited · 0:26 (from 0:30)")).toBeVisible();
  await page.getByRole("button", { name: "Restore v3" }).click();
  await expect(overlay(page)).not.toHaveAttribute("data-edl-version", before, { timeout: CATCH_UP_MS });
  await expect(page.getByRole("button", { name: "Restore v3" })).toBeHidden();
  await expect(page.getByText("Edited · 0:26 (from 0:30)")).toBeVisible();
});

test("a rejected cut candidate never reaches the cut spec", async ({ page, request }) => {
  const { projectId, videoId } = await openEditor(page, request);
  const proposal = await control<{ candidates: { id: string; kind: string }[] }>(request, "propose");
  const fillerIndex = proposal.candidates.findIndex((candidate) => candidate.kind === "filler");
  const stutterIndex = proposal.candidates.findIndex((candidate) => candidate.kind === "stutter");
  await page
    .getByRole("button", { name: /^Approve cut/ })
    .nth(fillerIndex)
    .click();
  await page
    .getByRole("button", { name: /^Reject cut/ })
    .nth(stutterIndex)
    .click();
  await page.getByRole("button", { name: "Send cut decisions" }).click();

  const outcome = await control<{ isSloppyAttemptRefused: boolean; isReviewedWritten: boolean }>(request, "apply-reviewed");
  expect(outcome).toEqual({ isSloppyAttemptRefused: true, isReviewedWritten: true });
  const spec = await request.get(`/api/projects/${projectId}/specs/${videoId}/cuts`);
  const { content } = (await spec.json()) as { content: { removals: { fromCandidate?: string }[] } };
  const keptCandidateIds = content.removals.map((removal) => removal.fromCandidate);
  expect(keptCandidateIds).toEqual([proposal.candidates[fillerIndex]?.id]);
  for (const [index, candidate] of proposal.candidates.entries()) if (index !== fillerIndex) expect(keptCandidateIds).not.toContain(candidate.id);
});

test("a 2,000-cue timeline scrolls and plays inside one 60 Hz frame at p95", async ({ page, request }) => {
  await openEditor(page, request, (project) => project.bulkProjectId);
  await expect(page.getByTestId("lane-cues").getByRole("listitem").first()).toBeVisible();
  await page.getByRole("button", { name: "Play" }).click();
  const frameDeltasMs = await page.evaluate(async (sampleMs) => {
    const scroller = document.querySelector(".timeline-scroll");
    if (scroller === null) throw new Error("no timeline scroller");
    const deltas: number[] = [];
    const startMs = performance.now();
    let lastMs = startMs;
    await new Promise<void>((resolve) => {
      const onFrame = (nowMs: number) => {
        // Back to Chrome's 0.1 ms grid: a raw 16.8 delta can read 16.800000000000182 and fail the inclusive budget.
        deltas.push(Math.round((nowMs - lastMs) * 10) / 10);
        lastMs = nowMs;
        scroller.scrollLeft = ((nowMs - startMs) / sampleMs) * (scroller.scrollWidth - scroller.clientWidth);
        if (nowMs - startMs < sampleMs) requestAnimationFrame(onFrame);
        else resolve();
      };
      requestAnimationFrame(onFrame);
    });
    return deltas.slice(1);
  }, FRAME_SAMPLE_MS);
  const sorted = frameDeltasMs.toSorted((first, second) => first - second);
  const p95Ms = sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Infinity;
  expect(p95Ms, `p95 of ${sorted.length} frames`).toBeLessThanOrEqual(FRAME_BUDGET_MS);
});
