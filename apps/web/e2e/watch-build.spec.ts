// Created by The Angelo Umali.
// Watching the agent build against the real preview build: spec writes reach the 4318 frame within 3 s, playback seeks
// it, hostile cue text stays text, restore swaps the preview, rejected cuts stay out, and the timeline holds 60 fps.
import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { CUE_CALL_TEXT, HOSTILE_CUE_TEXT, type HarnessProject } from "./harness/script.ts";

const CATCH_UP_MS = 3_000;
/** For waits where the build is setup, not the thing measured. */
const BUILD_WAIT_MS = 60_000;
/** One frame at 60 Hz (plan §9.2), plus Chrome's 0.1 ms performance.now() coarsening: an on-time frame reads 16.6-16.8. */
const FRAME_BUDGET_MS = 16.7 + 0.1;
const FRAME_SAMPLE_MS = 3_000;
/** Spec §6.1: the timeline never holds more than this many DOM nodes, at any zoom. */
const TIMELINE_NODE_CAP = 600;
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

/** Adds the hostile cue, then one replay cue; that cue is in the last build only, so once it shows the frame stops navigating. */
async function hostileCueBuilt(page: Page, request: APIRequestContext, replayStep: number) {
  await control(request, "hostile-cue");
  await control(request, `replay?step=${replayStep}`);
  await expect(overlayFrame(page).getByText(`${CUE_CALL_TEXT} ${replayStep}`)).toBeAttached({ timeout: BUILD_WAIT_MS });
  return overlayFrame(page).getByText(HOSTILE_CUE_TEXT);
}

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

test("an editor reloaded after the build still shows that build's overlay", async ({ page, request }) => {
  await openEditor(page, request);
  // An odd step no other test writes adds one cue, so the frame has text to find.
  await control(request, "replay?step=109");
  const cueText = overlayFrame(page).getByText(`${CUE_CALL_TEXT} 109`);
  await expect(cueText).toBeAttached({ timeout: BUILD_WAIT_MS });

  await page.reload();

  await expect(page.getByText("Events: Live")).toBeVisible();
  await expect(cueText).toBeAttached({ timeout: CATCH_UP_MS });
});

/** Share of the element's screenshot pixels that are near-white, decoded in the page (no image library in the web app). */
async function nearWhiteShare(page: Page, element: Locator): Promise<number> {
  const pngBase64 = (await element.screenshot()).toString("base64");
  return page.evaluate(async (base64) => {
    // An <img>, not fetch: the app's CSP allows data: images but no data: connections.
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = new OffscreenCanvas(image.naturalWidth, image.naturalHeight);
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("no 2d context");
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let nearWhite = 0;
    for (let offset = 0; offset < data.length; offset += 4)
      if (Math.min(data[offset] ?? 0, data[offset + 1] ?? 0, data[offset + 2] ?? 0) >= 245) nearWhite += 1;
    return nearWhite / (data.length / 4);
  }, pngBase64);
}

test("playing seeks the overlay so a cue shows over its words, inside the player", async ({ page, request }) => {
  await openEditor(page, request);
  const cueText = await hostileCueBuilt(page, request, 101);
  await expect(cueText).toBeAttached();
  await expect(cueText).toBeHidden();
  await page.getByRole("button", { name: "Play" }).click();
  await expect(cueText).toBeVisible({ timeout: CATCH_UP_MS });

  // toBeVisible ignores clipping: an unscaled 1080 px canvas puts the cue past the 306 px frame's edge.
  const player = await overlay(page).boundingBox();
  const cue = await cueText.boundingBox();
  if (player === null || cue === null) throw new Error("no player or cue box");
  expect(cue.x).toBeGreaterThanOrEqual(player.x);
  expect(cue.y).toBeGreaterThanOrEqual(player.y);
  expect(cue.x + cue.width).toBeLessThanOrEqual(player.x + player.width);
  expect(cue.y + cue.height).toBeLessThanOrEqual(player.y + player.height);
});

interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** The comment cue's text, its bubble body and its pen-reveal window, all in the frame's viewport pixels. */
async function commentBoxes(page: Page): Promise<{ text: Box; bubble: Box; reveal: Box }> {
  const frame = page.frame({ url: /\/compositions\// });
  if (frame === null) throw new Error("no overlay frame");
  return frame.evaluate((text) => {
    const boxOf = (element: Element): Box => {
      const { left, top, right, bottom } = element.getBoundingClientRect();
      return { left, top, right, bottom };
    };
    // Replayed cues are comments too, so start from this cue's own text.
    const textElement = [...document.querySelectorAll(".comment text")].find((element) => element.textContent === text);
    const comment = textElement?.closest(".comment");
    const words = comment?.querySelector<HTMLElement>(".words");
    if (textElement === undefined || comment === null || comment === undefined || words === null || words === undefined) throw new Error("no comment cue");
    // The bubble's body is its largest drawn path; the rest are its tail and outline strokes.
    const area = (box: Box) => (box.right - box.left) * (box.bottom - box.top);
    const bubble = [...comment.querySelectorAll(".bubble path")].map(boxOf).reduce((largest, box) => (area(box) > area(largest) ? box : largest));
    // The clip polygon is in the words layer's own pixels; a probe placed on it takes every transform above (cue, #root scale).
    const [left = 0, top = 0, right = 0, bottom = 0] = [...getComputedStyle(words).clipPath.matchAll(/(-?[\d.]+)px/g)]
      .map((match) => Number(match[1]))
      .filter((_, index) => [0, 1, 4, 5].includes(index));
    const probe = document.createElement("div");
    probe.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:${right - left}px;height:${bottom - top}px`;
    words.append(probe);
    const reveal = boxOf(probe);
    probe.remove();
    return { text: boxOf(textElement), bubble, reveal };
  }, HOSTILE_CUE_TEXT);
}

const contains = (outer: Box, inner: Box) => inner.left >= outer.left && inner.top >= outer.top && inner.right <= outer.right && inner.bottom <= outer.bottom;

test("a long comment cue writes on in full, inside its bubble", async ({ page, request }) => {
  await openEditor(page, request);
  // An odd step's cue sits at 5 + step % 9 s: 103 lands at 9 s, clear of the seeded 10–14 s cut that drops 105's cue.
  await expect(await hostileCueBuilt(page, request, 103)).toBeAttached();
  await page.getByRole("button", { name: "Play" }).click();

  // The pen window grows until the reveal ends; with fallback type the text outgrew it and was cropped.
  await expect
    .poll(
      async () => {
        const { reveal, text } = await commentBoxes(page);
        return contains(reveal, text);
      },
      { timeout: CATCH_UP_MS },
    )
    .toBe(true);
  const { text, bubble } = await commentBoxes(page);
  expect(contains(bubble, text), `text ${JSON.stringify(text)} in bubble ${JSON.stringify(bubble)}`).toBe(true);
});

test("clicking the ruler moves the playhead and the preview to that time", async ({ page, request }) => {
  await openEditor(page, request);
  await expect(overlay(page)).toBeAttached({ timeout: BUILD_WAIT_MS });
  const slider = page.getByRole("slider", { name: "Playhead" });
  await slider.scrollIntoViewIfNeeded();
  // A tick's left border sits exactly on its second; 0:04 is before the harness's first cut, so source and edited agree.
  const tick = await slider.getByText("0:04", { exact: true }).boundingBox();
  const ruler = await slider.boundingBox();
  if (tick === null || ruler === null) throw new Error("no ruler tick");

  await page.mouse.click(tick.x + 0.5, ruler.y + ruler.height / 2);

  await expect.poll(async () => Number(await slider.getAttribute("aria-valuenow"))).toBeCloseTo(4, 1);
  const playheadX = await page.locator(".playhead").evaluate((playhead) => {
    const { left, right } = playhead.getBoundingClientRect();
    return (left + right) / 2;
  });
  expect(Math.abs(playheadX - tick.x)).toBeLessThanOrEqual(1.5);
  const footage = page.locator('video.footage[data-active="true"]');
  await expect.poll(() => footage.evaluate((video: HTMLVideoElement) => video.currentTime), { timeout: CATCH_UP_MS }).toBeCloseTo(4, 1);
});

test("the overlay frame is see-through in the dark theme and loads every brand font", async ({ page, request }) => {
  await openEditor(page, request);
  await expect(overlay(page)).toBeAttached({ timeout: BUILD_WAIT_MS });
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", "light");
  const frame = page.frame({ url: /\/compositions\// });
  if (frame === null) throw new Error("no overlay frame");
  await frame.waitForFunction(() => document.getElementById("root") !== null);

  // A color-scheme mismatch paints an opaque white canvas behind a cross-origin frame.
  expect(await nearWhiteShare(page, page.locator(".player"))).toBeLessThan(0.5);
  const fontStatuses = await frame.evaluate(async () => {
    await Promise.allSettled([...document.fonts].map((face) => face.load()));
    return [...document.fonts].map((face) => `${face.family} ${face.status}`);
  });
  expect(fontStatuses.length).toBeGreaterThanOrEqual(4);
  for (const status of fontStatuses) expect(status).toMatch(/ loaded$/);
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
  await expect(await hostileCueBuilt(page, request, 103)).toBeAttached();
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
  // A real click, not a forced one: the short filler's own Reject must not sit under the pause chip after it.
  const fillerReject = page.getByRole("button", { name: /^Reject cut/ }).nth(fillerIndex);
  await fillerReject.click({ timeout: 5_000 });
  await expect(fillerReject).toHaveAttribute("aria-pressed", "true");
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

type FrameDriver = "scroll" | "zoom";

/** Per-frame deltas while `driver` moves the timeline every frame, plus the editor document's own long tasks (over 50 ms) meanwhile. */
function sampleFrames(page: Page, driver: FrameDriver) {
  return page.evaluate(
    async ({ sampleMs, driver }) => {
      const scroller = document.querySelector(".timeline-scroll");
      if (scroller === null) throw new Error("no timeline scroller");
      const longTaskMs: number[] = [];
      // "self" only: the cross-origin overlay preview's play-start work is reported as its own task (not the timeline's).
      const ownDurations = (entries: PerformanceEntryList) => entries.filter((entry) => entry.name === "self").map((entry) => entry.duration);
      const observer = new PerformanceObserver((list) => longTaskMs.push(...ownDurations(list.getEntries())));
      observer.observe({ type: "longtask" });
      const pointerX = scroller.getBoundingClientRect().left + scroller.clientWidth / 2;
      const deltas: number[] = [];
      const startMs = performance.now();
      let lastMs = startMs;
      await new Promise<void>((resolve) => {
        const onFrame = (nowMs: number) => {
          // Back to Chrome's 0.1 ms grid: a raw 16.8 delta can read 16.800000000000182 and fail the inclusive budget.
          deltas.push(Math.round((nowMs - lastMs) * 10) / 10);
          lastMs = nowMs;
          const progress = (nowMs - startMs) / sampleMs;
          if (driver === "scroll") scroller.scrollLeft = progress * (scroller.scrollWidth - scroller.clientWidth);
          // Fit → 40 px/s over the first half, back to Fit over the second; the clamp holds each end.
          else scroller.dispatchEvent(new WheelEvent("wheel", { ctrlKey: true, deltaY: progress < 0.5 ? -40 : 40, clientX: pointerX, cancelable: true }));
          if (progress < 1) requestAnimationFrame(onFrame);
          else resolve();
        };
        requestAnimationFrame(onFrame);
      });
      longTaskMs.push(...ownDurations(observer.takeRecords()));
      observer.disconnect();
      return { frameDeltasMs: deltas.slice(1), longTaskMs };
    },
    { sampleMs: FRAME_SAMPLE_MS, driver },
  );
}

function expectSmooth({ frameDeltasMs, longTaskMs }: Awaited<ReturnType<typeof sampleFrames>>) {
  const sorted = frameDeltasMs.toSorted((first, second) => first - second);
  const p95Ms = sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Infinity;
  expect(p95Ms, `p95 of ${sorted.length} frames`).toBeLessThanOrEqual(FRAME_BUDGET_MS);
  expect(longTaskMs, "long tasks over 50 ms").toEqual([]);
}

const timelineNodeCount = (page: Page) => page.locator(".timeline-scroll *").count();

test("a 2,000-cue timeline scrolls and plays inside one 60 Hz frame at p95", async ({ page, request }) => {
  await openEditor(page, request, (project) => project.bulkProjectId);
  await expect(page.getByTestId("lane-cues").getByRole("listitem").first()).toBeVisible();
  await page.getByRole("button", { name: "Play" }).click();
  expectSmooth(await sampleFrames(page, "scroll"));
});

test("a 2,000-cue timeline zooms Fit → 40 px/s → Fit inside one 60 Hz frame at p95, under 600 nodes at each end", async ({ page, request }) => {
  await openEditor(page, request, (project) => project.bulkProjectId);
  await expect(page.getByTestId("lane-cues").getByRole("listitem").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Zoom in" })).toBeDisabled();
  expect(await timelineNodeCount(page)).toBeLessThanOrEqual(TIMELINE_NODE_CAP);
  await page.getByRole("button", { name: "Fit" }).click();
  await expect(page.getByRole("button", { name: "Fit" })).toBeDisabled();
  expect(await timelineNodeCount(page)).toBeLessThanOrEqual(TIMELINE_NODE_CAP);

  expectSmooth(await sampleFrames(page, "zoom"));
  await expect(page.getByRole("button", { name: "Fit" })).toBeDisabled();
});
