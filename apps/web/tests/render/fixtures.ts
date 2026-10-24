// Created by The Angelo Umali.
import type { Hardware, Job, QcCheck } from "@zks/shared";
import type { Deliverable } from "../../src/render/render-api.ts";
import { PROJECT_ID } from "../fakes.ts";

export const FULL_HASH = "3f9a1c2b4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8";

export function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "8c1d2e3f-4a5b-4c6d-9e7f-0a1b2c3d4e5f",
    projectId: PROJECT_ID,
    kind: "render_master",
    videoId: "v1",
    lane: "gpu",
    status: "running",
    stage: "frames",
    pct: 42,
    etaS: 180,
    error: null,
    queuedAt: "2026-10-23T10:00:00.000Z",
    startedAt: "2026-10-23T10:00:05.000Z",
    finishedAt: null,
    ...overrides,
  };
}

export function makeDeliverable(overrides: Partial<Deliverable> = {}): Deliverable {
  return {
    id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    kind: "full",
    name: "beach-day-full-4k.mp4",
    bytes: 412_000_000,
    sha256: FULL_HASH,
    createdAt: "2026-10-23T10:20:00.000Z",
    ...overrides,
  };
}

export const NVIDIA_HARDWARE: Hardware = {
  profile: "nvidia",
  encoder: "hevc_nvenc",
  chunks: 4,
  meters: [
    { label: "GPU", pct: 87 },
    { label: "Encoder", pct: 64 },
    { label: "CPU", pct: null },
  ],
};

export const CPU_HARDWARE: Hardware = {
  profile: "cpu",
  encoder: "libx265",
  chunks: 1,
  meters: [
    { label: "CPU", pct: 97 },
    { label: "GPU", pct: null },
  ],
};

export const QC_CHECKS: readonly QcCheck[] = [
  { id: "frames", label: "Frame count matches the edit", status: "pass", detail: null },
  { id: "motion", label: "Footage moves in every shot", status: "fail", detail: "Shot 3 is frozen against the source" },
  { id: "loudness", label: "Audio at −14 LUFS", status: "pending", detail: null },
];
