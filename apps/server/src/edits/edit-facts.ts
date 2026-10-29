// Created by The Angelo Umali.
// What an edit did, read from the current cuts spec and the answers the user gave, so later edits can learn from it.
import type { StudioDatabase } from "@zks/db";
import { CutSpecSchema, keptSpansOf, type EditFacts } from "@zks/shared";
import { HttpError } from "../http/http-error.ts";
import { readSpecVersion } from "../specs/spec-versions.ts";

const OPENING_QUESTION = /opening|hook/i;

export interface EditFactsInput {
  readonly projectId: string;
  readonly videoId: string;
  readonly answers: Readonly<Record<string, string>>;
}

export async function readEditFacts(database: StudioDatabase, { projectId, videoId, answers }: EditFactsInput): Promise<EditFacts> {
  const opening = Object.entries(answers).find(([question]) => OPENING_QUESTION.test(question))?.[1];
  const facts: EditFacts = { ...(await readCutFacts(database, projectId, videoId)), answers: { ...answers } };
  return opening === undefined ? facts : { ...facts, opening };
}

async function readCutFacts(
  database: StudioDatabase,
  projectId: string,
  videoId: string,
): Promise<Pick<EditFacts, "sourceS" | "keptS" | "segments" | "cutReasons">> {
  const cuts = CutSpecSchema.safeParse(await readCurrentCuts(database, projectId, videoId));
  if (!cuts.success) return { cutReasons: [] };
  const keptSpans = keptSpansOf(cuts.data);
  return {
    sourceS: cuts.data.durationS,
    keptS: keptSpans.reduce((total, span) => total + (span.end - span.at), 0),
    segments: keptSpans.length,
    cutReasons: [...new Set(cuts.data.removals.map((removal) => removal.reason))],
  };
}

/** An export with no cuts spec still closes its edit, just without the cut facts. */
async function readCurrentCuts(database: StudioDatabase, projectId: string, videoId: string): Promise<unknown> {
  try {
    return (await readSpecVersion(database, projectId, { videoId, kind: "cuts" })).content;
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return undefined;
    throw error;
  }
}
