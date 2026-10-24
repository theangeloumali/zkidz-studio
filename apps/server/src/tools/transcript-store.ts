// Created by The Angelo Umali.
// The latest transcript of a project: a words file under the project folder, written by the transcribe job.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { transcripts } from "@zks/db/schema";
import { TranscriptWordSchema } from "@zks/shared";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { ToolContext } from "./context.ts";
import { loadProject, projectRootOf } from "./project-files.ts";
import { ToolError } from "./result.ts";

export type TranscriptWord = z.infer<typeof TranscriptWordSchema>;

const TranscriptWordsSchema = z.array(TranscriptWordSchema);

/** mediaAssetId narrows it to that source's transcript, so QC compares a master with the words of what it rendered. */
export async function readLatestWords(context: ToolContext, mediaAssetId?: string): Promise<TranscriptWord[]> {
  const project = await loadProject(context);
  const [transcript] = await context.db
    .select({ wordsRelPath: transcripts.wordsRelPath })
    .from(transcripts)
    .where(and(eq(transcripts.projectId, context.projectId), mediaAssetId === undefined ? undefined : eq(transcripts.mediaAssetId, mediaAssetId)))
    .orderBy(desc(transcripts.createdAt))
    .limit(1);
  if (transcript === undefined) throw new ToolError("There is no transcript yet: call transcribe first");
  const wordsText = await readFile(join(projectRootOf(context, project), transcript.wordsRelPath), "utf8");
  return TranscriptWordsSchema.parse(JSON.parse(wordsText));
}
