// Created by The Angelo Umali.
// render_master, qc_master, check_motion, make_covers and export_deliverable (plan §6.8, §7.6), each run as a job on its lane.
// render_master answers with the jobId; the others wait for their job and return its report.
import { constants } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { jobs } from "@zks/db/schema";
import { CutSpecSchema, IdSchema, MasterRenderResultSchema, Sha256Schema, SpecsSnapshotRefSchema, STUDIO_TOOLS } from "@zks/shared";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { JobRow } from "../dto.ts";
import { EXPORT_JOB_KIND } from "../jobs/deliverables.ts";
import type { JobRunner, NewJob } from "../jobs/job-runner.ts";
import { findLatestMaster } from "../jobs/master-files.ts";
import { assertNoRenderInFlight, assertRenderedBytes, findRenderOf } from "../jobs/render-provenance.ts";
import { activeSpecSnapshotDir, postCaptionRelPath, readSnapshotSpec, snapshotFilePath } from "../jobs/spec-snapshot.ts";
import type { ToolContext } from "./context.ts";
import { implementTool } from "./define-tool.ts";
import { prepareWorkDir, projectAsset, projectRootOfJob, workRelativePath, type EngineJobDeps } from "./engine-jobs.ts";
import { fenceJobError } from "./job-error-fence.ts";
import { readJobResult, writeJobResult } from "./job-results.ts";
import { assetFilePath, findProjectAsset, loadProject, projectRootOf } from "./project-files.ts";
import { ToolError } from "./result.ts";
import { confinePath } from "../security/confine-path.ts";
import { specRelPath } from "../specs/spec-files.ts";
import { readCurrentSpec, writeAgentSpec } from "./spec-store.ts";
import { readLatestWords } from "./transcript-store.ts";

const RenderTargetSchema = STUDIO_TOOLS.render_master.input.shape.target;
type RenderTarget = z.infer<typeof RenderTargetSchema>;
const RegionSchema = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
const ClipJoinSchema = z.object({ assetId: IdSchema, at: z.number().nonnegative() });

const RenderParamsSchema = z.object({ target: RenderTargetSchema, quality: STUDIO_TOOLS.render_master.input.shape.quality });
const QcParamsSchema = z.object({
  target: RenderTargetSchema,
  masterRelPath: z.string().startsWith("work/"),
  sourceAssetId: IdSchema,
  specsSnapshot: SpecsSnapshotRefSchema,
  masterSha256: Sha256Schema,
  renderInputs: MasterRenderResultSchema.shape.inputs,
  wordsRelPath: z.string().min(1),
});
const MotionParamsSchema = z.object({
  stage: z.enum(["source", "master"]),
  sourceAssetId: IdSchema,
  regions: z.array(RegionSchema),
  clips: z.array(ClipJoinSchema),
});
const CoverParamsSchema = z.object({
  target: RenderTargetSchema.default("full"),
  times: z.array(z.number().nonnegative()).min(1),
  coverSheetRelPath: z.string().min(1).optional(),
  postCaptionRelPath: z.string().min(1).optional(),
});

const EngineMasterDigestSchema = z.object({ relPath: z.string().min(1), sha256: Sha256Schema });
const EngineMasterReportSchema = MasterRenderResultSchema.pick({ frames: true, lufs: true, truePeak: true, bytes: true, inputs: true }).extend({
  path: z.string().min(1),
  master: EngineMasterDigestSchema,
});
// The engine's report also carries the inputs it judged, which qc-status hands to export.
const EngineQcReportSchema = z.object({ ok: z.boolean(), checks: STUDIO_TOOLS.qc_master.output.shape.checks, master: EngineMasterDigestSchema });
const EngineCoversReportSchema = z.object({ covers: z.array(z.object({ path: z.string().min(1) })), postCaption: z.string().min(1).optional() });
const IngestResultSchema = z.object({ joins: z.array(ClipJoinSchema) });

/** The Reels cut renders as its own video id (v1 -> v1r) from the full edit's cut spec. */
function targetVideoId(baseVideoId: string, target: RenderTarget): string {
  return target === "reel" ? `${baseVideoId}r` : baseVideoId;
}

function regionArgs(regions: readonly z.infer<typeof RegionSchema>[]): string[] {
  return regions.flatMap((region) => ["--region", [region.x, region.y, region.w, region.h].join(",")]);
}

const renderMaster = implementTool("render_master", {
  description:
    "Render the full edit or the Reels cut: overlays, SFX mix and the master (4K HEVC on NVIDIA, 1080 elsewhere), gated on the EDL's frame count and -14 LUFS. Returns a jobId; follow it with job_wait, then run qc_master.",
  handler: async (input, context) => {
    const project = await loadProject(context);
    // Fails fast here; the job itself renders the cut spec its snapshot froze.
    await cutSourceAssetId(context, project.videoId);
    const job = await context.jobs.enqueue({ projectId: context.projectId, kind: "render_master", videoId: project.videoId, lane: "gpu", params: input });
    return { output: { jobId: job.id } };
  },
});

const qcMaster = implementTool("qc_master", {
  description:
    "QC the latest master: format, frames vs the EDL, loudness, frozen footage, words clipped or repeated at each cut (re-transcribed), caption contrast, nothing over the mouth in the first 2.5 s, and lip sync at each cut. Export stays blocked until every check passes.",
  handler: async (input, context, signal) => {
    const project = await loadProject(context);
    const projectRoot = projectRootOf(context, project);
    const video = { projectId: context.projectId, videoId: project.videoId };
    await assertNoRenderInFlight(context.db, video, "run qc_master").catch(asToolError);
    const renderedId = targetVideoId(project.videoId, input.target);
    const { master, render } = await latestRenderedMaster(context, projectRoot, project.videoId, input.target);
    const wordsRelPath = `work/qc/${renderedId}.words.json`;
    await writeProjectFile(projectRoot, wordsRelPath, JSON.stringify(await readLatestWords(context, render.source.assetId)));
    const params = {
      target: input.target,
      masterRelPath: master.relPath,
      sourceAssetId: render.source.assetId,
      specsSnapshot: render.specsSnapshot,
      masterSha256: render.sha256,
      renderInputs: render.inputs,
      wordsRelPath,
    };
    const result = await runJobForResult(context, { kind: "qc_master", lane: "whisper", params }, signal);
    return { output: STUDIO_TOOLS.qc_master.output.parse(result) };
  },
});

const checkMotion = implementTool("check_motion", {
  description:
    "Check that footage still moves: each shot of the master (stage master) or each joined clip of the source (stage source) against its original. A frozen shot FAILs and blocks export. regions are boxes on the 1080x1920 grid; the default is the subject's mid-frame.",
  handler: async (input, context, signal) => {
    const project = await loadProject(context);
    // A master is scored against the footage it was cut from, which set_cuts may since have changed.
    const sourceAssetId =
      input.stage === "master"
        ? (await latestRenderedMaster(context, projectRootOf(context, project), project.videoId, "full")).render.source.assetId
        : await cutSourceAssetId(context, project.videoId);
    const clips = input.stage === "source" ? await latestIngestJoins(context) : [];
    const params = { stage: input.stage, sourceAssetId, regions: input.regions ?? [], clips };
    return { output: STUDIO_TOOLS.check_motion.output.parse(await runJobForResult(context, { kind: "check_motion", lane: "cpu", params }, signal)) };
  },
});

const makeCovers = implementTool("make_covers", {
  description:
    "Make cover stills at edited times in the intro format (a settled hookTitle plus that frame's caption); a variant's cue is drawn over the edit. The cut spec's blur boxes are applied to every cover. target reel makes the Reels covers; postCaption (caption and hashtags) is written as the post's caption.txt.",
  handler: async (input, context, signal) => {
    const project = await loadProject(context);
    const target = input.target ?? "full";
    const coverCues = input.variants.flatMap((variant) => (variant.cue === undefined ? [] : [variant.cue]));
    let coverSheetRelPath: string | undefined;
    if (coverCues.length > 0) {
      await writeAgentSpec(context, { videoId: project.videoId, kind: "cues_cover" }, coverCues);
      coverSheetRelPath = specRelPath({ videoId: project.videoId, kind: "cues_cover" });
    }
    let captionRelPath: string | undefined;
    if (input.postCaption !== undefined) {
      captionRelPath = postCaptionRelPath(project.videoId);
      await writeProjectFile(projectRootOf(context, project), captionRelPath, input.postCaption);
    }
    const params = {
      target,
      times: input.variants.map((variant) => variant.at),
      ...(coverSheetRelPath === undefined ? {} : { coverSheetRelPath }),
      ...(captionRelPath === undefined ? {} : { postCaptionRelPath: captionRelPath }),
    };
    return { output: STUDIO_TOOLS.make_covers.output.parse(await runJobForResult(context, { kind: "make_covers", lane: "overlay", params }, signal)) };
  },
});

const exportDeliverable = implementTool("export_deliverable", {
  description:
    "Copy the latest masters and covers into the project's deliverables/ folder, each with its SHA-256. Refused unless qc_master passed on the latest master.",
  handler: async (input, context, signal) => {
    const result = await runJobForResult(context, { kind: EXPORT_JOB_KIND, lane: "cpu", params: { kinds: input.kinds } }, signal);
    return { output: STUDIO_TOOLS.export_deliverable.output.parse(result) };
  },
});

export const renderTools = [renderMaster, qcMaster, checkMotion, makeCovers, exportDeliverable];

async function cutSourceAssetId(context: ToolContext, videoId: string): Promise<string> {
  const parsedCuts = CutSpecSchema.safeParse(await readCurrentSpec(context, { videoId, kind: "cuts" }));
  if (!parsedCuts.success) throw new ToolError(`${videoId} has no valid cut spec yet: call set_cuts first`);
  await findProjectAsset(context, parsedCuts.data.sourceAssetId);
  return parsedCuts.data.sourceAssetId;
}

async function latestIngestJoins(context: ToolContext): Promise<z.infer<typeof ClipJoinSchema>[]> {
  const [ingestJob] = await context.db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.projectId, context.projectId), eq(jobs.kind, "ingest"), eq(jobs.status, "succeeded")))
    .orderBy(desc(jobs.queuedAt))
    .limit(1);
  if (ingestJob === undefined) throw new ToolError("No ingest has finished yet: call ingest first");
  const ingestResult = IngestResultSchema.safeParse(await readJobResult(projectRootOf(context, await loadProject(context)), ingestJob.id));
  if (!ingestResult.success) throw new ToolError("The last ingest left no joins to compare against");
  return ingestResult.data.joins;
}

function asToolError(error: unknown): never {
  throw new ToolError(error instanceof Error ? error.message : String(error));
}

/** The newest master of a rendered video and the render_master that wrote it, whose source and snapshot QC must reuse. */
async function latestRenderedMaster(context: ToolContext, projectRoot: string, videoId: string, target: RenderTarget) {
  const renderedId = targetVideoId(videoId, target);
  const master = await findLatestMaster(projectRoot, renderedId);
  if (master === undefined) throw new ToolError(`${renderedId} has no master in work/out; run render_master first`);
  const render = await findRenderOf(context.db, projectRoot, { projectId: context.projectId, videoId }, master.relPath);
  if (render === undefined) throw new ToolError(`No finished render_master produced ${master.relPath}; re-render it`);
  return { master, render };
}

// O_NOFOLLOW refuses a link planted as the file itself; the folder is confined separately.
const WRITE_FLAGS = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0);

async function writeProjectFile(projectRoot: string, relPath: string, text: string): Promise<void> {
  await mkdir(join(projectRoot, dirname(relPath)), { recursive: true });
  const folder = await confinePath(projectRoot, dirname(relPath)).catch(asToolError);
  await writeFile(join(folder, basename(relPath)), text, { mode: 0o600, flag: WRITE_FLAGS });
}

type ReportJob = Pick<NewJob, "kind" | "lane" | "params">;

/** Enqueues the job and waits for it; a failed job's error comes back as a ToolError with the project folder masked. */
async function runJobForResult(context: ToolContext, reportJob: ReportJob, signal: AbortSignal | undefined): Promise<unknown> {
  const project = await loadProject(context);
  const finishedJobIds = new Set<string>();
  let onFinished: () => void = () => undefined;
  const unsubscribe = context.events.subscribe([context.projectId], (event) => {
    if (event.type !== "job.finished") return;
    finishedJobIds.add(event.jobId);
    onFinished();
  });
  try {
    const job = await context.jobs.enqueue({ projectId: context.projectId, videoId: project.videoId, ...reportJob });
    await new Promise<void>((resolve, reject) => {
      onFinished = () => (finishedJobIds.has(job.id) ? resolve() : undefined);
      onFinished();
      signal?.addEventListener("abort", () => reject(new ToolError(`Cancelled; job ${job.id} keeps running, follow it with job_wait`)), { once: true });
    });
    const [finished] = await context.db.select().from(jobs).where(eq(jobs.id, job.id));
    const projectRoot = projectRootOf(context, project);
    // Engine text can quote the edit itself, so it reaches Claude fenced as data.
    if (finished?.status !== "succeeded")
      throw new ToolError(fenceJobError((finished?.error ?? `The ${reportJob.kind} job did not finish`).replaceAll(projectRoot, "<project>")));
    return await readJobResult(projectRoot, job.id);
  } finally {
    unsubscribe();
  }
}

export function registerRenderJobHandlers(jobRunner: JobRunner, deps: EngineJobDeps): void {
  jobRunner.registerHandler("render_master", (job, _reportProgress, signal) => runRenderMaster(deps, job, signal));
  jobRunner.registerHandler("qc_master", (job, _reportProgress, signal) => runQcMaster(deps, job, signal));
  jobRunner.registerHandler("check_motion", (job, _reportProgress, signal) => runCheckMotion(deps, job, signal));
  jobRunner.registerHandler("make_covers", (job, _reportProgress, signal) => runMakeCovers(deps, job, signal));
}

/** An asset's file for --source, and the in-place registration the engine needs to accept a file outside the project. */
async function assetInput(deps: EngineJobDeps, job: JobRow, assetId: string) {
  const asset = await projectAsset(deps.db, { projectId: job.projectId, assetId });
  return { asset, path: assetFilePath(await projectRootOfJob(deps, job), asset), inPlacePaths: asset.inPlacePath === null ? [] : [asset.inPlacePath] };
}

function requireSnapshotDir(job: JobRow): string {
  const snapshotDir = activeSpecSnapshotDir();
  if (snapshotDir === undefined) throw new Error(`${job.kind} ran without its spec snapshot`);
  return snapshotDir;
}

/** Renders the cut spec the job's snapshot froze, and records that source and snapshot for QC and export to match. */
async function runRenderMaster(deps: EngineJobDeps, job: JobRow, signal: AbortSignal): Promise<void> {
  const params = RenderParamsSchema.parse(job.params);
  const cuts = CutSpecSchema.parse(await readSnapshotSpec(requireSnapshotDir(job), { videoId: job.videoId, kind: "cuts" }));
  const projectRoot = await projectRootOfJob(deps, job);
  const workDir = await prepareWorkDir(projectRoot, "out");
  const source = await assetInput(deps, job, cuts.sourceAssetId);
  const args = ["--video", targetVideoId(job.videoId, params.target), "--quality", params.quality, "--source", source.path];
  const { master, ...report } = EngineMasterReportSchema.parse(
    await deps.engine.run({ command: "render-master", args, workDir, inPlacePaths: source.inPlacePaths, signal }),
  );
  if (master.relPath !== report.path) throw new Error(`render-master hashed ${master.relPath}, not the master it wrote at ${report.path}`);
  const result = MasterRenderResultSchema.parse({
    ...report,
    path: workRelativePath(workDir, report.path),
    sha256: master.sha256,
    source: { assetId: source.asset.id, relPath: source.asset.relPath ?? source.asset.inPlacePath },
    specsSnapshot: `snapshots/${job.specSnapshotSha256}`,
  });
  await writeJobResult(projectRoot, job.id, result);
}

async function runQcMaster(deps: EngineJobDeps, job: JobRow, signal: AbortSignal): Promise<void> {
  const params = QcParamsSchema.parse(job.params);
  await assertNoRenderInFlight(deps.db, job, "run qc_master");
  const projectRoot = await projectRootOfJob(deps, job);
  const workDir = await prepareWorkDir(projectRoot, "qc");
  const source = await assetInput(deps, job, params.sourceAssetId);
  const master = params.masterRelPath.slice("work/".length);
  const args = ["--video", targetVideoId(job.videoId, params.target), "--master", master, "--source", source.path];
  args.push("--specs", params.specsSnapshot, "--words", join(projectRoot, params.wordsRelPath), "--render-inputs", JSON.stringify(params.renderInputs));
  const report = EngineQcReportSchema.parse(await deps.engine.run({ command: "qc-master", args, workDir, inPlacePaths: source.inPlacePaths, signal }));
  if (report.master.relPath !== master) throw new Error(`qc-master judged ${report.master.relPath}, not ${master}`);
  assertRenderedBytes(params.masterRelPath, { sha256: params.masterSha256 }, report.master.sha256);
  await writeJobResult(projectRoot, job.id, { ok: report.ok, checks: report.checks });
}

async function runCheckMotion(deps: EngineJobDeps, job: JobRow, signal: AbortSignal): Promise<void> {
  const params = MotionParamsSchema.parse(job.params);
  const projectRoot = await projectRootOfJob(deps, job);
  const workDir = await prepareWorkDir(projectRoot, "qc");
  const clips = await Promise.all(params.clips.map(async (clip) => ({ input: await assetInput(deps, job, clip.assetId), at: clip.at })));
  const source = await assetInput(deps, job, params.sourceAssetId);
  const clipArgs = clips.flatMap((clip) => ["--clip", `${clip.input.path}@${clip.at}`]);
  const args = ["--video", job.videoId, "--stage", params.stage, "--source", source.path, ...regionArgs(params.regions), ...clipArgs];
  const inPlacePaths = [...source.inPlacePaths, ...clips.flatMap((clip) => clip.input.inPlacePaths)];
  const report = await deps.engine.run({ command: "check-motion", args, workDir, inPlacePaths, signal });
  await writeJobResult(projectRoot, job.id, STUDIO_TOOLS.check_motion.output.parse(report));
}

async function runMakeCovers(deps: EngineJobDeps, job: JobRow, signal: AbortSignal): Promise<void> {
  const params = CoverParamsSchema.parse(job.params);
  const projectRoot = await projectRootOfJob(deps, job);
  const workDir = await prepareWorkDir(projectRoot, "covers");
  // Both inputs come from the job's snapshot, so an edit after the job started cannot reach the covers.
  const snapshotDir = requireSnapshotDir(job);
  const sheetArgs = params.coverSheetRelPath === undefined ? [] : ["--cover-sheet", snapshotFilePath(snapshotDir, params.coverSheetRelPath)];
  const captionArgs = params.postCaptionRelPath === undefined ? [] : ["--post-caption", snapshotFilePath(snapshotDir, params.postCaptionRelPath)];
  const timeArgs = params.times.flatMap((at) => ["--at", String(at)]);
  const args = ["--video", targetVideoId(job.videoId, params.target), ...timeArgs, ...sheetArgs, ...captionArgs];
  const report = EngineCoversReportSchema.parse(await deps.engine.run({ command: "make-covers", args, workDir, signal }));
  await writeJobResult(projectRoot, job.id, {
    covers: report.covers.map((cover) => ({ path: workRelativePath(workDir, cover.path) })),
    ...(report.postCaption === undefined ? {} : { postCaption: workRelativePath(workDir, report.postCaption) }),
  });
}
