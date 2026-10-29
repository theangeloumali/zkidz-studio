// Created by The Angelo Umali.
// A project's style over its theme pack (slice D): the full style on projects.style, and the part a page draws with in
// work/style.json, which render.js reads with --style. Fonts and colour formats are already held by ProjectStyleSchema.
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hasErrorCode, type StudioDatabase } from "@zks/db";
import { mediaAssets, projects } from "@zks/db/schema";
import type { ProjectStyle, ThemeId } from "@zks/shared";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { projectDir } from "../config.ts";
import type { ProjectRow } from "../dto.ts";
import type { NewStudioEvent } from "../events/event-bus.ts";
import { PROJECT_STYLE_REL_PATH } from "../jobs/spec-snapshot.ts";
import { writeFileAtomically } from "../specs/spec-files.ts";

const THEMES_DIR = fileURLToPath(new URL("../../../../themes", import.meta.url));
const DEFAULT_THEME_ID: ThemeId = "zkidz";
const ThemeTokensSchema = z.object({ tokens: z.record(z.string(), z.string()) });

export interface StyleStore {
  readonly database: StudioDatabase;
  readonly studioHome: string;
  readonly eventBus: { publish(event: NewStudioEvent): Promise<unknown> };
}

export interface StyleWrite {
  readonly style: ProjectStyle | null;
  readonly warnings: string[];
}

export function projectThemeId(project: Pick<ProjectRow, "style">): ThemeId {
  return project.style?.theme ?? DEFAULT_THEME_ID;
}

/** The stored style, less a reference whose asset has since been deleted. */
export async function readProjectStyle(database: StudioDatabase, project: ProjectRow): Promise<ProjectStyle | null> {
  const style = project.style;
  if (style?.referenceAssetId === undefined || (await isProjectReference(database, project.id, style.referenceAssetId))) return style;
  const { referenceAssetId: _deleted, ...rest } = style;
  return rest;
}

/** The renderer's file goes first and is put back if the row write fails, so the two never disagree. */
export async function writeProjectStyle(store: StyleStore, project: ProjectRow, requested: ProjectStyle | null): Promise<StyleWrite> {
  const checked = requested === null ? { style: null, warnings: [] } : await checkedStyle(store.database, project.id, requested);
  const filePath = join(projectDir(store.studioHome, project.slug), PROJECT_STYLE_REL_PATH);
  const previousLook = await readFile(filePath, "utf8").catch(nullWhenMissing);
  await writeLook(filePath, checked.style === null ? null : JSON.stringify(drawnLook(checked.style), null, 2));
  try {
    await store.database.update(projects).set({ style: checked.style, updatedAt: new Date() }).where(eq(projects.id, project.id));
  } catch (error) {
    await writeLook(filePath, previousLook);
    throw error;
  }
  await store.eventBus.publish({ type: "style.changed", projectId: project.id });
  return checked;
}

async function checkedStyle(database: StudioDatabase, projectId: string, requested: ProjectStyle): Promise<StyleWrite> {
  const { tokens, referenceAssetId, ...kept } = requested;
  const warnings: string[] = [];
  const style: ProjectStyle = { ...kept };
  if (tokens !== undefined) {
    const known = await themeTokenNames(requested.theme);
    const [keptTokens, unknownTokens] = partition(Object.entries(tokens), ([name]) => known.has(name));
    for (const [name] of unknownTokens) warnings.push(`Dropped token "${name}": theme ${requested.theme} has no such token`);
    if (keptTokens.length > 0) style.tokens = Object.fromEntries(keptTokens);
  }
  if (referenceAssetId !== undefined) {
    if (await isProjectReference(database, projectId, referenceAssetId)) style.referenceAssetId = referenceAssetId;
    else warnings.push(`Dropped referenceAssetId ${referenceAssetId}: it is not a reference in this project`);
  }
  return { style, warnings };
}

function partition<T>(items: readonly T[], isKept: (item: T) => boolean): [T[], T[]] {
  return [items.filter(isKept), items.filter((item) => !isKept(item))];
}

async function themeTokenNames(themeId: ThemeId): Promise<Set<string>> {
  const theme = ThemeTokensSchema.parse(JSON.parse(await readFile(join(THEMES_DIR, themeId, "theme.json"), "utf8")));
  return new Set(Object.keys(theme.tokens));
}

async function isProjectReference(database: StudioDatabase, projectId: string, assetId: string): Promise<boolean> {
  const rows = await database
    .select({ id: mediaAssets.id })
    .from(mediaAssets)
    .where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.projectId, projectId), eq(mediaAssets.kind, "reference")));
  return rows.length > 0;
}

/** Pace and sound steer the agent; only colours, faces and boil reach Chrome. */
function drawnLook({ theme, tokens, type, boil }: ProjectStyle) {
  return { theme, tokens, type, boil };
}

async function writeLook(filePath: string, text: string | null): Promise<void> {
  if (text === null) await rm(filePath, { force: true });
  else await writeFileAtomically(filePath, text);
}

function nullWhenMissing(error: unknown): null {
  if (hasErrorCode(error, "ENOENT")) return null;
  throw error;
}
