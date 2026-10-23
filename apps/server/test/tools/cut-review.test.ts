// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import {
  approvedCandidateSpan,
  awaitCutReview,
  MAX_APPROVED_IDS_PER_PROJECT,
  MAX_PROJECTS_WITH_APPROVALS,
  resolveCutReview,
} from "../../src/tools/cut-review.ts";

function approveAll(projectId: string, candidateIds: readonly string[]) {
  const requestId = crypto.randomUUID();
  const review = awaitCutReview({ projectId, requestId, candidates: candidateIds.map((id, index) => ({ id, at: index, end: index + 0.5 })) });
  resolveCutReview(projectId, requestId, { approved: [...candidateIds], rejected: [] });
  return review;
}

describe("cut review approvals", () => {
  it("keeps at most MAX_APPROVED_IDS_PER_PROJECT approvals per project, dropping the oldest", async () => {
    const projectId = crypto.randomUUID();
    const candidateIds = Array.from({ length: MAX_APPROVED_IDS_PER_PROJECT + 1 }, (_, index) => `c${index}`);
    await approveAll(projectId, candidateIds);
    expect(approvedCandidateSpan(projectId, "c0")).toBeUndefined();
    expect(approvedCandidateSpan(projectId, `c${MAX_APPROVED_IDS_PER_PROJECT}`)).toEqual({
      at: MAX_APPROVED_IDS_PER_PROJECT,
      end: MAX_APPROVED_IDS_PER_PROJECT + 0.5,
    });
  });

  it("forgets the least recently reviewed project past MAX_PROJECTS_WITH_APPROVALS", async () => {
    const projectIds = Array.from({ length: MAX_PROJECTS_WITH_APPROVALS + 1 }, () => crypto.randomUUID());
    for (const projectId of projectIds) await approveAll(projectId, ["only"]);
    expect(approvedCandidateSpan(projectIds[0] ?? "", "only")).toBeUndefined();
    expect(approvedCandidateSpan(projectIds.at(-1) ?? "", "only")).toBeDefined();
  });
});
