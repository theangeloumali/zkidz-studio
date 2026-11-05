// Created by The Angelo Umali.
import { describe, expect, expectTypeOf, it } from "vitest";
import { CUE_KINDS, CueSchema, CueSheetSchema, ReelCuePatchSchema, type Cue } from "../src/index.ts";
import { learningCueSchemas } from "../src/specs/learning-cues.ts";
import { sampleCueByKind } from "./cue-samples.ts";

describe("CueSchema", () => {
  it("has one valid sample per kind, and every sample parses", () => {
    expect(Object.keys(sampleCueByKind).sort()).toEqual([...CUE_KINDS].sort());
    for (const sampleCue of Object.values(sampleCueByKind)) {
      expect(CueSchema.safeParse(sampleCue).error?.issues ?? []).toEqual([]);
    }
  });

  it("rejects an unknown kind", () => {
    expect(CueSchema.safeParse({ kind: "spinner", at: 1, end: 2 }).success).toBe(false);
  });

  it("rejects the pipeline steps shape that crashed a render; labels is a 3-tuple", () => {
    const stepsShape = { kind: "pipeline", at: 150, end: 154, steps: [{ label: "lead", at: 0 }] };

    expect(CueSchema.safeParse(stepsShape).success).toBe(false);
    expect(CueSchema.safeParse({ ...sampleCueByKind.pipeline, labels: ["a", "b"] }).success).toBe(false);
  });

  it("rejects a field that belongs to another kind", () => {
    expect(CueSchema.safeParse({ ...sampleCueByKind.keyword, rows: [] }).success).toBe(false);
  });

  it("rejects a negative word pin", () => {
    const negativePin = { ...sampleCueByKind.criteriaCard, rows: [{ text: "Remote", at: -0.5 }] };

    expect(CueSchema.safeParse(negativePin).success).toBe(false);
  });

  it("rejects a cue whose end is not after its start", () => {
    expect(CueSchema.safeParse({ ...sampleCueByKind.comment, end: 0.1, at: 0.2 }).success).toBe(false);
  });

  it("accepts the optional server id and transcript anchor", () => {
    const anchoredCue = { ...sampleCueByKind.keyword, id: "cue-7", anchor: { phrase: "September 21", wordIndex: 3 } };

    expect(CueSchema.safeParse(anchoredCue).success).toBe(true);
  });

  it("refuses a plate behind a big word (the v2 rules ban backdrops behind words)", () => {
    expect(CueSchema.safeParse({ ...sampleCueByKind.bigWord, plate: "ink" }).success).toBe(false);
  });

  it("accepts depth front or behind on a house kind and refuses anything else", () => {
    expect(CueSchema.safeParse({ ...sampleCueByKind.keyword, depth: "behind" }).success).toBe(true);
    expect(CueSchema.safeParse({ ...sampleCueByKind.keyword, depth: "under" }).success).toBe(false);
  });

  // v2 rule 5 (#43): every word on a learning edit stays fully visible, so none draws under the person matte.
  it("refuses depth on every learning kind", () => {
    const learningSamples = Object.values(sampleCueByKind).filter((cue) => learningCueSchemas.some((schema) => schema.safeParse(cue).success));
    expect(learningSamples.length).toBeGreaterThanOrEqual(17);
    for (const cue of learningSamples) expect(CueSchema.safeParse({ ...cue, depth: "behind" }).success, cue.kind).toBe(false);
  });

  it("takes a routeMap's region as a name or a lon/lat box, and refuses a stop off the globe", () => {
    const map = sampleCueByKind.routeMap;
    expect(CueSchema.safeParse({ ...map, region: [118, 4, 127, 21] }).success).toBe(true);
    expect(CueSchema.safeParse({ ...map, region: "mars" }).success).toBe(false);
    expect(CueSchema.safeParse({ ...map, stops: [{ name: "X", lon: 200, lat: 0, at: 0.5 }] }).success).toBe(false);
  });

  // An odd crop failed only at render, after a 10-min preview (Phase 6): the tool call refuses it at once.
  it("refuses a footage card crop that is odd-sized or leaves the frame", () => {
    const card = sampleCueByKind.footageCard;
    expect(CueSchema.safeParse({ ...card, crop: [0, 360, 1080, 712] }).success).toBe(true);
    expect(CueSchema.safeParse({ ...card, crop: [0, 360, 1080, 711] }).success).toBe(false);
    expect(CueSchema.safeParse({ ...card, crop: [100, 360, 1080, 712] }).success).toBe(false);
  });

  it("refuses an image src that leaves the project", () => {
    for (const src of ["/etc/passwd", "C:/Users/x.png", "media/../../secret.png"]) {
      expect(CueSchema.safeParse({ ...sampleCueByKind.backdrop, src }).success).toBe(false);
    }
  });

  it("accepts a words-style caption and refuses a scale outside 0.6-2.0", () => {
    const wordsCaption = { kind: "caption", at: 1, end: 1.4, style: "words", text: "Save", line: "Save before you spend", pills: [0], scale: 1.2 };

    expect(CueSchema.safeParse(wordsCaption).success).toBe(true);
    expect(CueSchema.safeParse({ ...wordsCaption, scale: 3 }).success).toBe(false);
  });

  it("refuses a fourth flow step and a meter level off the dial", () => {
    const steps = [...sampleCueByKind.flowSteps.steps, { label: "More", kind: "check", at: 2 }];

    expect(CueSchema.safeParse({ ...sampleCueByKind.flowSteps, steps }).success).toBe(false);
    expect(CueSchema.safeParse({ ...sampleCueByKind.meterGauge, level: 1.2 }).success).toBe(false);
  });

  it("narrows on kind", () => {
    const parsedCue = CueSchema.parse(sampleCueByKind.hookTitle);
    if (parsedCue.kind === "hookTitle") expectTypeOf(parsedCue.lines).toEqualTypeOf<string[]>();
    expectTypeOf<Extract<Cue, { kind: "pipeline" }>["labels"]>().toEqualTypeOf<[string, string, string]>();
  });
});

describe("CueSheetSchema and reel patches", () => {
  it("accepts a sheet of mixed kinds", () => {
    expect(CueSheetSchema.safeParse(Object.values(sampleCueByKind)).success).toBe(true);
  });

  it("accepts a remove patch matched by kind and at", () => {
    expect(ReelCuePatchSchema.safeParse({ op: "remove", match: { kind: "lowerThird", at: 4 } }).success).toBe(true);
  });

  it("requires a cue on a replace patch", () => {
    expect(ReelCuePatchSchema.safeParse({ op: "replace", match: { kind: "keyword", at: 31.2 } }).success).toBe(false);
    expect(ReelCuePatchSchema.safeParse({ op: "replace", match: { kind: "keyword", at: 31.2 }, cue: sampleCueByKind.keyword }).success).toBe(true);
  });
});
