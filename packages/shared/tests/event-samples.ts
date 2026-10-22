// Created by The Angelo Umali.
import { EVENT_AT, JOB_ID, PROJECT_ID } from "./fixtures.ts";

const base = { projectId: PROJECT_ID, at: EVENT_AT };
const persisted = { ...base, id: 42 };

export const sampleEventByType = {
  "session.started": {
    ...persisted,
    type: "session.started",
    sessionId: "s-1",
    model: "sonnet",
    credential: "API key ending 4f2a",
    skills: ["zkidz-studio:cut-spec"],
  },
  "text.delta": { ...base, type: "text.delta", text: "Trimming the" },
  "tool.started": { ...persisted, type: "tool.started", toolUseId: "toolu_1", name: "mcp__studio__set_cuts" },
  "tool.called": { ...persisted, type: "tool.called", toolUseId: "toolu_1", name: "mcp__studio__set_cuts", label: "Set cuts", input: { cuts: {} } },
  "tool.finished": {
    ...persisted,
    type: "tool.finished",
    toolUseId: "toolu_1",
    ok: true,
    summary: "12 segments, 171.4 s kept",
    images: ["/api/media/still-1"],
  },
  "tool.heartbeat": { ...base, type: "tool.heartbeat", toolUseId: "toolu_1", elapsedS: 12 },
  "tool.denied": { ...persisted, type: "tool.denied", name: "Bash", reason: "Bash is not available in ZKidz Studio" },
  "question.asked": {
    ...persisted,
    type: "question.asked",
    requestId: "q-1",
    questions: [{ question: "Keep the intro?", header: "Intro", options: [{ label: "Keep", description: "Plays after the hook" }], multiSelect: false }],
  },
  "approval.requested": {
    ...persisted,
    type: "approval.requested",
    requestId: "a-1",
    tool: "render_master",
    facts: {
      action: "Render the full edit",
      target: "full",
      quality: "4k",
      estimatedGpuMinutes: 6,
      outputPaths: ["deliverables/full-4k.mp4"],
      filesToDelete: [],
    },
    agentNote: "Ready for the final render.",
  },
  "spec.version": { ...persisted, type: "spec.version", videoId: "v1", kind: "cuts", version: 3, author: "agent", note: "Tightened the hook" },
  "preview.ready": { ...persisted, type: "preview.ready", videoId: "v1", edlVersion: 3, compositionUrl: "http://127.0.0.1:4318/v1/3/index.html" },
  "job.queued": { ...persisted, type: "job.queued", jobId: JOB_ID, kind: "render_final", status: "queued" },
  "job.started": { ...persisted, type: "job.started", jobId: JOB_ID, kind: "render_final", status: "running" },
  "job.finished": { ...persisted, type: "job.finished", jobId: JOB_ID, kind: "render_final", status: "succeeded" },
  "job.progress": { ...persisted, type: "job.progress", jobId: JOB_ID, stage: "encode", pct: 42.5, etaS: 95 },
  retry: { ...persisted, type: "retry", attempt: 1, max: 10, delayMs: 12000, reason: "overloaded" },
  limit: { ...persisted, type: "limit", status: "allowed_warning", resetsAt: EVENT_AT, utilization: 0.82 },
  "turn.completed": { ...persisted, type: "turn.completed", subtype: "success", isError: false, costUsd: 0.42, numTurns: 7, durationMs: 81000 },
  "context.compacted": { ...persisted, type: "context.compacted" },
  "cuts.proposed": {
    ...persisted,
    type: "cuts.proposed",
    requestId: "c-1",
    candidates: [{ id: "cand-1", at: 19.95, end: 21.95, kind: "filler", context: "Number one ... ah ... is", reason: "filler before the point" }],
  },
  "prompt.submitted": { ...persisted, type: "prompt.submitted", text: "Cut this to 60 seconds" },
  narration: { ...persisted, type: "narration", text: "I trimmed the opening pause." },
  "terminal.state": { ...persisted, type: "terminal.state", state: "exited", exitCode: 0 },
  "session.error": {
    ...persisted,
    type: "session.error",
    kind: "rate_limited",
    message: "Plan limit reached",
    action: "Try again at 14:00 or switch to an API key",
  },
  resync: { ...persisted, type: "resync" },
} as const;
