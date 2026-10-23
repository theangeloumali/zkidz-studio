// Created by The Angelo Umali.
// Job handlers for the engine steps the Phase 2 tools start: ingest (join + prepare) and transcribe.
import { mkdir, stat, writeFile } from "node:fs/promises";
import { probeColumns } from "../routes/media-ingest.ts";
import type { ProbeResult } from "../media-io/probe.ts";
import { join } from "node:path";
import type { StudioDatabase } from "@zks/db";
import { mediaAssets, projects, transcripts } from "@zks/db/schema";
import { IdSchema, InsertSpecSchema, SourceSecondsSchema, type IngestMode } from "@zks/shared";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { projectDir } from "../config.ts";
import type { JobRow } from "../dto.ts";
import { isWithinDir } from "../fs/path-policy.ts";
import type { JobRunner, ReportProgress } from "../jobs/job-runner.ts";
import { readProjectTemplate } from "../onboarding/project-template.ts";
import { writeJobResult } from "./job-results.ts";
import { assetFilePath } from "./project-files.ts";

/** Every zks-engine subcommand the server spawns; engine-cli-contract.test.ts runs each against the real CLI. */
export const ENGINE_COMMANDS = ["ingest", "transcribe"] as const;
type EngineCommand = (typeof ENGINE_COMMANDS)[number];

export interface EngineRequest {
  readonly command: EngineCommand;
  readonly args: readonly string[];
  /** The project's work/ folder; the engine resolves every relative path it prints against it. */
  readonly workDir: string;
  /** In-place files the command reads; the engine refuses any other input outside the project. */
  readonly inPlacePaths?: readonly string[];
}

/** Runs one engine command and returns its parsed JSON report. */
export interface EngineRunner {
  readonly run: (request: EngineRequest) => Promise<unknown>;
}

export interface EngineJobDeps {
  readonly db: StudioDatabase;
  readonly studioHome: string;
  readonly engine: EngineRunner;
  /** ffprobe on the joined source, so the Media list shows it like an upload. */
  readonly probeSource: (filePath: string) => Promise<ProbeResult>;
}

const WorkPathSchema = z.string().min(1);
const TranscribeParamsSchema = z.object({ language: z.string(), model: z.string() });
const TranscribeReportSchema = z.object({ wordsPath: WorkPathSchema, words: z.int().nonnegative(), chunks: z.int().positive() });
const IngestParamsSchema = z.object({
  clips: z.array(z.object({ assetId: IdSchema, zoom: z.number().positive().optional() })).min(1),
  inserts: InsertSpecSchema.optional(),
});
const IngestReportSchema = z.object({
  sourcePath: WorkPathSchema,
  frames: z.int().positive(),
  joins: z.array(z.object({ clip: z.int().nonnegative(), at: SourceSecondsSchema })),
});

export function registerEngineJobHandlers(jobRunner: JobRunner, deps: EngineJobDeps): void {
  jobRunner.registerHandler("transcribe", (job, reportProgress) => runTranscribe(deps, job, reportProgress));
  jobRunner.registerHandler("ingest", (job, reportProgress) => runIngest(deps, job, reportProgress));
}

async function runTranscribe(deps: EngineJobDeps, job: JobRow, reportProgress: ReportProgress): Promise<void> {
  const params = TranscribeParamsSchema.parse(job.params);
  const projectRoot = await projectRootOfJob(deps, job);
  const workDir = await prepareWorkDir(projectRoot, "transcripts");
  await reportProgress({ stage: "transcribing", pct: 0 });
  const args = ["--video", job.videoId, "--language", params.language, "--model", params.model];
  const report = TranscribeReportSchema.parse(await deps.engine.run({ command: "transcribe", args, workDir }));
  const mediaAssetId = await transcribedAssetId(deps.db, job.projectId);
  await deps.db.insert(transcripts).values({
    projectId: job.projectId,
    mediaAssetId,
    model: params.model,
    language: params.language,
    wordsRelPath: workRelativePath(workDir, report.wordsPath),
    wordCount: report.words,
  });
  await writeJobResult(projectRoot, job.id, { words: report.words, chunks: report.chunks });
  await reportProgress({ stage: "transcribed", pct: 100 });
}

async function runIngest(deps: EngineJobDeps, job: JobRow, reportProgress: ReportProgress): Promise<void> {
  const params = IngestParamsSchema.parse(job.params);
  const projectRoot = await projectRootOfJob(deps, job);
  const workDir = await prepareWorkDir(projectRoot, "sources");
  const inPlacePaths: string[] = [];
  const resolvePath = async (assetId: string) => {
    const asset = await projectAsset(deps.db, { projectId: job.projectId, assetId });
    if (asset.inPlacePath !== null) inPlacePaths.push(asset.inPlacePath);
    return assetFilePath(projectRoot, asset);
  };
  const clipArgs = await Promise.all(
    params.clips.map(async (clip) => ["--clip", clip.zoom === undefined ? await resolvePath(clip.assetId) : `${await resolvePath(clip.assetId)}@${clip.zoom}`]),
  );
  const insertArgs =
    params.inserts === undefined ? [] : ["--inserts", await writeResolvedInserts({ workDir, videoId: job.videoId, inserts: params.inserts }, resolvePath)];
  const mode = ingestModeFor(params, (await readProjectTemplate(deps.db, job.projectId))?.ingestMode);
  await reportProgress({ stage: "joining", pct: 0 });
  // --mode before the clips: the engine's argv ends with the clip list.
  const args = ["--video", job.videoId, "--mode", mode, ...insertArgs, ...clipArgs.flat()];
  const report = IngestReportSchema.parse(await deps.engine.run({ command: "ingest", args, workDir, inPlacePaths }));

  const relPath = workRelativePath(workDir, report.sourcePath);
  const sourcePath = join(projectRoot, relPath);
  const [sourceStat, probe] = await Promise.all([stat(sourcePath), deps.probeSource(sourcePath)]);
  const probed = { ...probeColumns(probe), kind: "source" as const };
  const [source] = await deps.db
    .insert(mediaAssets)
    .values({
      projectId: job.projectId,
      name: `${job.videoId} source`,
      relPath,
      bytes: sourceStat.size,
      mtimeMs: Math.round(sourceStat.mtimeMs),
      ...probed,
    })
    .onConflictDoUpdate({
      target: [mediaAssets.projectId, mediaAssets.relPath],
      set: { bytes: sourceStat.size, mtimeMs: Math.round(sourceStat.mtimeMs), ...probed },
    })
    .returning();
  if (source === undefined) throw new Error("source asset upsert returned no row");
  const joins = report.joins.map((join) => ({ assetId: params.clips[join.clip]?.assetId, at: join.at }));
  await writeJobResult(projectRoot, job.id, { sourceAssetId: source.id, frames: report.frames, joins });
  await reportProgress({ stage: "joined", pct: 100 });
}

/** The template's mode when this footage fits it (the engine rejects a misfit); otherwise the mode the footage implies. */
function ingestModeFor(params: z.infer<typeof IngestParamsSchema>, stored: IngestMode | undefined): IngestMode {
  const hasInserts = params.inserts !== undefined;
  const oneClip = params.clips.length === 1;
  const fits = { single: oneClip && !hasInserts, join: !hasInserts, showcase: oneClip && hasInserts };
  if (stored !== undefined && fits[stored]) return stored;
  if (hasInserts) return "showcase";
  return oneClip ? "single" : "join";
}

/** The engine reads inserts by path, so the server writes them with each assetId resolved. */
async function writeResolvedInserts(
  target: { workDir: string; videoId: string; inserts: z.infer<typeof InsertSpecSchema> },
  resolvePath: (assetId: string) => Promise<string>,
): Promise<string> {
  const resolvedInserts = await Promise.all(target.inserts.map(async (insert) => ({ ...insert, srcPath: await resolvePath(insert.srcAssetId) })));
  const insertsPath = join(target.workDir, "inserts", `${target.videoId}.json`);
  await mkdir(join(target.workDir, "inserts"), { recursive: true });
  await writeFile(insertsPath, JSON.stringify(resolvedInserts), { mode: 0o600 });
  return insertsPath;
}

async function projectRootOfJob(deps: EngineJobDeps, job: JobRow): Promise<string> {
  const [project] = await deps.db.select({ slug: projects.slug }).from(projects).where(eq(projects.id, job.projectId));
  if (project === undefined) throw new Error("The job's project no longer exists");
  return projectDir(deps.studioHome, project.slug);
}

async function prepareWorkDir(projectRoot: string, outputDir: string): Promise<string> {
  const workDir = join(projectRoot, "work");
  await mkdir(join(workDir, outputDir), { recursive: true });
  return workDir;
}

async function projectAsset(db: StudioDatabase, ids: { projectId: string; assetId: string }) {
  const [asset] = await db
    .select()
    .from(mediaAssets)
    .where(and(eq(mediaAssets.id, ids.assetId), eq(mediaAssets.projectId, ids.projectId)));
  if (asset === undefined) throw new Error(`Asset ${ids.assetId} is not part of this project`);
  return asset;
}

/** The joined source when there is one, else the first clip. */
async function transcribedAssetId(db: StudioDatabase, projectId: string): Promise<string> {
  const [source] = await db
    .select({ id: mediaAssets.id })
    .from(mediaAssets)
    .where(and(eq(mediaAssets.projectId, projectId), eq(mediaAssets.kind, "source")))
    .orderBy(desc(mediaAssets.createdAt))
    .limit(1);
  if (source !== undefined) return source.id;
  const [firstClip] = await db
    .select({ id: mediaAssets.id })
    .from(mediaAssets)
    .where(eq(mediaAssets.projectId, projectId))
    .orderBy(asc(mediaAssets.createdAt))
    .limit(1);
  if (firstClip === undefined) throw new Error("The project has no media to transcribe");
  return firstClip.id;
}

// A report path is engine output: it must stay inside work/ before the server stores or opens it.
function workRelativePath(workDir: string, reportedPath: string): string {
  const absolutePath = join(workDir, reportedPath);
  if (!isWithinDir(absolutePath, workDir)) throw new Error("The engine reported a path outside the project");
  return join("work", reportedPath).split("\\").join("/");
}
