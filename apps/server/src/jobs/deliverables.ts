// Created by The Angelo Umali.
// Plan §7.6 export: each master is copied into ZKS_HOME/projects/<slug>/deliverables/ and recorded with its SHA-256.
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, open, rename, rm, type FileHandle } from "node:fs/promises";
import { basename, join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { StudioDatabase } from "@zks/db";
import { deliverables, jobs } from "@zks/db/schema";
import { STUDIO_TOOLS, type DeliverableKind, type DeliverableSchema } from "@zks/shared";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { projectDir } from "../config.ts";
import { findProjectOrThrow } from "../projects/project-store.ts";
import { writeJobResult } from "../tools/job-results.ts";
import type { EngineProcessRunner } from "./engine-process.ts";
import type { JobRunner } from "./job-runner.ts";
import { findLatestMaster } from "./master-files.ts";

const OWNER_ONLY_FILE_MODE = 0o600;
export const EXPORT_JOB_KIND = "export_deliverable";
const IN_FLIGHT_STATUSES = ["queued", "running"] as const;
// qc-status names the exact master it passed; mtimeNs is a string because a JS number cannot hold it exactly.
const QcVerdictSchema = z.object({ ok: z.literal(true), master: z.string(), bytes: z.int().nonnegative(), mtimeNs: z.string().regex(/^\d+$/) });
type QcVerdict = z.infer<typeof QcVerdictSchema>;

export interface DeliverableDeps {
  readonly database: StudioDatabase;
  readonly studioHome: string;
  /** Runs `zks-engine qc-status`, the gate every export passes first. */
  readonly engine: EngineProcessRunner;
}

export interface ExportRequest {
  readonly projectId: string;
  readonly videoId: string;
  readonly kinds: readonly DeliverableKind[];
  readonly jobId: string | null;
  readonly signal?: AbortSignal;
}

export interface ExportedDeliverable {
  readonly kind: DeliverableKind;
  readonly path: string;
  readonly sha256: string;
}

type DeliverableRow = typeof deliverables.$inferSelect;
type Deliverable = z.infer<typeof DeliverableSchema>;

interface DeliverableSource {
  /** The rendered video whose QC report must pass: a Reels deliverable is judged as `<v>r`. */
  readonly gateVideoId: string;
  readonly sourceRelPath: string;
  readonly deliverableName: string;
  /** A master only: the file QC passed, which the copy must still match byte count and mtime for. */
  readonly passedQc?: QcVerdict;
}
type SourceResolution = { readonly source: DeliverableSource } | { readonly problem: string };

type RenderedKind = Exclude<DeliverableKind, "caption_txt">;
interface SourceLayout {
  readonly reels: boolean;
  readonly cover?: "a" | "b";
}
const LAYOUT_BY_KIND: Record<RenderedKind, SourceLayout> = {
  full: { reels: false },
  reels: { reels: true },
  cover_a: { reels: false, cover: "a" },
  cover_b: { reels: false, cover: "b" },
  reels_cover_a: { reels: true, cover: "a" },
  reels_cover_b: { reels: true, cover: "b" },
};

function gateVideoIdOf(kind: RenderedKind, videoId: string): string {
  return LAYOUT_BY_KIND[kind].reels ? `${videoId}r` : videoId;
}

const isRenderedKind = (kind: DeliverableKind): kind is RenderedKind => kind !== "caption_txt";

const fileExists = (filePath: string) =>
  access(filePath).then(
    () => true,
    () => false,
  );

/** Where the engine wrote each kind (render-master's work/out, make-covers' work/covers) and the name it ships under. */
async function resolveSource(projectRoot: string, kind: DeliverableKind, videoId: string, slug: string): Promise<SourceResolution> {
  if (!isRenderedKind(kind)) {
    // make-covers writes one post caption per full edit; a Reels cut shares it.
    const sourceRelPath = `work/covers/${videoId}-caption.txt`;
    if (!(await fileExists(join(projectRoot, sourceRelPath))))
      return { problem: `${kind}: ${sourceRelPath} is missing; run make_covers with a postCaption first` };
    return { source: { gateVideoId: videoId, sourceRelPath, deliverableName: "caption.txt" } };
  }
  const layout = LAYOUT_BY_KIND[kind];
  const gateVideoId = gateVideoIdOf(kind, videoId);
  const namePrefix = layout.reels ? "reels-" : "";
  if (layout.cover !== undefined) {
    const sourceRelPath = `work/covers/${gateVideoId}-cover-${layout.cover}.png`;
    if (!(await fileExists(join(projectRoot, sourceRelPath)))) return { problem: `${kind}: ${sourceRelPath} is missing; run make_covers first` };
    return { source: { gateVideoId, sourceRelPath, deliverableName: `${namePrefix}cover-${layout.cover.toUpperCase()}.png` } };
  }
  const master = await findLatestMaster(projectRoot, gateVideoId);
  if (master === undefined) return { problem: `${kind}: ${gateVideoId} has no master in work/out; run render_master first` };
  return { source: { gateVideoId, sourceRelPath: master.relPath, deliverableName: `${namePrefix}${slug}-${master.resolution}.mp4` } };
}

/** The names an export would write today; a kind with no source yet is left out. */
export async function plannedDeliverableNames(projectRoot: string, videoId: string, slug: string, kinds: readonly DeliverableKind[]): Promise<string[]> {
  const resolutions = await Promise.all(kinds.map((kind) => resolveSource(projectRoot, kind, videoId, slug)));
  return resolutions.flatMap((resolution) => ("source" in resolution ? [resolution.source.deliverableName] : []));
}

export async function exportDeliverables(deps: DeliverableDeps, request: ExportRequest): Promise<ExportedDeliverable[]> {
  const project = await findProjectOrThrow(deps.database, request.projectId);
  const projectRoot = projectDir(deps.studioHome, project.slug);
  await assertNoRenderInFlight(deps.database, request);
  const verdicts = await qcVerdicts(deps.engine, projectRoot, request);
  // Every source is resolved before the first copy, so a missing one leaves no partial export behind.
  const sources = new Map<DeliverableKind, DeliverableSource>();
  for (const kind of request.kinds) {
    const resolution = await resolveSource(projectRoot, kind, request.videoId, project.slug);
    if ("problem" in resolution) throw new Error(resolution.problem);
    const verdict = verdicts.get(resolution.source.gateVideoId);
    const isMaster = isRenderedKind(kind) && LAYOUT_BY_KIND[kind].cover === undefined;
    sources.set(kind, isMaster && verdict !== undefined ? bindToQcVerdict(resolution.source, verdict) : resolution.source);
  }
  const exported: ExportedDeliverable[] = [];
  for (const [kind, source] of sources) {
    const relPath = `deliverables/${source.deliverableName}`;
    const { sha256, bytes } = await copyWithSha256(projectRoot, source, join(projectRoot, relPath));
    await replaceDeliverableRow(deps.database, { projectId: request.projectId, jobId: request.jobId, kind, relPath, bytes, sha256 });
    exported.push({ kind, path: relPath, sha256 });
  }
  return exported;
}

/** A render landing mid-export would replace the master QC is about to judge; a reel renders under its base video's job. */
async function assertNoRenderInFlight(database: StudioDatabase, request: ExportRequest): Promise<void> {
  const [render] = await database
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.projectId, request.projectId),
        eq(jobs.kind, "render_master"),
        eq(jobs.videoId, request.videoId),
        inArray(jobs.status, [...IN_FLIGHT_STATUSES]),
      ),
    )
    .limit(1);
  if (render !== undefined) throw new Error(`${request.videoId} is still rendering; export once render_master finishes`);
}

/** The engine owns the verdict: qc-status fails unless the latest master's own QC report passed, and names that master. */
async function qcVerdicts(engine: EngineProcessRunner, projectRoot: string, request: ExportRequest): Promise<Map<string, QcVerdict>> {
  const gateVideoIds = new Set(request.kinds.filter(isRenderedKind).map((kind) => gateVideoIdOf(kind, request.videoId)));
  const verdicts = new Map<string, QcVerdict>();
  for (const gateVideoId of gateVideoIds) {
    const qcRequest = { command: "qc-status", args: ["--video", gateVideoId], workDir: join(projectRoot, "work"), signal: request.signal };
    const report = await engine.run(qcRequest).catch((error: unknown) => {
      throw new Error(`${gateVideoId} has not passed QC: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    });
    verdicts.set(gateVideoId, QcVerdictSchema.parse(report));
  }
  return verdicts;
}

/** The master to copy is the one QC passed; a newer one means QC has not judged what export would ship. */
function bindToQcVerdict(source: DeliverableSource, verdict: QcVerdict): DeliverableSource {
  const passedRelPath = `work/${verdict.master}`;
  if (source.sourceRelPath !== passedRelPath) throw newerMasterError(source.gateVideoId, source.sourceRelPath);
  return { ...source, passedQc: verdict };
}

function newerMasterError(gateVideoId: string, newestRelPath: string): Error {
  return new Error(`${gateVideoId}: ${newestRelPath} is newer than the master QC passed; rerun qc_master`);
}

/** Fails closed unless the open file still has the byte count and mtime QC saw, and no newer master has landed. */
async function assertStillPassedQc(projectRoot: string, source: DeliverableSource, handle: FileHandle): Promise<void> {
  const { passedQc } = source;
  if (passedQc === undefined) return;
  const stats = await handle.stat({ bigint: true });
  if (stats.size !== BigInt(passedQc.bytes) || String(stats.mtimeNs) !== passedQc.mtimeNs) {
    throw new Error(`${source.gateVideoId}: ${source.sourceRelPath} changed after QC passed it; rerun qc_master`);
  }
  const newest = await findLatestMaster(projectRoot, source.gateVideoId);
  if (newest !== undefined && newest.relPath !== source.sourceRelPath) throw newerMasterError(source.gateVideoId, newest.relPath);
}

export function registerExportHandler(jobRunner: JobRunner, deps: DeliverableDeps): void {
  jobRunner.registerHandler(EXPORT_JOB_KIND, async (job, _reportProgress, signal) => {
    const { kinds } = STUDIO_TOOLS.export_deliverable.input.parse(job.params);
    const exported = await exportDeliverables(deps, { projectId: job.projectId, videoId: job.videoId, kinds, jobId: job.id, signal });
    const project = await findProjectOrThrow(deps.database, job.projectId);
    await writeJobResult(projectDir(deps.studioHome, project.slug), job.id, { deliverables: exported });
  });
}

export function toDeliverableDto(row: DeliverableRow): Deliverable {
  return { id: row.id, kind: row.kind, name: basename(row.relPath), bytes: row.bytes, sha256: row.sha256, createdAt: row.createdAt.toISOString() };
}

/** Hashes while copying into a .part file, so a reader never sees a half-written deliverable. A master is read from one
 * open handle, checked against its QC verdict before and after the read, so the bytes shipped are the bytes QC passed. */
async function copyWithSha256(projectRoot: string, source: DeliverableSource, targetPath: string): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash("sha256");
  let bytes = 0;
  const hashingStream = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      hash.update(chunk);
      bytes += chunk.length;
      done(null, chunk);
    },
  });
  const partPath = `${targetPath}.${randomUUID()}.part`;
  let handle: FileHandle | undefined;
  try {
    handle = await open(join(projectRoot, source.sourceRelPath));
    await assertStillPassedQc(projectRoot, source, handle);
    await pipeline(handle.createReadStream({ autoClose: false }), hashingStream, createWriteStream(partPath, { mode: OWNER_ONLY_FILE_MODE }));
    await assertStillPassedQc(projectRoot, source, handle);
    await rename(partPath, targetPath);
  } catch (error) {
    await rm(partPath, { force: true });
    throw new Error(`Cannot export ${source.sourceRelPath}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  } finally {
    await handle?.close();
  }
  return { sha256: hash.digest("hex"), bytes };
}

async function replaceDeliverableRow(database: StudioDatabase, row: typeof deliverables.$inferInsert): Promise<void> {
  await database.transaction(async (transaction) => {
    await transaction.delete(deliverables).where(and(eq(deliverables.projectId, row.projectId), eq(deliverables.kind, row.kind)));
    await transaction.insert(deliverables).values(row);
  });
}
