// Created by The Angelo Umali.
// propose_cuts blocks here until the user reviews the candidate chips; set_cuts only accepts approved ids (plan §6.8).
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { hasErrorCode } from "@zks/db";
import type { CutCandidate, StudioEvent } from "@zks/shared";
import { z } from "zod";
import type { ToolContext } from "./context.ts";
import { loadProject, projectRootOf } from "./project-files.ts";
import { ToolError } from "./result.ts";
import { writeFileAtomically } from "../specs/spec-files.ts";

type CandidateSpan = Pick<CutCandidate, "id" | "at" | "end">;
type TimeSpan = { readonly at: number; readonly end: number };

// One frame at 30 fps of slack when a tagged removal is checked against its candidate.
const ONE_FRAME_S = 1 / 30;
// Removals covering more than this share of a rejected candidate re-apply it, however they are shifted or split.
const REJECTED_COVERAGE_LIMIT = 0.5;
// Approvals stay in memory so a restart fails closed; the caps bound that memory, and eviction fails closed too.
export const MAX_APPROVED_IDS_PER_PROJECT = 1000;
export const MAX_PROJECTS_WITH_APPROVALS = 100;
// Never evicted: a dropped rejection would let that cut back in, so a full record refuses new rejections instead.
export const MAX_REJECTED_SPANS = 5000;
const REJECTED_SPANS_REL_PATH = "work/cut-review/rejected.json";
const RejectedSpansSchema = z.array(z.object({ id: z.string(), at: z.number(), end: z.number() }));

export interface CutReviewDecision {
  readonly approved: readonly string[];
  readonly rejected: readonly string[];
}

interface PendingReview {
  readonly projectId: string;
  readonly candidates: readonly CandidateSpan[];
  readonly resolve: (decision: CutReviewDecision) => void;
  /** The published cuts.proposed card, kept so a page that opens later still sees it. */
  card?: StudioEvent;
}

const pendingReviews = new Map<string, PendingReview>();
// Insertion order is recency: the first key of either map is the one to evict.
const approvedSpansByProject = new Map<string, Map<string, TimeSpan>>();
const rejectedSpanWrites = new Map<string, Promise<void>>();

export function awaitCutReview(review: { projectId: string; requestId: string; candidates: readonly CandidateSpan[] }, signal?: AbortSignal) {
  return new Promise<CutReviewDecision>((resolve, reject) => {
    const onAbort = () => {
      pendingReviews.delete(review.requestId);
      reject(new Error("The cut review was abandoned"));
    };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
    pendingReviews.set(review.requestId, {
      projectId: review.projectId,
      candidates: review.candidates,
      resolve: (decision) => {
        signal?.removeEventListener("abort", onAbort);
        resolve(decision);
      },
    });
  });
}

export function holdCutReviewCard(card: StudioEvent): void {
  if (card.type !== "cuts.proposed") return;
  const review = pendingReviews.get(card.requestId);
  if (review !== undefined) review.card = card;
}

export function pendingCutReviewCards(projectIds: readonly string[]): StudioEvent[] {
  return [...pendingReviews.values()].filter((review) => projectIds.includes(review.projectId)).flatMap((review) => review.card ?? []);
}

/** Called by the decisions route; ids the user did not approve count as rejected. */
export function resolveCutReview(projectId: string, requestId: string, decision: CutReviewDecision): boolean {
  const review = pendingReviews.get(requestId);
  if (review === undefined || review.projectId !== projectId) return false;
  pendingReviews.delete(requestId);
  const approvedIds = new Set(decision.approved);
  const approved = review.candidates.filter((candidate) => approvedIds.has(candidate.id));
  rememberApprovals(projectId, approved);
  const rejected = review.candidates.filter((candidate) => !approvedIds.has(candidate.id));
  review.resolve({ approved: approved.map((candidate) => candidate.id), rejected: rejected.map((candidate) => candidate.id) });
  return true;
}

function rememberApprovals(projectId: string, approved: readonly CandidateSpan[]): void {
  const approvedSpans = approvedSpansByProject.get(projectId) ?? new Map<string, TimeSpan>();
  approvedSpansByProject.delete(projectId);
  approvedSpansByProject.set(projectId, approvedSpans);
  for (const candidate of approved) approvedSpans.set(candidate.id, { at: candidate.at, end: candidate.end });
  dropOldest(approvedSpans, MAX_APPROVED_IDS_PER_PROJECT);
  dropOldest(approvedSpansByProject, MAX_PROJECTS_WITH_APPROVALS);
}

function dropOldest(entries: Map<string, unknown>, maxSize: number): void {
  for (const key of entries.keys()) {
    if (entries.size <= maxSize) return;
    entries.delete(key);
  }
}

export function approvedCandidateSpan(projectId: string, candidateId: string): TimeSpan | undefined {
  return approvedSpansByProject.get(projectId)?.get(candidateId);
}

/** A tagged removal may not reach past the span the user approved. */
export function reachesOutsideCandidate(removal: TimeSpan, candidate: TimeSpan): boolean {
  return removal.at < candidate.at - ONE_FRAME_S || removal.end > candidate.end + ONE_FRAME_S;
}

/** Persisted in the project folder so a rejection outlives a restart; writes per project run one at a time. */
export function recordRejectedCandidates(context: ToolContext, rejected: readonly CandidateSpan[]): Promise<void> {
  if (rejected.length === 0) return Promise.resolve();
  const previousWrite = rejectedSpanWrites.get(context.projectId) ?? Promise.resolve();
  const write = previousWrite.then(async () => {
    const spans = withoutDuplicates([...(await readRejectedSpans(context)), ...rejected.map(({ id, at, end }) => ({ id, at, end }))]);
    if (spans.length > MAX_REJECTED_SPANS) throw recordFullError();
    await writeFileAtomically(await rejectedSpansPath(context), `${JSON.stringify(spans)}\n`);
  });
  // The queue holds a promise that always settles cleanly: a refused write fails only its own caller.
  const settled = write.then(
    () => undefined,
    () => undefined,
  );
  void settled.then(() => {
    if (rejectedSpanWrites.get(context.projectId) === settled) rejectedSpanWrites.delete(context.projectId);
  });
  rejectedSpanWrites.set(context.projectId, settled);
  return write;
}

/** Checked before a review is shown, as if every candidate were rejected, so a review never half-applies. */
export async function assertRoomForRejections(context: ToolContext, candidates: readonly CandidateSpan[]): Promise<void> {
  if (withoutDuplicates([...(await readRejectedSpans(context)), ...candidates]).length > MAX_REJECTED_SPANS) throw recordFullError();
}

function recordFullError(): ToolError {
  return new ToolError("The record of rejected cuts is full; start a new project for further cut reviews");
}

// Keyed on the span, first id kept: re-rejecting the same span under a new candidate id is the same rejection.
function withoutDuplicates(spans: readonly CandidateSpan[]): CandidateSpan[] {
  const bySpan = new Map<string, CandidateSpan>();
  for (const span of spans) if (!bySpan.has(`${span.at}|${span.end}`)) bySpan.set(`${span.at}|${span.end}`, span);
  return [...bySpan.values()];
}

/** Rejected candidates the removals cover past REJECTED_COVERAGE_LIMIT, taken together so a split cut still counts. */
export async function findRejectedCandidates(context: ToolContext, removals: readonly TimeSpan[]): Promise<string[]> {
  const rejectedSpans = await readRejectedSpans(context);
  const coveredIds = rejectedSpans.filter((candidate) => coveredShare(candidate, removals) > REJECTED_COVERAGE_LIMIT).map((candidate) => candidate.id);
  return [...new Set(coveredIds)];
}

function coveredShare(candidate: TimeSpan, removals: readonly TimeSpan[]): number {
  const candidateLengthS = candidate.end - candidate.at;
  if (candidateLengthS <= 0) return 0;
  const clipped = removals
    .map((removal) => ({ at: Math.max(removal.at, candidate.at), end: Math.min(removal.end, candidate.end) }))
    .filter((span) => span.end > span.at)
    .sort((first, second) => first.at - second.at);
  let coveredS = 0;
  let cursorS = candidate.at;
  for (const span of clipped) {
    coveredS += Math.max(0, span.end - Math.max(span.at, cursorS));
    cursorS = Math.max(cursorS, span.end);
  }
  return coveredS / candidateLengthS;
}

// An unreadable record fails closed: set_cuts refuses rather than forgetting what the user rejected.
async function readRejectedSpans(context: ToolContext): Promise<CandidateSpan[]> {
  let text: string;
  try {
    text = await readFile(await rejectedSpansPath(context), "utf8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return [];
    throw error;
  }
  const parsed = RejectedSpansSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new ToolError("The record of rejected cut candidates is unreadable; ask the user to review the cuts again");
  return parsed.data;
}

async function rejectedSpansPath(context: ToolContext): Promise<string> {
  return join(projectRootOf(context, await loadProject(context)), REJECTED_SPANS_REL_PATH);
}
