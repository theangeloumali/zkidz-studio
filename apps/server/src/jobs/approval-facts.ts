// Created by The Angelo Umali.
// The render and export facts the Phase 2 gate cards left empty: what a render costs on the GPU and which files each job writes.
import { CutSpecSchema, ReelSpecSchema, STUDIO_TOOLS, type ApprovalFacts } from "@zks/shared";
import type { z } from "zod";
import type { SpecAddress } from "../specs/spec-files.ts";
import type { ToolContext } from "../tools/context.ts";
import { loadProject, projectRootOf } from "../tools/project-files.ts";
import { readCurrentSpec } from "../tools/spec-store.ts";
import { plannedDeliverableNames } from "./deliverables.ts";
import { describeRenderAction, predictMasterPaths, readRenderProfile, renderedVideoId } from "./master-files.ts";
import { readSnapshotSpec, specSnapshotDir } from "./spec-snapshot.ts";

type JobOutputFacts = Pick<ApprovalFacts, "estimatedGpuMinutes" | "outputPaths"> & { readonly action?: string };

// ASSUMPTION: the reference GPU encodes 4K at 66 fps over 4 chunks; every quality is costed at that rate, as an upper bound.
const MEASURED_4K_RENDER_FPS = 66;
const NTSC_FPS = 30000 / 1001;
const SECONDS_PER_MINUTE = 60;
const TENTHS = 10;

type SpecReader = (address: SpecAddress) => Promise<unknown>;

/** Null for a tool that writes no job output, or input outside the tool's contract. A render is costed from the given
 * spec snapshot, else from the current specs. */
export async function describeJobOutputFacts(
  context: ToolContext,
  toolName: string,
  input: unknown,
  specSnapshotSha256?: string,
): Promise<JobOutputFacts | null> {
  if (toolName === "render_master") {
    const parsed = STUDIO_TOOLS.render_master.input.safeParse(input);
    return parsed.success ? describeRender(context, parsed.data, await specReaderFor(context, specSnapshotSha256)) : null;
  }
  if (toolName === "export_deliverable") {
    const parsed = STUDIO_TOOLS.export_deliverable.input.safeParse(input);
    if (!parsed.success) return null;
    const project = await loadProject(context);
    const names = await plannedDeliverableNames(projectRootOf(context, project), project.videoId, project.slug, parsed.data.kinds);
    return { outputPaths: names.map((name) => `deliverables/${name}`) };
  }
  return null;
}

type RenderInput = z.output<typeof STUDIO_TOOLS.render_master.input>;
type CutSpec = z.output<typeof CutSpecSchema>;

async function specReaderFor(context: ToolContext, specSnapshotSha256: string | undefined): Promise<SpecReader> {
  if (specSnapshotSha256 === undefined) return (address) => readCurrentSpec(context, address);
  const snapshotDir = specSnapshotDir(projectRootOf(context, await loadProject(context)), specSnapshotSha256);
  return (address) => readSnapshotSpec(snapshotDir, address);
}

async function describeRender(context: ToolContext, input: RenderInput, readSpec: SpecReader): Promise<JobOutputFacts> {
  const { videoId } = await loadProject(context);
  const profile = await readRenderProfile(context.studioHome);
  const outputPaths = predictMasterPaths(renderedVideoId(videoId, input.target), input.quality, profile);
  const action = describeRenderAction(input.quality, profile);
  const cuts = CutSpecSchema.safeParse(await readSpec({ videoId, kind: "cuts" }));
  const keptSeconds = input.target === "reel" ? await measureReelSeconds(readSpec, videoId) : cuts.success ? keptCutSeconds(cuts.data) : undefined;
  if (keptSeconds === undefined) return { action, outputPaths };
  const footageFps = cuts.success ? cuts.data.fps.num / cuts.data.fps.den : NTSC_FPS;
  const gpuMinutes = (keptSeconds * footageFps) / MEASURED_4K_RENDER_FPS / SECONDS_PER_MINUTE;
  return { action, estimatedGpuMinutes: Math.ceil(gpuMinutes * TENTHS) / TENTHS, outputPaths };
}

async function measureReelSeconds(readSpec: SpecReader, videoId: string): Promise<number | undefined> {
  const reel = ReelSpecSchema.safeParse(await readSpec({ videoId, kind: "reels" }));
  return reel.success ? reel.data.keep.reduce((total, keep) => total + (keep.end - keep.at), 0) : undefined;
}

/** Removals may overlap, so they are merged before summing. */
function keptCutSeconds(cuts: CutSpec): number {
  const sorted = [...cuts.removals].sort((left, right) => left.at - right.at);
  let total = 0;
  let mergedEnd = Number.NEGATIVE_INFINITY;
  for (const removal of sorted) {
    const start = Math.max(removal.at, mergedEnd);
    if (removal.end > start) total += removal.end - start;
    mergedEnd = Math.max(mergedEnd, removal.end);
  }
  return cuts.durationS - total;
}
