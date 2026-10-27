// Created by The Angelo Umali.
// The three cue sheets of a video (cues/vN.json and its reel and cover sheets), read and written as versioned specs.
import { CueSheetSchema, type CUE_SHEETS, type Cue, type SpecKind } from "@zks/shared";
import type { ToolContext } from "./context.ts";
import { ToolError } from "./result.ts";
import { readCurrentSpec, writeAgentSpec } from "./spec-store.ts";

export type CueSheetName = (typeof CUE_SHEETS)[number];

const SPEC_KIND_OF_SHEET = { main: "cues", reel: "cues_reel", cover: "cues_cover" } as const satisfies Record<CueSheetName, SpecKind>;
const SHEET_NAMES = Object.keys(SPEC_KIND_OF_SHEET) as readonly CueSheetName[];

export interface LocatedCue {
  readonly sheet: CueSheetName;
  readonly sheetCues: readonly Cue[];
  readonly cue: Cue;
}

export async function readCueSheet(context: ToolContext, videoId: string, sheet: CueSheetName): Promise<Cue[]> {
  const stored = await readCurrentSpec(context, { videoId, kind: SPEC_KIND_OF_SHEET[sheet] });
  if (stored === undefined) return [];
  const parsed = CueSheetSchema.safeParse(stored);
  if (!parsed.success) throw new ToolError(`The stored ${sheet} cue sheet no longer matches the cue schema: ${parsed.error.issues[0]?.message ?? ""}`);
  return parsed.data;
}

export function writeCueSheet(context: ToolContext, videoId: string, sheet: CueSheetName, cues: readonly Cue[]): Promise<number> {
  return writeAgentSpec(context, { videoId, kind: SPEC_KIND_OF_SHEET[sheet] }, cues);
}

/** Ids are unique across all three sheets, so update_cue and remove_cue need no sheet. */
export async function findCue(context: ToolContext, videoId: string, cueId: string): Promise<LocatedCue | undefined> {
  for (const sheet of SHEET_NAMES) {
    const sheetCues = await readCueSheet(context, videoId, sheet);
    const cue = sheetCues.find((sheetCue) => sheetCue.id === cueId);
    if (cue !== undefined) return { sheet, sheetCues, cue };
  }
  return undefined;
}

const sheetQueues = new Map<string, Promise<unknown>>();

/** Runs cue edits of one project one at a time: each is a read-modify-write of a whole sheet. */
export function withCueSheetLock<Output>(projectId: string, edit: () => Promise<Output>): Promise<Output> {
  const previous = sheetQueues.get(projectId) ?? Promise.resolve();
  const next = previous.then(edit, edit);
  const settled = next.then(
    () => undefined,
    () => undefined,
  );
  sheetQueues.set(projectId, settled);
  void settled.then(() => {
    if (sheetQueues.get(projectId) === settled) sheetQueues.delete(projectId);
  });
  return next;
}
