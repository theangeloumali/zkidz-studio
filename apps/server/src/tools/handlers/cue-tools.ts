// Created by The Angelo Umali.
// list_cue_kinds, add_cue, update_cue and remove_cue (plan §6.8); every stored cue has passed the engine's checks.
import { randomUUID } from "node:crypto";
import { CueSchema, type Cue } from "@zks/shared";
import { z } from "zod";
import { validateCueWithEngine, listThemeCueKinds, type ThemeKind } from "../cue-engine.ts";
import { findCue, readCueSheet, withCueSheetLock, writeCueSheet } from "../cue-sheets.ts";
import { implementTool } from "../define-tool.ts";
import { loadProject, PROJECT_THEME_ID } from "../project-files.ts";
import { ToolError } from "../result.ts";

// Speech or the cut spec times these, so they never count as a card overlapping another.
const DERIVED_KINDS: ReadonlySet<string> = new Set(["caption", "censor", "cutaway"]);
const CUE_ID_HEX_CHARS = 8;
const JSON_SCHEMA_OF_KIND: ReadonlyMap<string, Record<string, unknown>> = new Map(
  CueSchema.options.map((kindSchema) => [kindSchema.shape.kind.value, z.toJSONSchema(kindSchema)]),
);

const listCueKinds = implementTool("list_cue_kinds", {
  description:
    "The theme's cue kinds with each kind's JSON Schema and per-slot character caps. Filter by tier (core, accent, special) and by words the purpose must mention before opening schemas.",
  handler: async (input, context) => {
    const themeKinds = await listThemeCueKinds(context, { theme: input.theme ?? PROJECT_THEME_ID, tier: input.tier, purpose: input.purpose });
    return { output: { kinds: themeKinds.flatMap(toListedKind) } };
  },
});

const addCue = implementTool("add_cue", {
  description:
    "Add a cue to the main, reel or cover sheet. Times are source seconds; anchor {phrase, wordIndex} names the transcript word it lands on, and `at` must sit within -0.2 to +1.8 s of it.",
  handler: (input, context) =>
    withCueSheetLock(context.projectId, async () => {
      const { videoId } = await loadProject(context);
      const cueId = input.cue.id ?? `cue-${randomUUID().slice(0, CUE_ID_HEX_CHARS)}`;
      if ((await findCue(context, videoId, cueId)) !== undefined) throw new ToolError(`Cue ${cueId} already exists; use update_cue`);
      const cue = await validateCueWithEngine(context, { theme: PROJECT_THEME_ID, cue: { ...input.cue, id: cueId } });
      const sheetCues = await readCueSheet(context, videoId, input.sheet);
      const version = await writeCueSheet(context, videoId, input.sheet, [...sheetCues, cue]);
      return { output: { id: cueId, version, warnings: overlapWarnings(sheetCues, cue) } };
    }),
});

const updateCue = implementTool("update_cue", {
  description: "Change fields of a cue by id; a null removes a field. The merged cue is checked again like add_cue.",
  handler: (input, context) =>
    withCueSheetLock(context.projectId, async () => {
      if (Object.hasOwn(input.patch, "id") && input.patch.id !== input.id) throw new ToolError("A patch cannot change a cue's id");
      const { videoId } = await loadProject(context);
      const located = await findCue(context, videoId, input.id);
      if (located === undefined) throw new ToolError(`There is no cue ${input.id}`);
      const cue = await validateCueWithEngine(context, { theme: PROJECT_THEME_ID, cue: input.patch, storedCue: located.cue });
      const sheetCues = located.sheetCues.map((sheetCue) => (sheetCue === located.cue ? cue : sheetCue));
      const version = await writeCueSheet(context, videoId, located.sheet, sheetCues);
      return { output: { id: input.id, version, warnings: overlapWarnings(located.sheetCues, cue) } };
    }),
});

const removeCue = implementTool("remove_cue", {
  description: "Remove a cue by id from whichever sheet holds it.",
  handler: (input, context) =>
    withCueSheetLock(context.projectId, async () => {
      const { videoId } = await loadProject(context);
      const located = await findCue(context, videoId, input.id);
      if (located === undefined) throw new ToolError(`There is no cue ${input.id}`);
      const remainingCues = located.sheetCues.filter((sheetCue) => sheetCue !== located.cue);
      const version = await writeCueSheet(context, videoId, located.sheet, remainingCues);
      return { output: { id: input.id, version, warnings: [] } };
    }),
});

/** Kinds the shared cue schema lacks (image and chart kinds) cannot be added, so they are not offered. */
function toListedKind(themeKind: ThemeKind) {
  const jsonSchema = JSON_SCHEMA_OF_KIND.get(themeKind.kind);
  if (jsonSchema === undefined) return [];
  const hasSlots = Object.keys(themeKind.slots).length > 0;
  return [
    {
      kind: themeKind.kind,
      tier: themeKind.tier,
      purpose: themeKind.purpose,
      jsonSchema,
      ...(hasSlots ? { maxChars: themeKind.slots } : {}),
      ...(themeKind.tones === undefined ? {} : { tones: themeKind.tones }),
    },
  ];
}

function overlapWarnings(sheetCues: readonly Cue[], cue: Cue): string[] {
  if (DERIVED_KINDS.has(cue.kind)) return [];
  return sheetCues
    .filter((other) => other.id !== cue.id && !DERIVED_KINDS.has(other.kind) && other.at < cue.end && cue.at < other.end)
    .map((other) => `overlaps ${other.kind} ${other.id ?? ""} (${other.at}-${other.end} s) on screen`);
}

export const cueTools = [listCueKinds, addCue, updateCue, removeCue];
