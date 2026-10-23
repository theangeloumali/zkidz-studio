// Created by The Angelo Umali.
// Per-project agent limits, stored in the settings key/value table under one key per project.
import type { StudioDatabase } from "@zks/db";
import { ProjectSettingsSchema, type ProjectSettings } from "@zks/shared";
import { readSettingValue, writeSettingValue } from "../auth/settings-store.ts";

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = { maxTurns: 40, budgetUsd: 5 };

const projectSettingsKey = (projectId: string) => `project-settings:${projectId}`;

export async function readProjectSettings(database: StudioDatabase, projectId: string): Promise<ProjectSettings> {
  return (await readSettingValue(database, projectSettingsKey(projectId), ProjectSettingsSchema)) ?? DEFAULT_PROJECT_SETTINGS;
}

export async function updateProjectSettings(database: StudioDatabase, projectId: string, patch: Partial<ProjectSettings>): Promise<ProjectSettings> {
  const next = { ...(await readProjectSettings(database, projectId)), ...patch };
  await writeSettingValue(database, projectSettingsKey(projectId), next);
  return next;
}
