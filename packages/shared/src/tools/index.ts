// Created by The Angelo Umali.
// The `studio` MCP server's catalog; both the SDK server and the stdio twin register from this one object.
import type { StudioToolContract } from "./define.ts";
import { addCue, listCueKinds, makeCaptionPhrases, proposeCuts, removeCue, setCaptions, setCuts, setReel, updateCue, validateSpec } from "./edit.ts";
import { approve, jobCancel, jobStatus, jobWait } from "./jobs.ts";
import { checkWindow, energyProfile, getCapabilities, ingest, probeMedia, projectInfo, readTranscript, transcribe } from "./media.ts";
import { checkMotion, deleteAsset, exportDeliverable, makeCovers, qcMaster, renderMaster, renderPreview } from "./render.ts";

export * from "./define.ts";
export { CUE_SHEETS } from "./edit.ts";
export { JobSnapshotSchema, MAX_JOB_WAIT_S } from "./jobs.ts";
export { IngestResultSchema, RENDER_PROFILES, TranscribeResultSchema, WHISPER_MODELS } from "./media.ts";
export { MasterRenderResultSchema, RENDER_QUALITIES, RENDER_TARGETS } from "./render.ts";

export const STUDIO_TOOLS = {
  project_info: projectInfo,
  get_capabilities: getCapabilities,
  probe_media: probeMedia,
  ingest,
  transcribe,
  read_transcript: readTranscript,
  check_window: checkWindow,
  energy_profile: energyProfile,
  propose_cuts: proposeCuts,
  set_cuts: setCuts,
  set_reel: setReel,
  list_cue_kinds: listCueKinds,
  add_cue: addCue,
  update_cue: updateCue,
  remove_cue: removeCue,
  make_caption_phrases: makeCaptionPhrases,
  set_captions: setCaptions,
  validate_spec: validateSpec,
  render_preview: renderPreview,
  check_motion: checkMotion,
  make_covers: makeCovers,
  render_master: renderMaster,
  qc_master: qcMaster,
  export_deliverable: exportDeliverable,
  delete_asset: deleteAsset,
  job_status: jobStatus,
  job_wait: jobWait,
  job_cancel: jobCancel,
  approve,
} as const satisfies Record<string, StudioToolContract>;

export type StudioToolName = keyof typeof STUDIO_TOOLS;

const STUDIO_TOOL_PREFIX = "mcp__studio__";

export function studioToolName(toolName: StudioToolName): `mcp__studio__${StudioToolName}` {
  return `${STUDIO_TOOL_PREFIX}${toolName}`;
}

function isStudioToolName(candidateName: string): candidateName is StudioToolName {
  return Object.hasOwn(STUDIO_TOOLS, candidateName);
}

/** Every catalog tool, qualified. */
export const STUDIO_TOOL_NAMES = Object.keys(STUDIO_TOOLS).filter(isStudioToolName).map(studioToolName);

/** Mode T's `--allowedTools` (plan §6.3): gated tools stay out so Claude Code's own prompt backs up the server's gate. */
export const STUDIO_AUTO_ALLOWED_TOOL_NAMES = STUDIO_TOOL_NAMES.filter((qualifiedName) => findStudioTool(qualifiedName)?.approval === "auto");

/** Looks up a contract by bare or `mcp__studio__`-qualified name, e.g. from a hook payload's tool_name. */
export function findStudioTool(toolName: string): StudioToolContract | undefined {
  const bareName = toolName.startsWith(STUDIO_TOOL_PREFIX) ? toolName.slice(STUDIO_TOOL_PREFIX.length) : toolName;
  return isStudioToolName(bareName) ? STUDIO_TOOLS[bareName] : undefined;
}
