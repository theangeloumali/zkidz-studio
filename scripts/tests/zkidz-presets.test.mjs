// Created by The Angelo Umali.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CueSheetSchema, CutSpecSchema, HomeTemplateSchema, StylePresetSchema } from "@zks/shared";
import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PRESETS_DIR = join(REPO_ROOT, "themes", "zkidz", "presets");
const DEMO_SPEC_DIR = join(REPO_ROOT, "examples", "demo", "spec");

/** @param {string} path */
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

/** @param {string} folder */
function readJsonFolder(folder) {
  return readdirSync(folder)
    .filter((fileName) => fileName.endsWith(".json"))
    .map((fileName) => ({ fileName, data: readJson(join(folder, fileName)) }));
}

/** @type {{ components: { kind: string, slots: Record<string, number> }[] }} */
const zkidzIndex = readJson(join(REPO_ROOT, "themes", "zkidz", "index.json"));
const slotLimitsByKind = new Map(zkidzIndex.components.map((component) => [component.kind, component.slots]));

/** Every cue kind is drawn by the zkidz theme and every text slot fits its manifest width. @param {Record<string, unknown>[]} cues */
function expectCuesFitTheme(cues) {
  for (const cue of cues) {
    const slotLimits = slotLimitsByKind.get(String(cue.kind));
    expect(slotLimits, `${cue.kind} is in the zkidz manifest`).toBeDefined();
    for (const [slotName, maxChars] of Object.entries(slotLimits ?? {})) {
      const slotTexts = [cue[slotName]].flat().filter((text) => typeof text === "string");
      for (const text of slotTexts) expect(text.length, `${cue.kind}.${slotName} "${text}"`).toBeLessThanOrEqual(maxChars);
    }
  }
}

describe("zkidz style presets", () => {
  const presets = readJsonFolder(join(PRESETS_DIR, "styles"));

  it("ships the three style cards: zkidz, plain and loud", () => {
    expect(presets.map(({ data }) => data.id).sort()).toEqual(["loud", "plain", "zkidz"]);
  });

  it("names each file after its id and passes the shared schema", () => {
    for (const { fileName, data } of presets) {
      expect(fileName).toBe(`${data.id}.json`);
      expect(StylePresetSchema.parse(data).theme).toBe("zkidz");
    }
  });

  it("draws every sample cue in the zkidz theme within its widths", () => {
    for (const { data } of presets) expectCuesFitTheme(data.sample);
  });

  it("keeps plain free of cards and sound", () => {
    const plain = presets.find(({ data }) => data.id === "plain")?.data;
    expect(plain).toMatchObject({ cardTiers: [], sfx: "none", intro: false });
    expect(plain.sample.every((/** @type {{ kind: string }} */ cue) => cue.kind === "caption")).toBe(true);
  });
});

describe("Home templates", () => {
  const templates = readJsonFolder(join(PRESETS_DIR, "templates"));

  it("ships the three mock-up templates, each with its ingest mode", () => {
    const ingestModeById = Object.fromEntries(templates.map(({ data }) => [data.id, HomeTemplateSchema.parse(data).ingestMode]));
    expect(ingestModeById).toEqual({ "talking-head-short": "single", vlog: "join", "screen-recording-showcase": "showcase" });
  });

  it("names each file after its id", () => {
    for (const { fileName, data } of templates) expect(fileName).toBe(`${data.id}.json`);
  });
});

describe("demo project spec", () => {
  it("is a valid cut spec", () => {
    expect(CutSpecSchema.safeParse(readJson(join(DEMO_SPEC_DIR, "cut-spec.json"))).success).toBe(true);
  });

  it("is a valid cue sheet the zkidz theme draws", () => {
    const cues = CueSheetSchema.parse(readJson(join(DEMO_SPEC_DIR, "cues.json")));
    expectCuesFitTheme(cues);
  });
});
