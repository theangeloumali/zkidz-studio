// Created by The Angelo Umali.
// propose_cuts, set_cuts and validate_spec (plan §6.8).
import { randomUUID } from "node:crypto";
import { CutSpecSchema, type CutSpec } from "@zks/shared";
import { implementTool } from "../define-tool.ts";
import type { ToolContext } from "../context.ts";
import { findCutCandidates } from "../cut-candidates.ts";
import { awaitCutReview, isApprovedCandidate } from "../cut-review.ts";
import { findProjectAsset, loadProject } from "../project-files.ts";
import { ToolError } from "../result.ts";
import { readCurrentSpec, writeAgentSpec } from "../spec-store.ts";
import { readLatestWords } from "../transcript-store.ts";

const proposeCuts = implementTool("propose_cuts", {
  description:
    "Find stutter, filler and pause cut candidates in the transcript and wait while the user approves or rejects each one on the timeline. Use the approved ids as fromCandidate in set_cuts.",
  handler: async (input, context, signal) => {
    const words = await readLatestWords(context);
    const requestId = randomUUID();
    const candidates = findCutCandidates(words, {
      removeFillers: input.removeFillers ?? true,
      trimPauses: input.trimPauses ?? true,
      idPrefix: requestId.slice(0, 8),
    });
    if (candidates.length === 0) return { output: { candidates, approved: [], rejected: [] } };
    const review = awaitCutReview({ projectId: context.projectId, requestId, candidateIds: candidates.map((candidate) => candidate.id) }, signal);
    await context.events.publish({ type: "cuts.proposed", projectId: context.projectId, requestId, candidates });
    const decision = await review;
    return { output: { candidates, approved: [...decision.approved], rejected: [...decision.rejected] } };
  },
});

const setCuts = implementTool("set_cuts", {
  description:
    "Replace the cut spec of the full edit. Media is named by assetId only; removals from propose_cuts must name approved candidate ids in fromCandidate.",
  handler: async (input, context) => {
    const errors = await findCutSpecErrors(context, input.cuts);
    if (errors.length > 0) throw new ToolError(errors.join("; "));
    const project = await loadProject(context);
    const version = await writeAgentSpec(context, { videoId: project.videoId, kind: "cuts" }, input.cuts);
    const keptSpans = keptSpansOf(input.cuts);
    const warnings = input.cuts.trimPauses === undefined ? [] : ["keptS is before pause trimming, which the engine applies at render"];
    const keptS = keptSpans.reduce((total, span) => total + (span.end - span.at), 0);
    return { output: { version, warnings, segments: keptSpans.length, keptS } };
  },
});

const validateSpec = implementTool("validate_spec", {
  description: "Check the stored specs of a video against their schemas and this project's media. Returns every error found.",
  handler: async (input, context) => {
    const storedCuts = await readCurrentSpec(context, { videoId: input.videoId, kind: "cuts" });
    if (storedCuts === undefined) return { output: { errors: [`${input.videoId} has no cut spec yet`] }, isError: true };
    const parsedCuts = CutSpecSchema.safeParse(storedCuts);
    const errors = parsedCuts.success ? await findCutSpecErrors(context, parsedCuts.data) : parsedCuts.error.issues.map((issue) => issue.message);
    return { output: { errors }, isError: errors.length > 0 };
  },
});

async function findCutSpecErrors(context: ToolContext, cuts: CutSpec): Promise<string[]> {
  const errors: string[] = [];
  await findProjectAsset(context, cuts.sourceAssetId).catch((error: unknown) => errors.push(error instanceof Error ? error.message : String(error)));
  cuts.removals.forEach((removal, removalIndex) => {
    if (removal.end > cuts.durationS) errors.push(`removal ${removalIndex} ends after the source (${cuts.durationS} s)`);
    if (removal.fromCandidate !== undefined && !isApprovedCandidate(context.projectId, removal.fromCandidate)) {
      errors.push(`removal ${removalIndex} names candidate ${removal.fromCandidate}, which the user has not approved`);
    }
  });
  return errors;
}

/** The source minus the merged removals; the engine's EDL adds pause trimming and frame snapping on top. */
function keptSpansOf(cuts: CutSpec): { at: number; end: number }[] {
  const removals = [...cuts.removals].sort((first, second) => first.at - second.at);
  const keptSpans: { at: number; end: number }[] = [];
  let cursorS = 0;
  for (const removal of removals) {
    if (removal.at > cursorS) keptSpans.push({ at: cursorS, end: removal.at });
    cursorS = Math.max(cursorS, removal.end);
  }
  if (cuts.durationS > cursorS) keptSpans.push({ at: cursorS, end: cuts.durationS });
  return keptSpans;
}

export const cutTools = [proposeCuts, setCuts, validateSpec];
