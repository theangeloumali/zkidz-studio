// Created by The Angelo Umali.
// Mirrors the engine's render.master_path and qc.latest_master, so the server names the files the engine really writes.
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { RENDER_PROFILES, STUDIO_TOOLS } from "@zks/shared";

type RenderQuality = "draft" | "final" | "4k";
type RenderProfile = (typeof RENDER_PROFILES)[number];
export type MasterResolution = "4k" | "1080" | "draft";

// latest_master's order: on an mtime tie the first one wins.
const MASTER_VARIANTS: readonly { readonly resolution: MasterResolution; readonly suffix: string }[] = [
  { resolution: "4k", suffix: "-4k" },
  { resolution: "1080", suffix: "" },
  { resolution: "draft", suffix: "-draft" },
];
// The engine's UHD_BACKEND: only NVENC renders a true 4K master; every other backend's "4k" is a 1080 master.
const UHD_PROFILE: RenderProfile = "nvidia";
const CAPABILITIES_FILE = "capabilities.json";

export interface MasterFile {
  readonly relPath: string;
  readonly resolution: MasterResolution;
}

function masterRelPath(videoId: string, resolution: MasterResolution): string {
  const variant = MASTER_VARIANTS.find((candidate) => candidate.resolution === resolution);
  return `work/out/${videoId}${variant?.suffix ?? ""}.mp4`;
}

/** A Reels render writes its own video id. */
export function renderedVideoId(videoId: string, target: "full" | "reel"): string {
  return target === "reel" ? `${videoId}r` : videoId;
}

const RENDER_ACTIONS: Readonly<Record<MasterResolution, string>> = {
  "4k": "Render the 4K master",
  "1080": "Render the 1080p master",
  draft: "Render the draft master",
};

/** Undefined for a 4K render before the hardware is probed: it may land at either resolution. */
function renderedResolution(quality: RenderQuality, profile: RenderProfile | undefined): MasterResolution | undefined {
  if (quality === "draft") return "draft";
  if (quality === "final") return "1080";
  if (profile === undefined) return undefined;
  return profile === UHD_PROFILE ? "4k" : "1080";
}

export function predictMasterPaths(videoId: string, quality: RenderQuality, profile: RenderProfile | undefined): string[] {
  const resolution = renderedResolution(quality, profile);
  if (resolution === undefined) return [masterRelPath(videoId, "4k"), masterRelPath(videoId, "1080")];
  return [masterRelPath(videoId, resolution)];
}

/** The approval card's action; an unprobed 4K render is labelled by what was asked for. */
export function describeRenderAction(quality: RenderQuality, profile: RenderProfile | undefined): string {
  return RENDER_ACTIONS[renderedResolution(quality, profile) ?? "4k"];
}

/** The master QC judges and export ships: the newest one on disk. */
export async function findLatestMaster(projectRoot: string, videoId: string): Promise<MasterFile | undefined> {
  let latest: { readonly master: MasterFile; readonly mtimeNs: bigint } | undefined;
  for (const { resolution } of MASTER_VARIANTS) {
    const relPath = masterRelPath(videoId, resolution);
    const stats = await stat(join(projectRoot, relPath), { bigint: true }).catch(() => undefined);
    if (stats !== undefined && (latest === undefined || stats.mtimeNs > latest.mtimeNs)) latest = { master: { relPath, resolution }, mtimeNs: stats.mtimeNs };
  }
  return latest?.master;
}

/** The probed render profile, or undefined while capabilities.json is absent or unreadable. */
export async function readRenderProfile(studioHome: string): Promise<RenderProfile | undefined> {
  const capabilitiesText = await readFile(join(studioHome, CAPABILITIES_FILE), "utf8").catch(() => undefined);
  if (capabilitiesText === undefined) return undefined;
  try {
    const capabilities = STUDIO_TOOLS.get_capabilities.output.safeParse(JSON.parse(capabilitiesText));
    return capabilities.success ? capabilities.data.profile : undefined;
  } catch {
    return undefined;
  }
}
