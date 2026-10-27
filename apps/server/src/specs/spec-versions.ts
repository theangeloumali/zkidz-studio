// Created by The Angelo Umali.
// Reading and restoring spec versions. A restore appends a new version, so no earlier one is ever lost.
import { createHash } from "node:crypto";
import type { StudioDatabase } from "@zks/db";
import { editSpecs, editSpecVersions } from "@zks/db/schema";
import type { SpecSummary, SpecVersion, SpecVersionSummary } from "@zks/shared";
import { and, asc, desc, eq } from "drizzle-orm";
import { projectDir } from "../config.ts";
import type { EventBus } from "../events/event-bus.ts";
import { notFound } from "../http/http-error.ts";
import { withCueSheetLock } from "../tools/cue-sheets.ts";
import { replaceSpecFile, withSpecLock, type SpecAddress } from "./spec-files.ts";

type SpecRow = typeof editSpecs.$inferSelect;
type SpecVersionRow = typeof editSpecVersions.$inferSelect;

export interface RestoreRequest {
  readonly database: StudioDatabase;
  readonly eventBus: EventBus;
  readonly studioHome: string;
  readonly project: { readonly id: string; readonly slug: string };
}

export async function listSpecSummaries(database: StudioDatabase, projectId: string): Promise<SpecSummary[]> {
  const rows = await database.select().from(editSpecs).where(eq(editSpecs.projectId, projectId)).orderBy(asc(editSpecs.videoId), asc(editSpecs.kind));
  return rows.map(toSpecSummary);
}

export async function listSpecVersions(database: StudioDatabase, projectId: string, address: SpecAddress): Promise<SpecVersionSummary[]> {
  const spec = await findSpecOrThrow(database, projectId, address);
  const rows = await database.select().from(editSpecVersions).where(eq(editSpecVersions.specId, spec.id)).orderBy(desc(editSpecVersions.version));
  return rows.map((row) => toVersionSummary(spec, row));
}

/** Without a version, the current one. */
export async function readSpecVersion(database: StudioDatabase, projectId: string, address: SpecAddress, version?: number): Promise<SpecVersion> {
  const spec = await findSpecOrThrow(database, projectId, address);
  const row = await findVersionOrThrow(database, spec.id, version ?? spec.currentVersion);
  return { ...toVersionSummary(spec, row), content: JSON.parse(row.content) as unknown };
}

// The cue tools' lock keeps a cue edit's read-modify-write from straddling the restore; the spec lock orders it with set_cuts.
export function restoreSpecVersion(request: RestoreRequest, address: SpecAddress, version: number): Promise<SpecSummary> {
  return withCueSheetLock(request.project.id, () => withSpecLock(request.project.id, address, () => restoreUnderLock(request, address, version)));
}

export async function readCurrentVersion(database: StudioDatabase, specId: string): Promise<number | undefined> {
  const [spec] = await database.select({ currentVersion: editSpecs.currentVersion }).from(editSpecs).where(eq(editSpecs.id, specId));
  return spec?.currentVersion;
}

async function restoreUnderLock(request: RestoreRequest, address: SpecAddress, version: number): Promise<SpecSummary> {
  const { database, project } = request;
  const spec = await findSpecOrThrow(database, project.id, address);
  const source = await findVersionOrThrow(database, spec.id, version);
  const note = `Restored version ${version}`;

  const restored = await database.transaction(async (transaction) => {
    const [locked] = await transaction.select().from(editSpecs).where(eq(editSpecs.id, spec.id)).for("update");
    if (locked === undefined) throw notFound();
    const nextVersion = locked.currentVersion + 1;
    const sha256 = createHash("sha256").update(source.content).digest("hex");
    await transaction.insert(editSpecVersions).values({ specId: spec.id, version: nextVersion, sha256, content: source.content, author: "user", note });
    await transaction.update(editSpecs).set({ currentVersion: nextVersion }).where(eq(editSpecs.id, spec.id));
    return { previousVersion: locked.currentVersion, version: nextVersion };
  });

  const projectRoot = projectDir(request.studioHome, project.slug);
  const change = { previousVersion: restored.previousVersion, version: restored.version, specText: source.content };
  await replaceSpecFile(projectRoot, address, change, () => readCurrentVersion(database, spec.id));
  await request.eventBus.publish({ type: "spec.version", projectId: project.id, ...address, version: restored.version, author: "user", note });
  return { videoId: spec.videoId, kind: spec.kind, currentVersion: restored.version };
}

async function findSpecOrThrow(database: StudioDatabase, projectId: string, address: SpecAddress): Promise<SpecRow> {
  const [spec] = await database
    .select()
    .from(editSpecs)
    .where(and(eq(editSpecs.projectId, projectId), eq(editSpecs.videoId, address.videoId), eq(editSpecs.kind, address.kind)));
  if (spec === undefined) throw notFound();
  return spec;
}

async function findVersionOrThrow(database: StudioDatabase, specId: string, version: number): Promise<SpecVersionRow> {
  const [row] = await database
    .select()
    .from(editSpecVersions)
    .where(and(eq(editSpecVersions.specId, specId), eq(editSpecVersions.version, version)));
  if (row === undefined) throw notFound();
  return row;
}

function toSpecSummary(spec: SpecRow): SpecSummary {
  return { videoId: spec.videoId, kind: spec.kind, currentVersion: spec.currentVersion };
}

function toVersionSummary(spec: SpecRow, row: SpecVersionRow): SpecVersionSummary {
  return { videoId: spec.videoId, kind: spec.kind, version: row.version, author: row.author, note: row.note, createdAt: row.createdAt.toISOString() };
}
