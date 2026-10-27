// Created by The Angelo Umali.
import { describe, expect, expectTypeOf, it } from "vitest";
import { CUE_KINDS, CueSchema, CueSheetSchema, ReelCuePatchSchema, type Cue } from "../src/index.ts";
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
