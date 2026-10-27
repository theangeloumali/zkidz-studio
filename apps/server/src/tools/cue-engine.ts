// Created by The Angelo Umali.
// The engine's cue checks (zks_engine.specs validate_add_cue / validate_update_cue) and theme index (cue-kinds), plan §7.7–7.8.
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CUE_TIERS, CueSchema, type Cue } from "@zks/shared";
import { z } from "zod";
import type { ToolContext } from "./context.ts";
import { projectWorkDir, runEngineCheck } from "./engine-check.ts";
import { ToolError } from "./result.ts";
import { readLatestWords } from "./transcript-store.ts";

const MS_PER_SECOND = 1000;
const SlotWidthsSchema = z.record(z.string(), z.int().positive());
const ThemeKindSchema = z.object({
  kind: z.string(),
  tier: z.enum(CUE_TIERS),
  purpose: z.string(),
  slots: SlotWidthsSchema,
  tones: z.record(z.string(), SlotWidthsSchema).optional(),
});
const CueKindsReportSchema = z.object({ kinds: z.array(ThemeKindSchema) });
const ValidatedCueReportSchema = z.object({ cue: z.unknown() });

export type ThemeKind = z.infer<typeof ThemeKindSchema>;

interface CueKindFilter {
  readonly theme: string;
  readonly tier?: (typeof CUE_TIERS)[number] | undefined;
  readonly purpose?: string | undefined;
}

export async function listThemeCueKinds(context: ToolContext, filter: CueKindFilter): Promise<ThemeKind[]> {
  const workDir = await projectWorkDir(context);
  const args = ["--theme", filter.theme, ...(filter.tier === undefined ? [] : ["--tier", filter.tier])];
  const purposeArgs = filter.purpose === undefined ? [] : ["--purpose", filter.purpose];
  const report = await runEngineCheck(() => context.engine.run({ command: "cue-kinds", args: [...args, ...purposeArgs], workDir }));
  return CueKindsReportSchema.parse(report).kinds;
}

interface CueCheck {
  readonly theme: string;
  /** The new cue, or with `storedCue` the patch merged into it (a null removes a field). */
  readonly cue: Readonly<Record<string, unknown>>;
  readonly storedCue?: Cue;
}

/** The cue as the engine accepted it: its kind's schema, the theme's widths and the anchor word's -0.2..+1.8 s window. */
export async function validateCueWithEngine(context: ToolContext, check: CueCheck): Promise<Cue> {
  const words = await readLatestWords(context);
  const workDir = await projectWorkDir(context);
  const scratchDir = join(workDir, ".validate", randomUUID());
  await mkdir(scratchDir, { recursive: true });
  try {
    const cuePath = join(scratchDir, "cue.json");
    const wordsPath = join(scratchDir, "words.jsonl");
    // The engine reads transcript words as JSONL in milliseconds (zks-engine validate-cue --words).
    const wordLines = words.map((word) =>
      JSON.stringify({ start: Math.round(word.at * MS_PER_SECOND), end: Math.round(word.end * MS_PER_SECOND), text: word.text }),
    );
    await Promise.all([writeFile(cuePath, JSON.stringify(check.cue)), writeFile(wordsPath, `${wordLines.join("\n")}\n`)]);
    const storedArgs = check.storedCue === undefined ? [] : ["--stored", join(scratchDir, "stored.json")];
    if (check.storedCue !== undefined) await writeFile(join(scratchDir, "stored.json"), JSON.stringify(check.storedCue));
    const args = ["--theme", check.theme, "--cue", cuePath, "--words", wordsPath, ...storedArgs];
    const report = ValidatedCueReportSchema.parse(await runEngineCheck(() => context.engine.run({ command: "validate-cue", args, workDir })));
    const parsedCue = CueSchema.safeParse(report.cue);
    if (!parsedCue.success) throw new ToolError(`Invalid cue: ${parsedCue.error.issues[0]?.message ?? "rejected"}`);
    return parsedCue.data;
  } finally {
    await rm(scratchDir, { recursive: true, force: true });
  }
}
