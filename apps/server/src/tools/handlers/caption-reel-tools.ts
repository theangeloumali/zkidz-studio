// Created by The Angelo Umali.
// set_captions and set_reel (plan §6.8): captions/vN.json and reels/vN.json, checked before they are written.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CaptionPhraseSchema, type Cue, type ReelKeep } from "@zks/shared";
import { z } from "zod";
import { findCaptionErrors } from "../caption-checks.ts";
import { readCueSheet } from "../cue-sheets.ts";
import { implementTool } from "../define-tool.ts";
import { loadProject, projectRootOf } from "../project-files.ts";
import { ToolError } from "../result.ts";
import { writeAgentSpec } from "../spec-store.ts";

const PhraseFileSchema = z.array(CaptionPhraseSchema);
// The overlay drops a cue from the reel when the reel keeps less than half of its span (overlay/timemap.js).
const REEL_MIN_KEPT = 0.5;
const MS_PER_SECOND = 1000;

const setCaptions = implementTool("set_captions", {
  description:
    "Write the English captions as groups of consecutive phrase ids from make_caption_phrases. Every phrase is captioned once; a group may not cross a Reels keep edge or wrap past two lines.",
  handler: async (input, context) => {
    const project = await loadProject(context);
    const phrasesPath = join(projectRootOf(context, project), "work", "captions", `${project.videoId}.phrases.json`);
    const phrasesText = await readFile(phrasesPath, "utf8").catch(() => {
      throw new ToolError("There are no caption phrases yet: call make_caption_phrases first");
    });
    const errors = findCaptionErrors(input.entries, PhraseFileSchema.parse(JSON.parse(phrasesText)));
    if (errors.length > 0) throw new ToolError(errors.join("; "));
    const version = await writeAgentSpec(context, { videoId: project.videoId, kind: "captions" }, input.entries);
    return { output: { version, warnings: [], cues: input.entries.length } };
  },
});

const setReel = implementTool("set_reel", {
  description: "Set the source ranges the Reels cut keeps, in source order. Returns the reel's length and the main-sheet cues it drops.",
  handler: async (input, context) => {
    const project = await loadProject(context);
    const reelSpec = { schemaVersion: 1, baseVideoId: project.videoId, keep: input.keep };
    const version = await writeAgentSpec(context, { videoId: project.videoId, kind: "reels" }, reelSpec);
    const mainCues = await readCueSheet(context, project.videoId, "main");
    const keptS = input.keep.reduce((total, keep) => total + (keep.end - keep.at), 0);
    const droppedCues = mainCues.filter((cue) => keptFraction(cue, input.keep) < REEL_MIN_KEPT).map((cue) => cue.id ?? `${cue.kind}@${cue.at}`);
    return { output: { version, warnings: [], reelId: `${project.videoId}r`, seconds: Math.round(keptS * MS_PER_SECOND) / MS_PER_SECOND, droppedCues } };
  },
});

function keptFraction(cue: Cue, keeps: readonly ReelKeep[]): number {
  const keptS = keeps.reduce((total, keep) => total + Math.max(0, Math.min(cue.end, keep.end) - Math.max(cue.at, keep.at)), 0);
  return keptS / (cue.end - cue.at);
}

export const captionReelTools = [setCaptions, setReel];
