// Created by The Angelo Umali.
// Read-only project tools: project_info, get_capabilities, read_transcript (plan §6.8).
import { readFile } from "node:fs/promises";
import { slugifyTitle } from "../../projects/project-store.ts";
import { join } from "node:path";
import { mediaAssets } from "@zks/db/schema";
import { STUDIO_TOOLS } from "@zks/shared";
import { and, asc, eq, inArray } from "drizzle-orm";
import { hasErrorCode } from "@zks/db";
import { CAPABILITIES_FILE } from "../../jobs/master-files.ts";
import { readEnabledRuleTexts } from "../../rules/rule-reader.ts";
import { implementTool } from "../define-tool.ts";
import type { MediaAssetRow } from "../../dto.ts";
import { loadProject, PROJECT_THEME_ID } from "../project-files.ts";
import { ToolError } from "../result.ts";
import { readLatestWords, type TranscriptWord } from "../transcript-store.ts";

const CLIP_KINDS = ["camera", "screen_recording", "film"] as const;
const QUARTER_TURNS = [0, 90, 180, 270] as const;
const WORDS_PER_PAGE = 400;
const WORDS_PER_READABLE_LINE = 12;

const projectInfo = implementTool("project_info", {
  description: "The project's video id, its clips by assetId (duration, fps, rotation, HDR), the theme and the user's style rules.",
  handler: async (_input, context) => {
    const project = await loadProject(context);
    const clipRows = await context.db
      .select()
      .from(mediaAssets)
      .where(and(eq(mediaAssets.projectId, context.projectId), inArray(mediaAssets.kind, [...CLIP_KINDS])))
      .orderBy(asc(mediaAssets.createdAt));
    const ruleTexts = await readEnabledRuleTexts(context.db);
    return { output: { videoId: project.videoId, clips: clipRows.flatMap(toClipInfo), theme: PROJECT_THEME_ID, rules: ruleTexts } };
  },
});

/** A clip the probe could not time is left out: Claude cannot cut what has no duration or frame rate. */
function toClipInfo(asset: MediaAssetRow) {
  if (asset.durationS === null || asset.fpsNum === null || asset.fpsDen === null) return [];
  const storedRotation = asset.probe?.rotation;
  const rotation = QUARTER_TURNS.find((quarterTurn) => quarterTurn === storedRotation) ?? 0;
  return [
    {
      assetId: asset.id,
      name: slugifyTitle(asset.name),
      durationS: asset.durationS,
      fps: { num: asset.fpsNum, den: asset.fpsDen },
      rotation,
      hdr: asset.isHdr,
    },
  ];
}

const getCapabilitiesTool = implementTool("get_capabilities", {
  description: "The render profile and features the hardware probe found on this machine, and the transcriber in use.",
  handler: async (_input, context) => {
    try {
      const capabilitiesText = await readFile(join(context.studioHome, CAPABILITIES_FILE), "utf8");
      return { output: STUDIO_TOOLS.get_capabilities.output.parse(JSON.parse(capabilitiesText)) };
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) throw new ToolError("The hardware has not been probed yet. Ask the user to run: pnpm zks doctor");
      throw error;
    }
  },
});

const readTranscript = implementTool("read_transcript", {
  description: `Read the transcript in source seconds, ${WORDS_PER_PAGE} words per page, as timestamped lines ("readable") or word objects ("words").`,
  handler: async (input, context) => {
    const allWords = await readLatestWords(context);
    const fromS = input.from ?? 0;
    const toS = input.to ?? Number.POSITIVE_INFINITY;
    const rangeWords = allWords.filter((word) => word.end > fromS && word.at < toS);
    const pageCount = Math.ceil(rangeWords.length / WORDS_PER_PAGE);
    const page = input.page ?? 1;
    if (page > Math.max(pageCount, 1)) throw new ToolError(`Page ${page} is past the last page (${pageCount})`);
    const pageWords = rangeWords.slice((page - 1) * WORDS_PER_PAGE, page * WORDS_PER_PAGE);
    if (input.format === "words") return { output: { format: "words", page, pageCount, words: pageWords } };
    return { output: { format: "readable", page, pageCount, text: toReadableLines(pageWords) } };
  },
});

function toReadableLines(words: readonly TranscriptWord[]): string {
  const lines: string[] = [];
  for (let lineStart = 0; lineStart < words.length; lineStart += WORDS_PER_READABLE_LINE) {
    const lineWords = words.slice(lineStart, lineStart + WORDS_PER_READABLE_LINE);
    lines.push(`[${(lineWords[0]?.at ?? 0).toFixed(2)}] ${lineWords.map((word) => word.text).join(" ")}`);
  }
  return lines.join("\n");
}

export const projectTools = [projectInfo, getCapabilitiesTool, readTranscript];
