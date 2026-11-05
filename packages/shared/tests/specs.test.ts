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

describe("CutSpecSchema v2 fields", () => {
  const v2Fields = {
    zooms: [{ at: 4, end: 6, preset: "lean" }],
    focus: [{ at: 10, end: 12, amount: 16 }],
    grade: "learning",
    reframes: [{ at: 0, end: 30, cx: 0.42 }],
    music: {
      bpm: 96,
      sections: [
        { at: 0, kind: "cold", energy: 0.4 },
        { at: 20, kind: "chapter" },
      ],
    },
  };

  it("accepts the lean zoom, rack focus, the learning grade, reframes and a music bed", () => {
    expect(CutSpecSchema.safeParse({ ...validCutSpec, ...v2Fields }).error?.issues ?? []).toEqual([]);
  });

  it("refuses an unknown grade, a reframe centre off the band and a bed that does not start at 0", () => {
    expect(CutSpecSchema.safeParse({ ...validCutSpec, grade: "teal" }).success).toBe(false);
    expect(CutSpecSchema.safeParse({ ...validCutSpec, reframes: [{ at: 0, end: 3, cx: 1.4 }] }).success).toBe(false);
    expect(CutSpecSchema.safeParse({ ...validCutSpec, music: { sections: [{ at: 5, kind: "intro" }] } }).success).toBe(false);
  });

  // #44 #45: the camera follows whoever speaks; the creator says whether other faces are blurred.
  it("takes follow: speaker and the blur answer, and nothing else for either", () => {
    expect(CutSpecSchema.safeParse({ ...validCutSpec, follow: "speaker", blurFaces: "others" }).success).toBe(true);
    expect(CutSpecSchema.safeParse({ ...validCutSpec, blurFaces: "none" }).success).toBe(true);
    expect(CutSpecSchema.safeParse({ ...validCutSpec, follow: "face" }).success).toBe(false);
    expect(CutSpecSchema.safeParse({ ...validCutSpec, blurFaces: "all" }).success).toBe(false);
  });

  // Rule 8 (map every place): footage without GPS declares the places it visits.
  it("takes declared places with a real longitude and latitude", () => {
    expect(CutSpecSchema.safeParse({ ...validCutSpec, places: [{ name: "Makati", lon: 121.03, lat: 14.55 }] }).success).toBe(true);
    expect(CutSpecSchema.safeParse({ ...validCutSpec, places: [{ name: "Nowhere", lon: 121, lat: 95 }] }).success).toBe(false);
  });

  // films d176181: the bed's level under his speech and its duck while he talks live in the spec (dB).
  it("takes the bed's level under speech and its duck, within sane bounds", () => {
    const sections = [{ at: 0, kind: "cold" }];
    expect(CutSpecSchema.safeParse({ ...validCutSpec, music: { sections, under: 26, duck: 6 } }).success).toBe(true);
    expect(CutSpecSchema.safeParse({ ...validCutSpec, music: { sections, under: 2 } }).success).toBe(false);
    expect(CutSpecSchema.safeParse({ ...validCutSpec, music: { sections, duck: 30 } }).success).toBe(false);
  });
});

describe("captions", () => {
  it("accepts keyword pills and a size step on an entry, and refuses a step outside 0.6-2.0", () => {
    expect(CaptionEntrySchema.safeParse({ ids: [1], en: "save before you spend", pills: ["save"], scale: 1.4 }).success).toBe(true);
    expect(CaptionEntrySchema.safeParse({ ids: [1], en: "too big", scale: 2.5 }).success).toBe(false);
  });

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
