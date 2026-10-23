// Created by The Angelo Umali.
import type { HomeTemplate, Project } from "@zks/shared";
import { submitPrompt } from "../api/agent-client.ts";
import { startProjectTemplate } from "../api/onboarding-client.ts";
import { createProjectWithMedia, uploadFile } from "../api/upload.ts";
import { titleFrom } from "../routes/use-add-media.ts";
import type { SlotRole } from "./templates.ts";

export interface TemplateUpload {
  readonly file: File;
  readonly role: SlotRole;
}

interface StartOptions {
  readonly template: HomeTemplate;
  /** Already in upload order. */
  readonly uploads: readonly TemplateUpload[];
  readonly prompt: string;
}

/** Any rejected file or template start stops it before the prompt: the agent never edits footage that was not ingested. */
export async function startFromTemplate({ template, uploads, prompt }: StartOptions): Promise<Project> {
  const [first, ...rest] = uploads;
  if (!first) throw new Error("Add your footage first.");
  const ignoreProgress = () => undefined;
  const { project, asset } = await createProjectWithMedia({ title: titleFrom(first.file.name), file: first.file, onProgress: ignoreProgress });
  const uploaded = [{ role: first.role, assetId: asset.id }];
  for (const { file, role } of rest) uploaded.push({ role, assetId: (await uploadFile({ projectId: project.id, file, onProgress: ignoreProgress })).id });

  const clipAssetIds = uploaded.filter((upload) => upload.role === "clips").map((upload) => upload.assetId);
  const insertAssetId = uploaded.find((upload) => upload.role === "insert")?.assetId;
  await startProjectTemplate(
    project.id,
    insertAssetId === undefined ? { templateId: template.id, clipAssetIds } : { templateId: template.id, clipAssetIds, insertAssetId },
  );
  await submitPrompt(project.id, prompt);
  return project;
}
