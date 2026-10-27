// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { CaptionEntrySchema, CaptionPhraseSchema, CutSpecSchema, InsertSpecSchema, ReelSpecSchema } from "../src/index.ts";
import { ASSET_ID, validCutSpec } from "./fixtures.ts";

describe("CutSpecSchema", () => {
  it("accepts a full object-form cut spec", () => {
    expect(CutSpecSchema.safeParse(validCutSpec).success).toBe(true);
  });

  it("rejects a path field, so media is referenced only by assetId (plan §6.8)", () => {
    const parsed = CutSpecSchema.safeParse({ ...validCutSpec, source: "/etc/passwd" });

    expect(parsed.success).toBe(false);
  });

  it("rejects the legacy positional removal arrays", () => {
    const parsed = CutSpecSchema.safeParse({ ...validCutSpec, removals: [[19.95, 21.95, "filler"]] });

    expect(parsed.success).toBe(false);
  });

  it("rejects a span whose end is not after its start", () => {
    const parsed = CutSpecSchema.safeParse({ ...validCutSpec, removals: [{ at: 5, end: 5, reason: "empty" }] });

    expect(parsed.success).toBe(false);
  });

  it("rejects an unknown zoom preset", () => {
    const parsed = CutSpecSchema.safeParse({ ...validCutSpec, zooms: [{ at: 1, end: 2, preset: "spin" }] });

    expect(parsed.success).toBe(false);
  });

  it("rejects a blur box outside the 1080x1920 grid", () => {
    const parsed = CutSpecSchema.safeParse({ ...validCutSpec, blurBoxes: [{ at: 1, end: 2, x: 0, y: 1900, w: 100, h: 100, reason: "name" }] });

    expect(parsed.success).toBe(false);
  });
});

describe("ReelSpecSchema", () => {
  const validReel = {
    schemaVersion: 1,
    baseVideoId: "v1",
    keep: [
      { at: 5, end: 14.6, pin: true },
      { at: 18.5, end: 54.5 },
    ],
  };

  it("accepts keeps in source order", () => {
    expect(ReelSpecSchema.safeParse(validReel).success).toBe(true);
  });

  it("rejects overlapping or out-of-order keeps", () => {
    const parsed = ReelSpecSchema.safeParse({
      ...validReel,
      keep: [
        { at: 18.5, end: 54.5 },
        { at: 5, end: 20 },
      ],
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects a reel id as its base", () => {
    expect(ReelSpecSchema.safeParse({ ...validReel, baseVideoId: "v1r" }).success).toBe(false);
  });
});

describe("captions", () => {
  it("accepts a phrase that sits in no reel keep", () => {
    expect(CaptionPhraseSchema.safeParse({ id: 0, at: 0, end: 2.16, reel: null, text: "Yo mga boss" }).success).toBe(true);
  });

  it("accepts an entry grouping phrase ids", () => {
    expect(CaptionEntrySchema.safeParse({ ids: [1, 2], en: "from the studio, back again." }).success).toBe(true);
  });

  it("accepts a plate bottom on the canvas, so a line can move off the speaker's mouth", () => {
    expect(CaptionEntrySchema.safeParse({ ids: [1], en: "lower", bottom: 1750 }).success).toBe(true);
    expect(CaptionEntrySchema.safeParse({ ids: [1], en: "off the frame", bottom: 2000 }).success).toBe(false);
  });

  it("rejects an entry with no phrase ids", () => {
    expect(CaptionEntrySchema.safeParse({ ids: [], en: "orphan" }).success).toBe(false);
  });
});

describe("InsertSpecSchema", () => {
  it("accepts an insert that names its media by assetId", () => {
    const parsed = InsertSpecSchema.safeParse([{ at: 119.6, end: 133.85, srcAssetId: ASSET_ID, srcAt: 0.3, panel: "landscape" }]);

    expect(parsed.success).toBe(true);
  });

  it("rejects an insert with a src path", () => {
    const parsed = InsertSpecSchema.safeParse([{ at: 1, end: 2, src: "media/raw/a.mp4", srcAt: 0 }]);

    expect(parsed.success).toBe(false);
  });
});
