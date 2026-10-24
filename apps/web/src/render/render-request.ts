// Created by The Angelo Umali.
// Renders start through the agent so render_master keeps its approval gate (plan §6.8); the screen only words the request.
import type { Job } from "@zks/shared";
import { isJobActive } from "./job-display.ts";

export const RENDER_TARGET_OPTIONS = [
  { id: "full", label: "Full edit", requestText: "the full edit", isMaster: true },
  { id: "reel", label: "Reels cut", requestText: "the Reels cut", isMaster: true },
  { id: "covers", label: "Covers and caption", requestText: "the covers and caption", isMaster: false },
] as const;

export type RenderTargetId = (typeof RENDER_TARGET_OPTIONS)[number]["id"];
/** render_master qualities the screen offers; "final" is the 1080p master. */
export type MasterQuality = "4k" | "final";

const QUALITY_TEXT: Readonly<Record<MasterQuality, string>> = { "4k": 'quality "4k"', final: 'quality "final" (1080p)' };

export function renderRequestText(targetIds: readonly RenderTargetId[], quality: MasterQuality): string {
  const pickedTargets = RENDER_TARGET_OPTIONS.filter((option) => targetIds.includes(option.id));
  const exportText = `Render and export ${pickedTargets.map((option) => option.requestText).join(", ")}.`;
  if (!pickedTargets.some((option) => option.isMaster)) return exportText;
  return `${exportText} Render the masters with ${QUALITY_TEXT[quality]}.`;
}

/** Older failed jobs stay in the list, so only the latest one decides. */
export function isRenderFinished(jobs: readonly Job[]): boolean {
  if (jobs.some(isJobActive)) return false;
  const latestJob = jobs.reduce<Job | undefined>((latest, job) => (latest === undefined || job.queuedAt > latest.queuedAt ? job : latest), undefined);
  return latestJob?.status === "succeeded";
}
