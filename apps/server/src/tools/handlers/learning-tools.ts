// Created by The Angelo Umali.
// set_beat_map and frame_faces (#38): the v2 Live Motion look's beat map and the presenter's face boxes.
import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { STUDIO_TOOLS } from "@zks/shared";
import { implementTool } from "../define-tool.ts";
import { projectWorkDir, runEngineCheck } from "../engine-check.ts";
import type { ToolContext } from "../context.ts";
import { loadProject } from "../project-files.ts";
import { ToolError } from "../result.ts";

const RESEARCH_DIR = "research";
const BEAT_MAP_FILE = "beat-map.json";

async function beatMapPath(context: ToolContext): Promise<string> {
  return join(await projectWorkDir(context), RESEARCH_DIR, BEAT_MAP_FILE);
}

/** The v2 rules write the beat map before any cue; a learning project's add_cue calls this first. */
export async function assertBeatMapWritten(context: ToolContext): Promise<void> {
  try {
    await access(await beatMapPath(context));
  } catch {
    throw new ToolError("Write the beat map with set_beat_map before the first cue: every learning cue comes from a beat.");
  }
}

const setBeatMap = implementTool("set_beat_map", {
  description:
    "Write the edit's beat map (replaces it): one row per beat with the word, its source time, the visual that proves it and whether it sits on footage or paper. A learning project's cues need one.",
  handler: async (input, context) => {
    const path = await beatMapPath(context);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, `${JSON.stringify({ beats: input.beats }, null, 2)}\n`);
    return { output: { beats: input.beats.length } };
  },
});

const frameFaces = implementTool("frame_faces", {
  description:
    "Face boxes in the project's video on the 1080x1920 grid, sampled `fps` times a second (default 1) over at..end, and the picture band inside any letterbox. Use them to place reframes and keep graphics off the face.",
  handler: async (input, context) => {
    const { videoId } = await loadProject(context);
    const span = [...(input.at === undefined ? [] : ["--at", String(input.at)]), ...(input.end === undefined ? [] : ["--end", String(input.end)])];
    const args = ["--video", videoId, ...span, ...(input.fps === undefined ? [] : ["--fps", String(input.fps)])];
    const workDir = await projectWorkDir(context);
    const report = await runEngineCheck(() => context.engine.run({ command: "frame-faces", args, workDir }));
    const parsed = STUDIO_TOOLS.frame_faces.output.safeParse(report);
    if (!parsed.success) throw new ToolError("The engine's face report had an unexpected shape.");
    return { output: parsed.data };
  },
});

export const learningTools = [setBeatMap, frameFaces];
