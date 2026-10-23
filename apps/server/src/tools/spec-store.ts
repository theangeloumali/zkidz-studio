// Created by The Angelo Umali.
// The agent's one spec write path (plan D4): a version row per change, the file the engine reads, and a spec.version event.
import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { editSpecs, editSpecVersions } from "@zks/db/schema";
import type { SpecKind } from "@zks/shared";
import { and, eq } from "drizzle-orm";
import type { ToolContext } from "./context.ts";
import { loadProject, projectRootOf } from "./project-files.ts";

interface SpecAddress {
  readonly videoId: string;
  readonly kind: SpecKind;
}

export async function writeAgentSpec(context: ToolContext, address: SpecAddress, content: unknown): Promise<number> {
  const project = await loadProject(context);
  const specText = `${JSON.stringify(content, null, 2)}\n`;
  const sha256 = createHash("sha256").update(specText).digest("hex");
  const relPath = `work/${address.kind}/${address.videoId}.json`;

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
    if (current?.sha256 === sha256) return { version: spec.currentVersion, isNew: false };
    const version = spec.currentVersion + 1;
    await transaction.insert(editSpecVersions).values({ specId: spec.id, version, sha256, content: specText, author: "agent" });
    await transaction.update(editSpecs).set({ currentVersion: version }).where(eq(editSpecs.id, spec.id));
    return { version, isNew: true };
  });
  if (!written.isNew) return written.version;

  await writeFileAtomically(join(projectRootOf(context, project), relPath), specText);
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

// The engine may read the file at any moment, so it never sees a half-written spec.
async function writeFileAtomically(filePath: string, text: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const partPath = `${filePath}.${process.pid}.part`;
  await writeFile(partPath, text, { mode: 0o600 });
  await rename(partPath, filePath);
}
