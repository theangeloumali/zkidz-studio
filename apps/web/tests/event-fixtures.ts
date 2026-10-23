// Created by The Angelo Umali.
import type { StudioEvent, StudioEventType } from "@zks/shared";
import { PROJECT_ID } from "./fakes.ts";

const BASE = { projectId: PROJECT_ID, at: "2026-10-23T10:00:00.000Z" };
const JOB_ID = "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";

type EventOf<Type extends StudioEventType> = Extract<StudioEvent, { type: Type }>;

/** One valid event per type; the mapped type makes a new event type fail typecheck until it has a sample. */
export const SAMPLE_EVENTS: { readonly [Type in StudioEventType]: EventOf<Type> } = {
  "session.started": { ...BASE, type: "session.started", sessionId: "sess-1", model: "claude-sonnet", credential: "API key ending 1234", skills: [] },
  "text.delta": { ...BASE, type: "text.delta", text: "Cutting the pauses now." },
  "tool.started": { ...BASE, type: "tool.started", toolUseId: "tu-1", name: "mcp__studio__transcribe" },
  "tool.called": { ...BASE, type: "tool.called", toolUseId: "tu-1", name: "mcp__studio__transcribe", label: "Transcribing beach.mp4", input: {} },
  "tool.finished": { ...BASE, type: "tool.finished", toolUseId: "tu-1", ok: true, summary: "412 words" },
  "tool.heartbeat": { ...BASE, type: "tool.heartbeat", toolUseId: "tu-1", elapsedS: 12 },
  "tool.denied": { ...BASE, type: "tool.denied", name: "Bash", reason: "Shell access is off in the studio" },
  "question.asked": {
    ...BASE,
    type: "question.asked",
    requestId: "q-1",
    questions: [
      { question: "Which take should open the video?", header: "Opening", options: [{ label: "Take 1" }, { label: "Take 2", description: "Louder" }] },
    ],
  },
  "approval.requested": {
    ...BASE,
    type: "approval.requested",
    requestId: "a-1",
    tool: "mcp__studio__render_master",
    facts: { action: "Render the 4K master", target: "v1", quality: "4K HEVC", estimatedGpuMinutes: 6, outputPaths: ["out/v1.mp4"], filesToDelete: [] },
    agentNote: "Everything is approved, render it.",
  },
  "spec.version": { ...BASE, type: "spec.version", videoId: "v1", kind: "cuts", version: 3, author: "agent", note: "Trimmed pauses" },
  "preview.ready": { ...BASE, type: "preview.ready", videoId: "v1", edlVersion: 2, compositionUrl: "http://127.0.0.1:4317/preview/v1" },
  "job.queued": { ...BASE, type: "job.queued", jobId: JOB_ID, kind: "render", status: "queued" },
  "job.started": { ...BASE, type: "job.started", jobId: JOB_ID, kind: "render", status: "running" },
  "job.progress": { ...BASE, type: "job.progress", jobId: JOB_ID, stage: "encode", pct: 42, etaS: 90 },
  "job.finished": { ...BASE, type: "job.finished", jobId: JOB_ID, kind: "render", status: "succeeded" },
  retry: { ...BASE, type: "retry", attempt: 1, max: 3, delayMs: 12_000, reason: "overloaded" },
  limit: { ...BASE, type: "limit", status: "allowed_warning", utilization: 0.8 },
  "turn.completed": { ...BASE, type: "turn.completed", subtype: "success", isError: false, costUsd: 0.42, numTurns: 4, durationMs: 61_000 },
  "context.compacted": { ...BASE, type: "context.compacted" },
  "cuts.proposed": {
    ...BASE,
    type: "cuts.proposed",
    requestId: "c-1",
    candidates: [{ id: "cut-1", kind: "filler", at: 3.2, end: 3.9, context: "so um yeah", reason: "Filler word" }],
  },
  "prompt.submitted": { ...BASE, type: "prompt.submitted", text: "Cut the dead air" },
  narration: { ...BASE, type: "narration", text: "Done. The cut is 58 seconds." },
  "terminal.state": { ...BASE, type: "terminal.state", state: "exited", exitCode: 1 },
  "session.error": { ...BASE, type: "session.error", kind: "auth_failed", message: "invalid x-api-key" },
  resync: { ...BASE, type: "resync" },
};

export function sampleEvent<Type extends StudioEventType>(type: Type, overrides: Partial<EventOf<Type>> = {}): EventOf<Type> {
  return { ...SAMPLE_EVENTS[type], ...overrides };
}
