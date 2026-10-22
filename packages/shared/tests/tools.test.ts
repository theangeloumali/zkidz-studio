// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { ProjectPathSchema, STUDIO_TOOL_NAMES, STUDIO_TOOLS, findStudioTool, studioToolName } from "../src/index.ts";
import { ASSET_ID, JOB_ID, validCutSpec } from "./fixtures.ts";
import { sampleCueByKind } from "./cue-samples.ts";

// Plan §6.8: tool → approval class and whether it is read-only.
const EXPECTED_CATALOG = {
  project_info: ["auto", true],
  get_capabilities: ["auto", true],
  probe_media: ["auto", true],
  ingest: ["auto", false],
  transcribe: ["auto", false],
  read_transcript: ["auto", true],
  check_window: ["auto", true],
  energy_profile: ["auto", true],
  propose_cuts: ["review", false],
  set_cuts: ["auto", false],
  set_reel: ["auto", false],
  list_cue_kinds: ["auto", true],
  add_cue: ["auto", false],
  update_cue: ["auto", false],
  remove_cue: ["auto", false],
  make_caption_phrases: ["auto", true],
  set_captions: ["auto", false],
  validate_spec: ["auto", true],
  render_preview: ["auto", true],
  check_motion: ["auto", true],
  make_covers: ["auto", false],
  render_master: ["gate", false],
  qc_master: ["auto", true],
  export_deliverable: ["gate", false],
  delete_asset: ["gate", false],
  job_status: ["auto", true],
  job_wait: ["auto", true],
  job_cancel: ["auto", false],
  approve: ["permission_prompt", false],
} as const;

const VALID_INPUT_BY_TOOL: Record<keyof typeof EXPECTED_CATALOG, unknown> = {
  project_info: {},
  get_capabilities: {},
  probe_media: { assetId: ASSET_ID },
  ingest: { clips: [{ assetId: ASSET_ID, zoom: 1.08 }] },
  transcribe: { language: "tl", model: "turbo" },
  read_transcript: { from: 0, to: 60, format: "readable", page: 1 },
  check_window: { ranges: [{ at: 169.2, end: 169.8 }] },
  energy_profile: { from: 10, to: 20 },
  propose_cuts: { targetS: 60, removeFillers: true, trimPauses: true },
  set_cuts: { cuts: validCutSpec },
  set_reel: { keep: [{ at: 5, end: 14.6, pin: true }] },
  list_cue_kinds: { theme: "zkidz" },
  add_cue: { sheet: "main", cue: sampleCueByKind.keyword },
  update_cue: { id: "cue-7", patch: { text: "September 22" } },
  remove_cue: { id: "cue-7" },
  make_caption_phrases: { reel: true },
  set_captions: { entries: [{ ids: [0], en: "Hello, bosses" }] },
  validate_spec: { videoId: "v1" },
  render_preview: { at: [1.5, 30], guides: true },
  check_motion: { stage: "master" },
  make_covers: { variants: [{ source: "intro", at: 2.3 }] },
  render_master: { target: "full", quality: "4k" },
  qc_master: { target: "reel" },
  export_deliverable: { kinds: ["full", "cover_a"] },
  delete_asset: { assetId: ASSET_ID },
  job_status: { jobId: JOB_ID },
  job_wait: { jobId: JOB_ID, timeoutS: 120 },
  job_cancel: { jobId: JOB_ID },
  approve: { tool: "mcp__studio__render_master", input: { target: "full", quality: "4k" } },
};

describe("STUDIO_TOOLS catalog (plan §6.8)", () => {
  it("holds exactly the plan's tools with their approval class and read-only flag", () => {
    const actualCatalog = Object.fromEntries(Object.entries(STUDIO_TOOLS).map(([toolName, tool]) => [toolName, [tool.approval, tool.isReadOnly]]));

    expect(actualCatalog).toEqual(EXPECTED_CATALOG);
  });

  it("finds a contract by bare or qualified name, and nothing else", () => {
    expect(findStudioTool("mcp__studio__render_master")?.approval).toBe("gate");
    expect(findStudioTool("render_master")?.approval).toBe("gate");
    expect(findStudioTool("Bash")).toBeUndefined();
    expect(findStudioTool("mcp__other__render_master")).toBeUndefined();
  });

  it("exposes every tool under the mcp__studio__ prefix", () => {
    expect(studioToolName("set_cuts")).toBe("mcp__studio__set_cuts");
    expect(STUDIO_TOOL_NAMES).toHaveLength(Object.keys(EXPECTED_CATALOG).length);
    expect(STUDIO_TOOL_NAMES.every((qualifiedName) => qualifiedName.startsWith("mcp__studio__"))).toBe(true);
  });

  it.each(Object.entries(VALID_INPUT_BY_TOOL))("accepts a valid %s input", (toolName, validInput) => {
    const tool = findStudioTool(toolName);

    expect(tool).toBeDefined();
    expect(tool?.input.safeParse(validInput).error?.issues ?? []).toEqual([]);
  });
});

describe("tool input rejections", () => {
  it("set_cuts rejects a cut spec carrying a path", () => {
    expect(STUDIO_TOOLS.set_cuts.input.safeParse({ cuts: { ...validCutSpec, source: "/etc/passwd" } }).success).toBe(false);
  });

  it("job_wait caps a wait at 120 s", () => {
    expect(STUDIO_TOOLS.job_wait.input.safeParse({ jobId: JOB_ID, timeoutS: 121 }).success).toBe(false);
  });

  it("render_preview returns at most 4 stills", () => {
    expect(STUDIO_TOOLS.render_preview.input.safeParse({ at: [1, 2, 3, 4, 5] }).success).toBe(false);
  });

  it.each([
    [
      "overlapping",
      [
        { at: 5, end: 14.6 },
        { at: 14, end: 20 },
      ],
    ],
    [
      "out-of-order",
      [
        { at: 30, end: 40 },
        { at: 5, end: 14.6 },
      ],
    ],
  ])("set_reel rejects %s keeps, like ReelSpecSchema", (_label, keep) => {
    expect(STUDIO_TOOLS.set_reel.input.safeParse({ keep }).success).toBe(false);
  });

  it("add_cue rejects an unknown sheet", () => {
    expect(STUDIO_TOOLS.add_cue.input.safeParse({ sheet: "draft", cue: sampleCueByKind.keyword }).success).toBe(false);
  });

  it("rejects unknown input keys so a stray path cannot ride along", () => {
    expect(STUDIO_TOOLS.probe_media.input.safeParse({ assetId: ASSET_ID, path: "/etc/passwd" }).success).toBe(false);
  });
});

describe("tool outputs", () => {
  it("a long job answers with a job handle at once", () => {
    expect(STUDIO_TOOLS.render_master.output.safeParse({ jobId: JOB_ID }).success).toBe(true);
  });

  it("read_transcript output discriminates on format", () => {
    const readTranscriptOutput = STUDIO_TOOLS.read_transcript.output;

    expect(readTranscriptOutput.safeParse({ format: "readable", page: 1, pageCount: 3, text: "Yo mga boss" }).success).toBe(true);
    expect(readTranscriptOutput.safeParse({ format: "words", page: 1, pageCount: 1, words: [{ at: 0, end: 0.4, text: "Yo" }] }).success).toBe(true);
    expect(readTranscriptOutput.safeParse({ format: "words", page: 1, pageCount: 1, text: "Yo" }).success).toBe(false);
  });

  it.each(["/home/user/out.mp4", "C:\\out.mp4", "../escape.mp4", "deliverables/../../escape.mp4"])(
    "output paths stay relative to the project: rejects %s",
    (escapingPath) => {
      const exportOutput = { deliverables: [{ kind: "full", path: escapingPath, sha256: "a".repeat(64) }] };

      expect(STUDIO_TOOLS.export_deliverable.output.safeParse(exportOutput).success).toBe(false);
    },
  );

  it.each([
    ["a UNC path", "\\\\server\\share\\x.mp4"],
    ["a device path", "\\\\?\\C:\\x.mp4"],
    ["a root-relative Windows path", "\\Windows\\x.mp4"],
    ["an alternate data stream", "out.mp4:ads"],
    ["a reserved device name", "CON"],
    ["a reserved name with an extension", "deliverables/nul.mp4"],
    ["a numbered reserved name in any case", "lpt9.txt"],
    ["a segment ending in a dot", "covers./a.png"],
    ["a segment ending in a space", "covers /a.png"],
    ["a NUL byte", "a\u0000.mp4"],
    ["an empty segment", "deliverables//a.mp4"],
    ["a trailing separator", "deliverables/"],
  ])("ProjectPathSchema rejects %s (plan §9.4)", (_label, unsafePath) => {
    expect(ProjectPathSchema.safeParse(unsafePath).success).toBe(false);
  });

  it.each(["deliverables/v1-full.mp4", "covers\\cover-A.png", "console.log.txt", "com10.mp4", ".hidden/a.png"])("ProjectPathSchema accepts %s", (safePath) => {
    expect(ProjectPathSchema.safeParse(safePath).success).toBe(true);
  });

  it("approve answers allow or deny", () => {
    expect(STUDIO_TOOLS.approve.output.safeParse({ behavior: "deny", message: "User declined" }).success).toBe(true);
    expect(STUDIO_TOOLS.approve.output.safeParse({ behavior: "maybe" }).success).toBe(false);
  });
});
