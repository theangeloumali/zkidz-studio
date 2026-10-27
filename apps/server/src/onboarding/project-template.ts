// Created by The Angelo Umali.
// The template a project started from, in the settings table beside project-settings (no schema migration).
import type { StudioDatabase } from "@zks/db";
import { ProjectTemplateSchema, type ProjectTemplate } from "@zks/shared";
import { readSettingValue, writeSettingValue } from "../auth/settings-store.ts";

const projectTemplateKey = (projectId: string) => `project-template:${projectId}`;

export function readProjectTemplate(database: StudioDatabase, projectId: string): Promise<ProjectTemplate | null> {
  return readSettingValue(database, projectTemplateKey(projectId), ProjectTemplateSchema);
}

export function writeProjectTemplate(database: StudioDatabase, projectId: string, template: ProjectTemplate): Promise<void> {
  return writeSettingValue(database, projectTemplateKey(projectId), template);
}
