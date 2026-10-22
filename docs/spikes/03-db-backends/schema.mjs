// Created by The Angelo Umali.
// Spike-only schema: enough column types to make the two backends' catalogs worth diffing.
import { pgSchema, uuid, text, integer, timestamp, jsonb, boolean, index } from "drizzle-orm/pg-core";

export const studio = pgSchema("studio");

export const projects = studio.table("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const jobs = studio.table(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    lane: text("lane").notNull(),
    progressPct: integer("progress_pct").notNull().default(0),
    payload: jsonb("payload").notNull().default({}),
    interrupted: boolean("interrupted").notNull().default(false),
  },
  (table) => [index("jobs_project_idx").on(table.projectId)],
);
