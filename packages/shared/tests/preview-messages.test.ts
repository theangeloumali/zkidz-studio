// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { PREVIEW_LOADED_MESSAGE, PREVIEW_SEEK_MESSAGE, PreviewLoadedMessageSchema, PreviewSeekMessageSchema } from "../src/index.ts";

describe("preview frame messages", () => {
  it("names the types the engine's player.js speaks", () => {
    expect(PREVIEW_SEEK_MESSAGE).toBe("zks.preview.seek");
    expect(PREVIEW_LOADED_MESSAGE).toBe("zks.preview.loaded");
  });

  it("accepts a seek to an edited time and rejects a negative or extra-keyed one", () => {
    expect(PreviewSeekMessageSchema.safeParse({ type: PREVIEW_SEEK_MESSAGE, time: 2.5 }).success).toBe(true);
    expect(PreviewSeekMessageSchema.safeParse({ type: PREVIEW_SEEK_MESSAGE, time: -1 }).success).toBe(false);
    expect(PreviewSeekMessageSchema.safeParse({ type: PREVIEW_SEEK_MESSAGE, time: 1, html: "<img>" }).success).toBe(false);
  });

  it("accepts the frame's loaded notice and rejects a look-alike", () => {
    expect(PreviewLoadedMessageSchema.safeParse({ type: PREVIEW_LOADED_MESSAGE, durationS: 30 }).success).toBe(true);
    expect(PreviewLoadedMessageSchema.safeParse({ type: "seek", durationS: 30 }).success).toBe(false);
  });
});
