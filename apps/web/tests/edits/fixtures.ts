// Created by The Angelo Umali.
import type { EditSummary } from "@zks/shared";
import { PROJECT_ID } from "../fakes.ts";

export const PROJECT_EDITS_PATH = `/api/projects/${PROJECT_ID}/edits`;
export const LATEST_EDITS_PATH = "/api/edits/latest";
export const FOURTEEN_MINUTES_MS = 14 * 60_000;

/** A finished edit that took 14 min, ≈ $0.62 and 210k tokens. */
export function makeEdit(overrides: Partial<EditSummary> = {}): EditSummary {
  return {
    id: "6f1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d",
    projectId: PROJECT_ID,
    videoId: "v1",
    agentKind: "claude",
    status: "closed",
    startedAt: "2026-10-29T10:00:00.000Z",
    finishedAt: "2026-10-29T10:14:00.000Z",
    costUsd: 0.62,
    costSource: "sdk",
    inputTokens: 200_000,
    outputTokens: 10_000,
    cacheTokens: 50_000,
    turns: 6,
    facts: null,
    ...overrides,
  };
}

/** An edit still open, started 14 minutes before now. */
export function makeOpenEdit(overrides: Partial<EditSummary> = {}): EditSummary {
  return makeEdit({ status: "open", startedAt: new Date(Date.now() - FOURTEEN_MINUTES_MS).toISOString(), finishedAt: null, ...overrides });
}
