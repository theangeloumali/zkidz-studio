// Created by The Angelo Umali.
// The agent's one spec write path (plan D4): a version row per change, the file the engine reads, and a spec.version event.
import { createHash } from "node:crypto";
import { editSpecs, editSpecVersions } from "@zks/db/schema";
import { and, eq } from "drizzle-orm";
import { replaceSpecFile, specRelPath, withSpecLock, type SpecAddress } from "../specs/spec-files.ts";
import { readCurrentVersion } from "../specs/spec-versions.ts";
import type { ToolContext } from "./context.ts";
import { loadProject, projectRootOf } from "./project-files.ts";

// Under the spec's own lock, shared with restores: the cue tools call this inside withCueSheetLock, so taking that lock here would deadlock.
export function writeAgentSpec(context: ToolContext, address: SpecAddress, content: unknown): Promise<number> {
  return withSpecLock(context.projectId, address, () => writeUnderLock(context, address, content));
}

async function writeUnderLock(context: ToolContext, address: SpecAddress, content: unknown): Promise<number> {
  const project = await loadProject(context);
  const specText = `${JSON.stringify(content, null, 2)}\n`;
  const sha256 = createHash("sha256").update(specText).digest("hex");
  const relPath = specRelPath(address);

  const written = await context.db.transaction(async (transaction) => {
    const [spec] = await transaction
      .insert(editSpecs)
      .values({ projectId: context.projectId, ...address, relPath })
      .onConflictDoUpdate({ target: [editSpecs.projectId, editSpecs.videoId, editSpecs.kind], set: { relPath } })
      .returning();
    if (spec === undefined) throw new Error("edit_specs upsert returned no row");
    const [current] = await transaction
      .select({ sha256: editSpecVersions.sha256 })
      .from(editSpecVersions)
      .where(and(eq(editSpecVersions.specId, spec.id), eq(editSpecVersions.version, spec.currentVersion)));
    if (current?.sha256 === sha256) return { specId: spec.id, previousVersion: spec.currentVersion, version: spec.currentVersion, isNew: false };
    const version = spec.currentVersion + 1;
    await transaction.insert(editSpecVersions).values({ specId: spec.id, version, sha256, content: specText, author: "agent" });
    await transaction.update(editSpecs).set({ currentVersion: version }).where(eq(editSpecs.id, spec.id));
    return { specId: spec.id, previousVersion: spec.currentVersion, version, isNew: true };
  });
  if (!written.isNew) return written.version;

  const change = { previousVersion: written.previousVersion, version: written.version, specText };
  await replaceSpecFile(projectRootOf(context, project), address, change, () => readCurrentVersion(context.db, written.specId));
  await context.events.publish({ type: "spec.version", projectId: context.projectId, ...address, version: written.version, author: "agent" });
  return written.version;
}

export async function readCurrentSpec(context: ToolContext, address: SpecAddress): Promise<unknown> {
  const [row] = await context.db
    .select({ content: editSpecVersions.content })
    .from(editSpecs)
    .innerJoin(editSpecVersions, and(eq(editSpecVersions.specId, editSpecs.id), eq(editSpecVersions.version, editSpecs.currentVersion)))
    .where(and(eq(editSpecs.projectId, context.projectId), eq(editSpecs.videoId, address.videoId), eq(editSpecs.kind, address.kind)));
  return row === undefined ? undefined : (JSON.parse(row.content) as unknown);
}
