// Created by The Angelo Umali.
import { readFileSync } from "node:fs";
import { z } from "zod";
import { PLATFORM_KEYS } from "./platform.ts";

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const downloadSchema = z.object({
  url: z.url({ protocol: /^https$/ }),
  sha256: sha256Schema,
  size: z.number().int().positive(),
  executable: z.string().optional(),
});
const systemPackageSchema = z.object({ homebrew: z.string(), executable: z.string().optional() });
const platformEntrySchema = z.union([downloadSchema, systemPackageSchema]);
const toolSchema = z.object({
  version: z.string(),
  license: z.string(),
  platforms: z.partialRecord(z.enum(PLATFORM_KEYS), platformEntrySchema),
});
const modelSchema = downloadSchema.extend({ file: z.string().regex(/^[\w.-]+\.bin$/), license: z.string(), fetchOnSetup: z.boolean() });

const toolsLockSchema = z.object({
  schemaVersion: z.literal(1),
  tools: z.object({ ffmpeg: toolSchema, "whisper-cpp": toolSchema, "chrome-headless-shell": toolSchema }),
  models: z.record(z.string(), modelSchema),
});

export type PinnedDownload = z.infer<typeof downloadSchema>;
export type PlatformEntry = z.infer<typeof platformEntrySchema>;
export type ModelPin = z.infer<typeof modelSchema>;
export type ToolsLock = z.infer<typeof toolsLockSchema>;
export type ToolName = keyof ToolsLock["tools"];

export const TOOLS_LOCK_PATH = new URL("../../../tools.lock.json", import.meta.url);

export function isDownload(entry: PlatformEntry): entry is PinnedDownload {
  return "url" in entry;
}

export function parseToolsLock(raw: unknown): ToolsLock {
  return toolsLockSchema.parse(raw);
}

export function loadToolsLock(): ToolsLock {
  return parseToolsLock(JSON.parse(readFileSync(TOOLS_LOCK_PATH, "utf8")));
}
