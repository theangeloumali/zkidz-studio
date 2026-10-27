// Created by The Angelo Umali.
// The repo's preset files, parsed as the server serves them, so web tests run against what actually ships.
import { HomeTemplateSchema, StyleCardSchema } from "@zks/shared";

const templateFiles = import.meta.glob("../../../themes/zkidz/presets/templates/*.json", { eager: true, import: "default" });
const styleFiles = import.meta.glob("../../../themes/zkidz/presets/styles/*.json", { eager: true, import: "default" });

export const SHIPPED_TEMPLATES = Object.values(templateFiles).map((file) => HomeTemplateSchema.parse(file));
export const SHIPPED_STYLES = Object.values(styleFiles).map((file) => StyleCardSchema.parse(file));

export function shippedTemplate(id: string) {
  const template = SHIPPED_TEMPLATES.find((candidate) => candidate.id === id);
  if (!template) throw new Error(`no shipped template ${id}`);
  return template;
}
