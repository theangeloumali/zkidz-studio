// Created by The Angelo Umali.
import type { Project } from "@zks/shared";

export const PROJECT_STATUS_LABELS: Record<Project["status"], string> = {
  draft: "Draft",
  editing: "Editing",
  rendering: "Rendering",
  delivered: "Delivered",
  archived: "Archived",
};
