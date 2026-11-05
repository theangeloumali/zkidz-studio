// Created by The Angelo Umali.
// propose_cuts, set_cuts and validate_spec (plan §6.8).
import { randomUUID } from "node:crypto";
import { CutSpecSchema, keptSpansOf, type CutSpec } from "@zks/shared";
import { readCapabilities } from "../../jobs/master-files.ts";
import { implementTool } from "../define-tool.ts";
import type { ToolContext } from "../context.ts";
import { findCutCandidates, MAX_PROPOSED_CUTS } from "../cut-candidates.ts";
import {
  approvedCandidateSpan,
  assertRoomForRejections,
  awaitCutReview,
  findRejectedCandidates,
  reachesOutsideCandidate,
  recordRejectedCandidates,
  holdCutReviewCard,
} from "../cut-review.ts";
import { findFootageAsset, loadProject } from "../project-files.ts";
import { ToolError } from "../result.ts";
import { readCurrentSpec, writeAgentSpec } from "../spec-store.ts";
import { readLatestWords } from "../transcript-store.ts";

const proposeCuts = implementTool("propose_cuts", {
  description:
    "Find stutter, filler and pause cut candidates in the transcript and wait while the user approves or rejects each one on the timeline. Use the approved ids as fromCandidate in set_cuts. On a long session pass within: the source spans the edit keeps.",
  handler: async (input, context, signal) => {
    const words = await readLatestWords(context);
    const requestId = randomUUID();
    const candidates = findCutCandidates(words, {
      removeFillers: input.removeFillers ?? true,
      trimPauses: input.trimPauses ?? true,
      idPrefix: requestId.slice(0, 8),
    }).filter((candidate) => input.within === undefined || input.within.some((span) => span.at <= candidate.at && candidate.end <= span.end));
    if (candidates.length > MAX_PROPOSED_CUTS)
      throw new ToolError(
        `${candidates.length} cut candidates are too many to review at once (at most ${MAX_PROPOSED_CUTS}); pass within with the source spans the edit keeps`,
      );
    if (candidates.length === 0) return { output: { candidates, approved: [], rejected: [] } };
    await assertRoomForRejections(context, candidates);
    const review = awaitCutReview({ projectId: context.projectId, requestId, candidates }, signal);
    holdCutReviewCard(await context.events.publish({ type: "cuts.proposed", projectId: context.projectId, requestId, candidates }));
    const decision = await review;
    const rejectedIds = new Set(decision.rejected);
    await recordRejectedCandidates(
      context,
      candidates.filter((candidate) => rejectedIds.has(candidate.id)),
    );
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

const readSpec = implementTool("read_spec", {
  description:
    "Read a video's stored spec (cuts, reels, cues, captions, inserts...) as its current version holds it, or null before one is written. Start from it before set_cuts, which replaces the whole spec.",
  handler: async (input, context) => ({ output: { spec: (await readCurrentSpec(context, input)) ?? null } }),
});

async function findCutSpecErrors(context: ToolContext, cuts: CutSpec): Promise<string[]> {
  const errors: string[] = [];
  await findFootageAsset(context, cuts.sourceAssetId).catch((error: unknown) => errors.push(error instanceof Error ? error.message : String(error)));
  cuts.removals.forEach((removal, removalIndex) => {
    if (removal.end > cuts.durationS) errors.push(`removal ${removalIndex} ends after the source (${cuts.durationS} s)`);
    if (removal.fromCandidate === undefined) return;
    const approvedSpan = approvedCandidateSpan(context.projectId, removal.fromCandidate);
    if (approvedSpan === undefined) errors.push(`removal ${removalIndex} names candidate ${removal.fromCandidate}, which the user has not approved`);
    else if (reachesOutsideCandidate(removal, approvedSpan)) errors.push(`removal ${removalIndex} reaches outside candidate ${removal.fromCandidate}`);
  });
  // Every zoom preset is animated; without the probe's composite, render_master refuses it after rendering the overlays.
  if ((cuts.zooms?.length ?? 0) > 0 && (await readCapabilities(context.studioHome))?.features.zoomExpr === false) {
    errors.push("this machine cannot render zooms (get_capabilities: zoomExpr is false); remove every zooms entry, snap included");
  }
  // The render veils the cropped picture, so a box over an animated zoom would stay put while the picture moves under it.
  (cuts.blurBoxes ?? []).forEach((box, boxIndex) => {
    (cuts.zooms ?? []).forEach((zoom, zoomIndex) => {
      if (box.at < zoom.end && zoom.at < box.end)
        errors.push(`blur box ${boxIndex} overlaps zoom ${zoomIndex}; a box cannot follow a moving crop, so move one of them`);
    });
  });
  // Approved candidates are the user's own cuts, so only untagged removals can re-apply a rejected one.
  const untaggedRemovals = cuts.removals.filter((removal) => removal.fromCandidate === undefined);
  for (const rejectedId of await findRejectedCandidates(context, untaggedRemovals)) {
    errors.push(`the removals cover candidate ${rejectedId}, which the user rejected`);
  }
  return errors;
}

export const cutTools = [proposeCuts, setCuts, validateSpec, readSpec];
