// Created by The Angelo Umali.
// How one render job reads on the Render & export screen (plan §9.1).
import type { Hardware, Job, JobStatus } from "@zks/shared";

export type StageState = "done" | "running" | "failed" | "waiting";

export interface StageRow {
  readonly id: string;
  readonly label: string;
  readonly state: StageState;
  readonly pct: number;
}

/** The engine's master pipeline, in order; "events" is the SFX picker's own stage word. */
const PIPELINE_STAGES = [
  { id: "audio", label: "Audio mix" },
  { id: "sfx", label: "Sound effects" },
  { id: "frames", label: "Overlay frames" },
  { id: "master", label: "Encode" },
  { id: "checks", label: "Checks" },
] as const;
const STAGE_ALIASES: Readonly<Record<string, string>> = { events: "sfx" };

const SECONDS_PER_MINUTE = 60;
const FULL_PCT = 100;

const FINISHED_STATUS_TEXT: Readonly<Record<Exclude<JobStatus, "running">, string>> = {
  queued: "Queued",
  succeeded: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
};

export function stageRowsFor(job: Job): readonly StageRow[] {
  if (job.stage === null) return [];
  const currentState: StageState = job.status === "running" ? "running" : "failed";
  const currentPct = job.pct ?? 0;
  const stageId = STAGE_ALIASES[job.stage] ?? job.stage;
  const currentIndex = PIPELINE_STAGES.findIndex((stage) => stage.id === stageId);
  if (currentIndex === -1) return [{ id: job.stage, label: job.stage, state: job.status === "succeeded" ? "done" : currentState, pct: currentPct }];

  return PIPELINE_STAGES.map((stage, index): StageRow => {
    if (job.status === "succeeded" || index < currentIndex) return { ...stage, state: "done", pct: FULL_PCT };
    if (index === currentIndex) return { ...stage, state: currentState, pct: currentPct };
    return { ...stage, state: "waiting", pct: 0 };
  });
}

export function jobStatusText(job: Job): string {
  if (job.status !== "running") return FINISHED_STATUS_TEXT[job.status];
  const pctText = `${Math.round(job.pct ?? 0)}%`;
  if (job.etaS === null) return pctText;
  const minutesLeft = Math.round(job.etaS / SECONDS_PER_MINUTE);
  return `${pctText} · ${minutesLeft < 1 ? "under 1 min" : `${minutesLeft} min`} left`;
}

export function jobTitle(job: Job): string {
  const videoLabel = job.videoId.endsWith("r") ? "Reels cut" : "Full edit";
  return `${videoLabel} · ${job.kind.replaceAll("_", " ")}`;
}

/** Overlay frames draw in headless Chrome; GPU and CPU work names the probed encoder. */
export function backendChipFor(job: Job, hardware: Hardware | undefined): string {
  if (job.lane === "overlay") return "chrome-headless";
  if (job.lane === "whisper") return job.lane;
  return hardware?.encoder ?? job.lane;
}

export function isJobActive(job: Pick<Job, "status">): boolean {
  return job.status === "queued" || job.status === "running";
}
