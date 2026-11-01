// Created by The Angelo Umali.
// Reference assets for the slice D tests: a row of kind "reference", optionally over a real clip made by ffmpeg.
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { mediaAssets } from "@zks/db/schema";
import type { ToolFixture } from "./tool-fixtures.ts";

const runFile = promisify(execFile);

export interface ReferenceClip {
  readonly ffmpegArgs: readonly string[];
  readonly durationS: number;
  readonly audioCodec: string | null;
}

/** Two seconds of red then two of blue (one hard cut) under a sine tone. */
export const TWO_SHOTS_WITH_TONE: ReferenceClip = {
  ffmpegArgs: [
    ...["-f", "lavfi", "-i", "color=red:size=64x36:rate=30:d=2", "-f", "lavfi", "-i", "color=blue:size=64x36:rate=30:d=2"],
    ...["-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-filter_complex", "[0][1]concat=n=2:v=1:a=0[v]"],
    ...["-map", "[v]", "-map", "2:a", "-c:v", "mpeg4", "-c:a", "aac", "-shortest"],
  ],
  durationS: 4,
  audioCodec: "aac",
};

/** One silent green shot, shorter than the 3 s the contact sheet would like. */
export const SHORT_SILENT: ReferenceClip = {
  ffmpegArgs: ["-f", "lavfi", "-i", "color=green:size=64x36:rate=30:d=1.5", "-c:v", "mpeg4"],
  durationS: 1.5,
  audioCodec: null,
};

export async function insertReferenceAsset(fixture: ToolFixture, clip?: ReferenceClip) {
  const relPath = `media/raw/${crypto.randomUUID()}.mp4`;
  const filePath = join(fixture.projectRoot, relPath);
  await mkdir(dirname(filePath), { recursive: true });
  if (clip === undefined) await writeFile(filePath, "not really video");
  else await runFile("ffmpeg", ["-v", "error", "-y", ...clip.ffmpegArgs, filePath]);
  const [asset] = await fixture.context.db
    .insert(mediaAssets)
    .values({
      projectId: fixture.context.projectId,
      kind: "reference",
      name: "Reference Look.mp4",
      relPath,
      bytes: 16,
      mtimeMs: 0,
      durationS: clip?.durationS ?? 4,
      fpsNum: 30,
      fpsDen: 1,
      probe: { formatName: "mov,mp4,m4a,3gp,3g2,mj2", videoCodec: "mpeg4", audioCodec: clip?.audioCodec ?? null, rotation: 0, colorTransfer: null },
    })
    .returning();
  if (asset === undefined) throw new Error("reference asset insert returned no row");
  return asset;
}
