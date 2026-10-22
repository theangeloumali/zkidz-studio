// Created by The Angelo Umali.
// tools.lock.json and where each pinned tool lands under ZKS_HOME/tools; `zks setup` installs there and the server runs from there.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

export const PLATFORM_KEYS = ["linux-x64", "linux-arm64", "win-x64", "win-arm64", "mac-arm64"] as const;
export type PlatformKey = (typeof PLATFORM_KEYS)[number];

const OS_PREFIX: Partial<Record<NodeJS.Platform, string>> = { linux: "linux", win32: "win", darwin: "mac" };
const SHORT_HASH_LENGTH = 12;

export function platformKey(nodePlatform: NodeJS.Platform = process.platform, arch: string = process.arch): PlatformKey {
  const candidate = `${OS_PREFIX[nodePlatform] ?? nodePlatform}-${arch}`;
  const supported = PLATFORM_KEYS.find((key) => key === candidate);
  if (!supported) throw new Error(`Unsupported platform ${candidate}; supported: ${PLATFORM_KEYS.join(", ")}`);
  return supported;
}

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

export interface PinnedToolsContext {
  toolsDir: string;
  platform: PlatformKey;
  lock: ToolsLock;
}

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

export function pinnedEntry({ lock, platform }: PinnedToolsContext, name: ToolName): PlatformEntry {
  const entry = lock.tools[name].platforms[platform];
  if (!entry) throw new Error(`${name} has no pinned build for ${platform}`);
  return entry;
}

/** Hash-named so a new pin never reuses an old extract. */
export function pinnedInstallDir(toolsDir: string, name: ToolName, entry: PinnedDownload): string {
  return path.join(toolsDir, name, entry.sha256.slice(0, SHORT_HASH_LENGTH));
}

export function findOnPath(name: string, extraDirs: string[] = []): string | undefined {
  const isWindows = process.platform === "win32";
  const extensions = isWindows ? (process.env.PATHEXT ?? ".EXE;.CMD").split(";").concat("") : [""];
  const searchDirs = [...extraDirs, ...(process.env.PATH ?? "").split(path.delimiter).filter(Boolean)];
  for (const dir of searchDirs) {
    for (const extension of extensions) {
      const candidate = path.join(dir, name + extension.toLowerCase());
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

/** Where a pinned download's executable is (or will be once installed); a Homebrew-only pin resolves on PATH. */
export function pinnedExecutablePath(context: PinnedToolsContext, name: ToolName): string | undefined {
  const entry = pinnedEntry(context, name);
  if (!isDownload(entry)) return findOnPath(entry.executable ?? entry.homebrew);
  return path.join(pinnedInstallDir(context.toolsDir, name, entry), entry.executable ?? name);
}
