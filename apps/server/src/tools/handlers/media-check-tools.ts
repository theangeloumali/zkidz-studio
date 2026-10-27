// Created by The Angelo Umali.
// probe_media, check_window, energy_profile and make_caption_phrases: short read-only engine checks (plan §6.8).
import { STUDIO_TOOLS } from "@zks/shared";
import { implementTool } from "../define-tool.ts";
import { projectWorkDir, runEngineCheck } from "../engine-check.ts";
import { assetEngineInput, findProjectAsset, loadProject, projectRootOf } from "../project-files.ts";
import { readLatestTranscriptSettings } from "../transcript-store.ts";

const probeMedia = implementTool("probe_media", {
  description: "Probe one media asset: duration, frame rate, size, rotation, HDR, audio and whether its frame rate varies.",
  handler: async (input, context) => {
    const project = await loadProject(context);
    const { path, inPlacePaths } = assetEngineInput(projectRootOf(context, project), await findProjectAsset(context, input.assetId));
    const workDir = await projectWorkDir(context, project);
    const report = await runEngineCheck(() => context.engine.run({ command: "probe", args: [path], workDir, inPlacePaths }));
    return { output: STUDIO_TOOLS.probe_media.output.parse(report) };
  },
});

const checkWindow = implementTool("check_window", {
  description: "Re-transcribe short source ranges word by word, to check exactly what is said around a planned cut or cue.",
  handler: async (input, context) => {
    const project = await loadProject(context);
    // The transcript's own language and model, as QC's second opinion hears the same windows.
    const transcript = await readLatestTranscriptSettings(context);
    const rangeArgs = input.ranges.flatMap((range) => ["--range", `${range.at}-${range.end}`]);
    const hearing = transcript === undefined ? [] : ["--language", transcript.language, "--model", transcript.model];
    const args = ["--video", project.videoId, ...rangeArgs, ...hearing];
    const workDir = await projectWorkDir(context, project);
    const report = await runEngineCheck(() => context.engine.run({ command: "check-window", args, workDir }));
    return { output: STUDIO_TOOLS.check_window.output.parse(report) };
  },
});

const energyProfile = implementTool("energy_profile", {
  description: "Loudness of the source between two times in dB per step, with the quiet runs, to place cuts in silence.",
  handler: async (input, context) => {
    const project = await loadProject(context);
    const args = ["--video", project.videoId, "--from", String(input.from), "--to", String(input.to)];
    const workDir = await projectWorkDir(context, project);
    const report = await runEngineCheck(() => context.engine.run({ command: "energy-profile", args, workDir }));
    return { output: STUDIO_TOOLS.energy_profile.output.parse(report) };
  },
});

const makeCaptionPhrases = implementTool("make_caption_phrases", {
  description: "Split the transcript into caption phrases (reel: true for the reel's shorter lines). set_captions references their ids.",
  handler: async (input, context) => {
    const project = await loadProject(context);
    const args = ["--video", project.videoId, ...(input.reel === true ? ["--reel"] : [])];
    const workDir = await projectWorkDir(context, project);
    const report = await runEngineCheck(() => context.engine.run({ command: "caption-phrases", args, workDir }));
    return { output: STUDIO_TOOLS.make_caption_phrases.output.parse(report) };
  },
});

export const mediaCheckTools = [probeMedia, checkWindow, energyProfile, makeCaptionPhrases];
