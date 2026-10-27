// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import {
  approvedCandidateSpan,
  awaitCutReview,
  holdCutReviewCard,
  MAX_APPROVED_IDS_PER_PROJECT,
  MAX_PROJECTS_WITH_APPROVALS,
  pendingCutReviewCards,
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

describe("pending cut review cards", () => {
  it("lists a held cuts.proposed card until its review is decided", async () => {
    const projectId = crypto.randomUUID();
    const requestId = crypto.randomUUID();
    const candidates = [{ id: "c1", kind: "filler" as const, at: 1, end: 2, context: "um", reason: "Filler word" }];
    const review = awaitCutReview({ projectId, requestId, candidates });
    const card = { type: "cuts.proposed" as const, projectId, requestId, candidates, id: 41, at: "2026-10-24T10:00:00.000Z" };
    holdCutReviewCard(card);

    expect(pendingCutReviewCards([projectId])).toEqual([card]);
    expect(pendingCutReviewCards([crypto.randomUUID()])).toEqual([]);
    resolveCutReview(projectId, requestId, { approved: [], rejected: ["c1"] });
    await review;
    expect(pendingCutReviewCards([projectId])).toEqual([]);
  });
});
