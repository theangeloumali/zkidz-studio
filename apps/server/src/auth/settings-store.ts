// Created by The Angelo Umali.
// Typed reads and writes over the settings key/value table; a stored value is re-validated on read.
import type { StudioDatabase } from "@zks/db";
import { settings } from "@zks/db/schema";
import { SettingsSchema, type Settings } from "@zks/shared";
import { eq, sql } from "drizzle-orm";
import type { z } from "zod";

const SETTINGS_KEY = "settings";
const DEFAULT_SETTINGS: Settings = { proxyOptIn: false };

export async function readSettingValue<Value>(database: StudioDatabase, key: string, schema: z.ZodType<Value>): Promise<Value | null> {
  const [row] = await database.select({ value: settings.value }).from(settings).where(eq(settings.key, key));
  if (row === undefined) return null;
  const parsed = schema.safeParse(row.value);
  // A row from an older shape is treated as unset rather than crashing every request.
  return parsed.success ? parsed.data : null;
}

export async function writeSettingValue(database: StudioDatabase, key: string, value: unknown): Promise<void> {
  await database
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: sql`now()` } });
}

export async function readSettings(database: StudioDatabase): Promise<Settings> {
  return (await readSettingValue(database, SETTINGS_KEY, SettingsSchema)) ?? DEFAULT_SETTINGS;
}

export async function updateSettings(database: StudioDatabase, patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await readSettings(database)), ...patch };
  await writeSettingValue(database, SETTINGS_KEY, next);
  return next;
}
