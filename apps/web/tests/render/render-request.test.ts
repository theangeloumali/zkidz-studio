// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { isRenderFinished, renderRequestText } from "../../src/render/render-request.ts";
import { makeJob } from "./fixtures.ts";

describe("renderRequestText", () => {
  it("asks for every picked target at 4K", () => {
    expect(renderRequestText(["full", "reel", "covers"], "4k")).toBe(
      'Render and export the full edit, the Reels cut, the covers and caption. Render the masters with quality "4k".',
    );
  });

  it("asks for a 1080p master when the quality is final", () => {
    expect(renderRequestText(["full"], "final")).toBe('Render and export the full edit. Render the masters with quality "final" (1080p).');
  });

  it("leaves out the master quality when only covers are picked", () => {
    expect(renderRequestText(["covers"], "4k")).toBe("Render and export the covers and caption.");
  });
});

describe("isRenderFinished", () => {
  it("is true once the latest job succeeded and nothing is still queued or running", () => {
    const older = makeJob({ id: "1a2b3c4d-0000-4000-8000-000000000001", status: "failed", queuedAt: "2026-10-23T09:00:00.000Z" });
    const latest = makeJob({ status: "succeeded", queuedAt: "2026-10-23T10:00:00.000Z" });
    expect(isRenderFinished([older, latest])).toBe(true);
  });

  it("is false while a job runs, when the latest job failed, or with no jobs", () => {
    expect(isRenderFinished([makeJob()])).toBe(false);
    expect(isRenderFinished([makeJob({ status: "failed" })])).toBe(false);
    expect(isRenderFinished([])).toBe(false);
  });
});
