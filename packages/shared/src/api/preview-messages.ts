// Created by The Angelo Umali.
// The postMessage contract between the Editor and the sandboxed preview frame (packages/engine/hf/preview/player.js).
import { z } from "zod";

export const PREVIEW_SEEK_MESSAGE = "zks.preview.seek";
export const PREVIEW_LOADED_MESSAGE = "zks.preview.loaded";

/** Editor → frame: show the overlay at this edited time, in seconds. */
export const PreviewSeekMessageSchema = z.strictObject({ type: z.literal(PREVIEW_SEEK_MESSAGE), time: z.number().nonnegative() });
export type PreviewSeekMessage = z.infer<typeof PreviewSeekMessageSchema>;

/** Frame → Editor: the page is ready for seeks; sent once per load. */
export const PreviewLoadedMessageSchema = z.object({ type: z.literal(PREVIEW_LOADED_MESSAGE), durationS: z.number().nonnegative() });
export type PreviewLoadedMessage = z.infer<typeof PreviewLoadedMessageSchema>;
