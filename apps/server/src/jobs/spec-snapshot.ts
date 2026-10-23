// Created by The Angelo Umali.
// Plan §7.6: a job renders the spec set as it stood when the job started, so an agent edit mid-render never reaches it.
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { StudioDatabase } from "@zks/db";
import { editSpecs, editSpecVersions, jobs } from "@zks/db/schema";
import { and, eq } from "drizzle-orm";
import { projectDir } from "../config.ts";
import type { JobRow } from "../dto.ts";
import { isWithinDir } from "../fs/path-policy.ts";
import { findProjectOrThrow } from "../projects/project-store.ts";
import type { JobHandler, JobRunner } from "./job-runner.ts";

const WORK_PREFIX = "work/";
const OWNER_ONLY_DIR_MODE = 0o700;
const OWNER_ONLY_FILE_MODE = 0o600;
// Every job kind that reads specs (cuts, cues, captions, reels) while it renders or judges the master.
const RENDER_JOB_KINDS = ["render_master", "qc_master", "check_motion", "make_covers"];
const activeSnapshotDir = new AsyncLocalStorage<string>();

export interface SpecSnapshotDeps {
  readonly database: StudioDatabase;
  readonly studioHome: string;
}

interface SpecFile {
  readonly relPath: string;
  readonly content: string;
}

/** Holds the snapshot's files at their paths under work/, e.g. `cuts/v1.json`. */
export function specSnapshotDir(projectRoot: string, sha256: string): string {
  return join(projectRoot, "work", "snapshots", sha256);
}

/** Takes the snapshot once per job; a resumed job already has one and renders it again. */
export function snapshotSpecsAtStart(handler: JobHandler, deps: SpecSnapshotDeps): JobHandler {
  return async (job, reportProgress, signal) => {
    const project = await findProjectOrThrow(deps.database, job.projectId);
    const projectRoot = projectDir(deps.studioHome, project.slug);
    const snapshotJob = job.specSnapshotSha256 === null ? await takeSnapshot(deps, job, projectRoot) : job;
    const snapshotDir = specSnapshotDir(projectRoot, snapshotJob.specSnapshotSha256 ?? "");
    await withSpecSnapshotDir(snapshotDir, () => handler(snapshotJob, reportProgress, signal));
  };
}

/** Wraps the production render handlers; call it after they are registered. */
export function snapshotRenderJobSpecs(jobRunner: JobRunner, deps: SpecSnapshotDeps): void {
  for (const kind of RENDER_JOB_KINDS) jobRunner.wrapHandler(kind, (handler) => snapshotSpecsAtStart(handler, deps));
}

/** Engine runs inside `run` read their specs from this snapshot (ZKS_SPECS). */
export function withSpecSnapshotDir<Result>(snapshotDir: string, run: () => Promise<Result>): Promise<Result> {
  return activeSnapshotDir.run(snapshotDir, run);
}

export function activeSpecSnapshotDir(): string | undefined {
  return activeSnapshotDir.getStore();
}

async function takeSnapshot(deps: SpecSnapshotDeps, job: JobRow, projectRoot: string): Promise<JobRow> {
  const specFiles = await readCurrentSpecFiles(deps.database, job.projectId);
  const sha256 = hashSpecSet(specFiles);
  await writeSnapshot(specSnapshotDir(projectRoot, sha256), specFiles);
  const [updated] = await deps.database.update(jobs).set({ specSnapshotSha256: sha256 }).where(eq(jobs.id, job.id)).returning();
  return updated ?? { ...job, specSnapshotSha256: sha256 };
}

async function readCurrentSpecFiles(database: StudioDatabase, projectId: string): Promise<SpecFile[]> {
  const rows = await database
    .select({ relPath: editSpecs.relPath, content: editSpecVersions.content })
    .from(editSpecs)
    .innerJoin(editSpecVersions, and(eq(editSpecVersions.specId, editSpecs.id), eq(editSpecVersions.version, editSpecs.currentVersion)))
    .where(eq(editSpecs.projectId, projectId));
  return rows.sort((left, right) => left.relPath.localeCompare(right.relPath));
}

function hashSpecSet(specFiles: readonly SpecFile[]): string {
  const canonical = JSON.stringify(specFiles.map(({ relPath, content }) => [relPath, content]));
  return createHash("sha256").update(canonical).digest("hex");
}

/** Content-addressed, so an existing folder is already right; a new one appears whole through a rename. */
async function writeSnapshot(snapshotDir: string, specFiles: readonly SpecFile[]): Promise<void> {
  if (await pathExists(snapshotDir)) return;
  const partDir = `${snapshotDir}.${randomUUID()}.part`;
  try {
    for (const specFile of specFiles) {
      const filePath = join(partDir, specFile.relPath.slice(WORK_PREFIX.length));
      if (!specFile.relPath.startsWith(WORK_PREFIX) || !isWithinDir(filePath, partDir)) throw new Error(`Spec path ${specFile.relPath} is outside work/`);
      await mkdir(dirname(filePath), { recursive: true, mode: OWNER_ONLY_DIR_MODE });
      await writeFile(filePath, specFile.content, { mode: OWNER_ONLY_FILE_MODE });
    }
    await mkdir(partDir, { recursive: true, mode: OWNER_ONLY_DIR_MODE });
    await rename(partDir, snapshotDir).catch(async (error: unknown) => {
      // Another job wrote the same snapshot first; its copy is identical.
      if (!(await pathExists(snapshotDir))) throw error;
    });
  } finally {
    await rm(partDir, { recursive: true, force: true });
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  return access(filePath).then(
    () => true,
    () => false,
  );
}
