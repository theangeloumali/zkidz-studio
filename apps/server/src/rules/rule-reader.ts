// Created by The Angelo Umali.
// Read-only: the one enabled-rules query, shared by the system prompt and project_info so both see the same list.
import type { StudioDatabase } from "@zks/db";
import { rules } from "@zks/db/schema";
import { asc, eq } from "drizzle-orm";

export async function readEnabledRuleTexts(database: StudioDatabase): Promise<string[]> {
  const rows = await database.select({ text: rules.text }).from(rules).where(eq(rules.enabled, true)).orderBy(asc(rules.createdAt));
  return rows.map((row) => row.text);
}
