// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { backendChipFor, jobStatusText, jobTitle, stageRowsFor } from "../../src/render/job-display.ts";
import { NVIDIA_HARDWARE, makeJob } from "./fixtures.ts";

describe("stageRowsFor", () => {
  it("marks earlier stages done, the current one running at the job's percent and later ones waiting", () => {
    const rows = stageRowsFor(makeJob({ stage: "frames", pct: 42 }));

    expect(rows.map((row) => [row.label, row.state, row.pct])).toEqual([
      ["Audio mix", "done", 100],
      ["Sound effects", "done", 100],
      ["Overlay frames", "running", 42],
      ["Encode", "waiting", 0],
      ["Checks", "waiting", 0],
    ]);
  });

  it("folds the engine's events stage into Sound effects", () => {
    const rows = stageRowsFor(makeJob({ stage: "events", pct: 10 }));

    expect(rows[1]).toMatchObject({ label: "Sound effects", state: "running", pct: 10 });
  });

  it("marks the stage a job failed in", () => {
    const rows = stageRowsFor(makeJob({ stage: "master", status: "failed", pct: 61 }));

    expect(rows[3]).toMatchObject({ label: "Encode", state: "failed", pct: 61 });
  });

  it("marks every stage done once the job succeeds", () => {
    const rows = stageRowsFor(makeJob({ stage: "master", status: "succeeded", pct: 100 }));

    expect(rows.every((row) => row.state === "done" && row.pct === 100)).toBe(true);
  });

  it("shows an unknown stage as one row under its own name", () => {
    expect(stageRowsFor(makeJob({ stage: "covers", pct: 50 }))).toEqual([{ id: "covers", label: "covers", state: "running", pct: 50 }]);
  });

  it("shows no rows before a job reports a stage", () => {
    expect(stageRowsFor(makeJob({ stage: null, status: "queued", pct: null }))).toEqual([]);
  });
});

describe("jobStatusText", () => {
  it("gives a running job its percent and minutes left", () => {
    expect(jobStatusText(makeJob({ pct: 42.4, etaS: 180 }))).toBe("42% · 3 min left");
  });

  it("says under a minute when the ETA is short", () => {
    expect(jobStatusText(makeJob({ pct: 98, etaS: 20 }))).toBe("98% · under 1 min left");
  });

  it("names the finished states", () => {
    expect(jobStatusText(makeJob({ status: "succeeded" }))).toBe("Done");
    expect(jobStatusText(makeJob({ status: "failed" }))).toBe("Failed");
    expect(jobStatusText(makeJob({ status: "queued", pct: null, etaS: null }))).toBe("Queued");
  });
});

describe("jobTitle", () => {
  it("names the full edit and the Reels cut by video id", () => {
    expect(jobTitle(makeJob({ videoId: "v1" }))).toBe("Full edit · render master");
    expect(jobTitle(makeJob({ videoId: "v1r" }))).toBe("Reels cut · render master");
  });
});

describe("backendChipFor", () => {
  it("shows the probed encoder for GPU and CPU work and headless Chrome for overlay frames", () => {
    expect(backendChipFor(makeJob({ lane: "gpu" }), NVIDIA_HARDWARE)).toBe("hevc_nvenc");
    expect(backendChipFor(makeJob({ lane: "overlay" }), NVIDIA_HARDWARE)).toBe("chrome-headless");
    expect(backendChipFor(makeJob({ lane: "whisper" }), NVIDIA_HARDWARE)).toBe("whisper");
  });

  it("falls back to the lane name before the hardware probe answers", () => {
    expect(backendChipFor(makeJob({ lane: "gpu" }), undefined)).toBe("gpu");
  });
});
