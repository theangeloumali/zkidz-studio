// Created by The Angelo Umali.
// sample_reference (slice D): a contact sheet, frames, pace and loudness of a reference video, for matching its look.
import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { MAX_REFERENCE_FRAMES } from "@zks/shared";
import { pinnedToolPath } from "../../config.ts";
import { confinePath } from "../../security/confine-path.ts";
import { implementTool } from "../define-tool.ts";
import { assetFilePath, findProjectAsset, loadProject, projectRootOf } from "../project-files.ts";
import { readPngImageBlock, ToolError } from "../result.ts";

const runFile = promisify(execFile);
const FFMPEG_TIMEOUT_MS = 120_000;
const FFMPEG_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const CONTACT_SHEET_TILES = 9;
const SCENE_CHANGE_THRESHOLD = 0.3;
const FRAME_WIDTH = 720;
const LOUDNESS_LINE = /I:\s+(-?\d+(?:\.\d+)?) LUFS/g;

const sampleReference = implementTool("sample_reference", {
  description: `Look at a reference video: a 3x3 contact sheet across it, up to ${MAX_REFERENCE_FRAMES} frames, its pace (shot changes) and loudness. Read-only.`,
  handler: async (input, context) => {
    const project = await loadProject(context);
    const projectRoot = projectRootOf(context, project);
    const asset = await findProjectAsset(context, input.assetId);
    if (asset.kind !== "reference") throw new ToolError(`Asset ${asset.id} is not a reference: upload the look to match with kind=reference`);
    if (asset.durationS === null || asset.durationS <= 0) throw new ToolError(`Reference ${asset.id} has no duration to sample`);
    const durationS = asset.durationS;
    const ffmpeg = (args: string[]) => runFfmpeg(context.studioHome, ["-hide_banner", "-nostats", "-i", assetFilePath(projectRoot, asset), ...args]);

    const outputRel = `work/reference/${asset.id}`;
    await mkdir(join(projectRoot, outputRel), { recursive: true });
    const outputDir = await confinePath(projectRoot, outputRel);
    const contactSheet = `${outputRel}/contact.png`;
    const frameCount = input.frames ?? MAX_REFERENCE_FRAMES;
    const frames = Array.from({ length: frameCount }, (_unused, index) => ({
      at: roundTo(((index + 0.5) * durationS) / frameCount, 2),
      path: `${outputRel}/frame-${index + 1}.png`,
    }));

    await ffmpeg(["-vf", `fps=${CONTACT_SHEET_TILES / durationS},scale=360:-2,tile=3x3`, "-frames:v", "1", "-y", join(outputDir, "contact.png")]);
    for (const [index, frame] of frames.entries()) {
      // -ss after -i decodes up to the time: slower, but exact on a long-GOP clip.
      await ffmpeg(["-ss", String(frame.at), "-frames:v", "1", "-vf", `scale=${FRAME_WIDTH}:-2`, "-y", join(outputDir, `frame-${index + 1}.png`)]);
    }
    const shotChanges = countSceneChanges(
      (await ffmpeg(["-an", "-vf", `scale=320:-2,select='gt(scene,${SCENE_CHANGE_THRESHOLD})',showinfo`, "-f", "null", "-"])).stderr,
    );
    const loudnessLufs =
      typeof asset.probe?.audioCodec === "string"
        ? integratedLoudness((await ffmpeg(["-vn", "-af", "ebur128=framelog=quiet", "-f", "null", "-"])).stderr)
        : null;

    const images = await Promise.all([contactSheet, ...frames.map((frame) => frame.path)].map((path) => readPngImageBlock(projectRoot, path)));
    const output = {
      durationS,
      contactSheet,
      frames,
      shotChangesPerMinute: roundTo(shotChanges / (durationS / 60), 1),
      averageShotS: roundTo(durationS / (shotChanges + 1), 2),
      loudnessLufs,
    };
    return { output, images };
  },
});

async function runFfmpeg(studioHome: string, args: string[]): Promise<{ stderr: string }> {
  let ffmpegPath: string;
  try {
    ffmpegPath = pinnedToolPath(process.env, studioHome, "ffmpeg");
  } catch (error) {
    throw new ToolError(error instanceof Error ? error.message : "ffmpeg is not installed");
  }
  try {
    return await runFile(ffmpegPath, args, { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: FFMPEG_MAX_OUTPUT_BYTES });
  } catch (error) {
    const stderr = typeof error === "object" && error !== null && "stderr" in error ? String(error.stderr) : "";
    throw new ToolError(`ffmpeg could not sample the reference: ${stderr.trim().split("\n").at(-1) ?? "no output"}`);
  }
}

/** showinfo prints one line per frame the scene filter let through. */
function countSceneChanges(stderr: string): number {
  return stderr.split("\n").filter((line) => line.includes("Parsed_showinfo") && line.includes("pts_time:")).length;
}

/** ebur128 logs a running I: per window; the summary's line is the last one. */
function integratedLoudness(stderr: string): number | null {
  const lastMatch = [...stderr.matchAll(LOUDNESS_LINE)].at(-1);
  return lastMatch?.[1] === undefined ? null : Number(lastMatch[1]);
}

function roundTo(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

// Confined at open, so a file swapped for a link out of the project is never read back to the model.
export const referenceTools = [sampleReference];
