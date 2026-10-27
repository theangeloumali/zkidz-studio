// Created by The Angelo Umali.
// What `db:reset` leaves behind; idempotent so a re-run never duplicates rows.
import { projects } from "../schema.ts";
import type { StudioDatabase } from "./client.ts";

export const SAMPLE_PROJECT_SLUG = "sample-project";

export async function seedDatabase(db: StudioDatabase): Promise<void> {
  await db.insert(projects).values({ slug: SAMPLE_PROJECT_SLUG, title: "Sample project" }).onConflictDoNothing({ target: projects.slug });
}
