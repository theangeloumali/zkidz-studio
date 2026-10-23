// Created by The Angelo Umali.
import { hasErrorCode, type StudioDatabase } from "@zks/db";
import { projects } from "@zks/db/schema";
import { IdSchema } from "@zks/shared";
import { eq } from "drizzle-orm";
import { createProjectDirs } from "../config.ts";
import type { ProjectRow } from "../dto.ts";
import { HttpError, notFound } from "../http/http-error.ts";

const MAX_SLUG_CHARS = 48;
const MAX_SLUG_ATTEMPTS = 1000;
const FALLBACK_SLUG = "project";

/** A malformed id is a 404, not a 400: the client asked for something that does not exist. */
export async function findProjectOrThrow(database: StudioDatabase, rawProjectId: string): Promise<ProjectRow> {
  const projectId = IdSchema.safeParse(rawProjectId);
  if (!projectId.success) throw notFound();
  const [project] = await database.select().from(projects).where(eq(projects.id, projectId.data));
  if (project === undefined) throw notFound();
  return project;
}

function slugifyTitle(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, MAX_SLUG_CHARS)
    .replace(/^-+|-+$/g, "");
  return slug === "" ? FALLBACK_SLUG : slug;
}

/**
 * The slug names the project's folder, so the row and the folders exist together or not at all. A folder left over
 * under that slug is skipped like a taken row, so the returned project's folder is always this call's own.
 */
export async function createProject(database: StudioDatabase, studioHome: string, title: string): Promise<ProjectRow> {
  const baseSlug = slugifyTitle(title);
  for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt += 1) {
    const slug = attempt === 1 ? baseSlug : `${baseSlug}-${attempt}`;
    const [project] = await database.insert(projects).values({ slug, title }).onConflictDoNothing({ target: projects.slug }).returning();
    if (project === undefined) continue;
    try {
      await createProjectDirs(studioHome, slug);
      return project;
    } catch (error) {
      await database.delete(projects).where(eq(projects.id, project.id));
      if (hasErrorCode(error, "EEXIST")) continue;
      throw error;
    }
  }
  throw new HttpError(409, "Too many projects share this title");
}
