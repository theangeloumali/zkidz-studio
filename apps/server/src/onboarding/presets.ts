// Created by The Angelo Umali.
// The shipped style and template JSON, validated once; the web renders these instead of keeping its own copy.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HomeTemplateSchema, INGEST_MODES, StyleCardSchema, StyleIdSchema, type HomeTemplate, type StyleCard } from "@zks/shared";
import type { z } from "zod";

export const DEFAULT_PRESETS_DIR = fileURLToPath(new URL("../../../../themes/zkidz/presets", import.meta.url));

export interface Presets {
  readonly styles: readonly StyleCard[];
  readonly templates: readonly HomeTemplate[];
}

async function readPresetFolder<Preset>(folder: string, schema: z.ZodType<Preset>): Promise<Preset[]> {
  const names = (await readdir(folder)).filter((name) => name.endsWith(".json"));
  return Promise.all(
    names.map(async (name) => {
      const parsed = schema.safeParse(JSON.parse(await readFile(join(folder, name), "utf8")));
      if (!parsed.success) throw new Error(`preset ${name} is invalid: ${parsed.error.message}`);
      return parsed.data;
    }),
  );
}

/** Ordered as the UI lists them: the default style first, templates from one clip up to a showcase. */
export async function loadPresets(presetsDir: string): Promise<Presets> {
  const styles = await readPresetFolder(join(presetsDir, "styles"), StyleCardSchema);
  const templates = await readPresetFolder(join(presetsDir, "templates"), HomeTemplateSchema);
  const styleRank = (style: StyleCard) => StyleIdSchema.options.indexOf(style.id);
  const modeRank = (template: HomeTemplate) => INGEST_MODES.indexOf(template.ingestMode);
  return {
    styles: styles.sort((left, right) => styleRank(left) - styleRank(right)),
    templates: templates.sort((left, right) => modeRank(left) - modeRank(right)),
  };
}
