// Created by The Angelo Umali.
// propose_cuts blocks here until the user reviews the candidate chips; set_cuts only accepts approved ids (plan §6.8).
export interface CutReviewDecision {
  readonly approved: readonly string[];
  readonly rejected: readonly string[];
}

interface PendingReview {
  readonly projectId: string;
  readonly candidateIds: ReadonlySet<string>;
  readonly resolve: (decision: CutReviewDecision) => void;
}

const pendingReviews = new Map<string, PendingReview>();
// In memory on purpose: after a restart nothing counts as approved, so set_cuts fails closed.
const approvedIdsByProject = new Map<string, Set<string>>();

export function awaitCutReview(review: { projectId: string; requestId: string; candidateIds: readonly string[] }, signal?: AbortSignal) {
  return new Promise<CutReviewDecision>((resolve, reject) => {
    const onAbort = () => {
      pendingReviews.delete(review.requestId);
      reject(new Error("The cut review was abandoned"));
    };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
    pendingReviews.set(review.requestId, {
      projectId: review.projectId,
      candidateIds: new Set(review.candidateIds),
      resolve: (decision) => {
        signal?.removeEventListener("abort", onAbort);
        resolve(decision);
      },
    });
  });
}

/** Called by the decisions route; ids the user did not approve count as rejected. */
export function resolveCutReview(projectId: string, requestId: string, decision: CutReviewDecision): boolean {
  const review = pendingReviews.get(requestId);
  if (review === undefined || review.projectId !== projectId) return false;
  pendingReviews.delete(requestId);
  const approved = decision.approved.filter((candidateId) => review.candidateIds.has(candidateId));
  const approvedIds = approvedIdsByProject.get(projectId) ?? new Set<string>();
  for (const candidateId of approved) approvedIds.add(candidateId);
  approvedIdsByProject.set(projectId, approvedIds);
  review.resolve({ approved, rejected: [...review.candidateIds].filter((candidateId) => !approvedIds.has(candidateId)) });
  return true;
}

export function isApprovedCandidate(projectId: string, candidateId: string): boolean {
  return approvedIdsByProject.get(projectId)?.has(candidateId) ?? false;
}
