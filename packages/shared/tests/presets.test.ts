// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { HomeTemplateSchema, STYLE_SAMPLE_SECONDS, StylePresetSchema } from "../src/index.ts";

const validPreset = {
  schemaVersion: 1,
  id: "plain",
  name: "Plain",
  description: "Captions and cuts only.",
  theme: "zkidz",
  cardTiers: [],
  sfx: "none",
  intro: false,
  guidance: "Captions on every line. No title cards and no sound effects.",
  sample: [{ kind: "caption", at: 0.2, end: 4.8, text: "Captions only, no cards." }],
};

const validTemplate = {
  schemaVersion: 1,
  id: "vlog",
  name: "Vlog",
  description: "Joins many clips in order.",
  ingestMode: "join",
  prompt: "Make a 45-second vlog from these clips in order.",
};

describe("StylePresetSchema", () => {
  it("accepts a preset with a sample cue sheet", () => {
    expect(StylePresetSchema.safeParse(validPreset).success).toBe(true);
  });

  it("rejects a sample cue that runs past the 5 s sample", () => {
    const parsed = StylePresetSchema.safeParse({ ...validPreset, sample: [{ ...validPreset.sample[0], end: STYLE_SAMPLE_SECONDS + 0.1 }] });

    expect(parsed.success).toBe(false);
  });

  it("caps guidance at the 500 characters a user rule may hold", () => {
    expect(StylePresetSchema.safeParse({ ...validPreset, guidance: "x".repeat(501) }).success).toBe(false);
  });

  it("rejects a theme id that could name a path", () => {
    expect(StylePresetSchema.safeParse({ ...validPreset, theme: "../zkidz" }).success).toBe(false);
  });

  it("rejects an unknown card tier", () => {
    expect(StylePresetSchema.safeParse({ ...validPreset, cardTiers: ["loud"] }).success).toBe(false);
  });
});

describe("HomeTemplateSchema", () => {
  it("accepts a template with an ingest mode", () => {
    expect(HomeTemplateSchema.safeParse(validTemplate).success).toBe(true);
  });

  it("rejects an unknown ingest mode", () => {
    expect(HomeTemplateSchema.safeParse({ ...validTemplate, ingestMode: "upload" }).success).toBe(false);
  });

  it("rejects an empty starter prompt", () => {
    expect(HomeTemplateSchema.safeParse({ ...validTemplate, prompt: "" }).success).toBe(false);
  });
});
