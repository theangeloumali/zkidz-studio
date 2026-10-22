// Created by The Angelo Umali.
// ffprobe on ingest (plan §7.5): local files only, whitelisted demuxers, never a playlist, concat list or image sequence.
import { execFile } from "node:child_process";
import { open } from "node:fs/promises";
import { extname } from "node:path";
import { promisify } from "node:util";
import type { MediaAsset } from "@zks/shared";
import { z } from "zod";

export class MediaRejectedError extends Error {
  override readonly name = "MediaRejectedError";
}

/** Demuxer name → extensions a stored file may carry. Stills probe as *_pipe demuxers, so those join image2. */
const STORED_EXTENSIONS: Readonly<Record<string, readonly [string, ...string[]]>> = {
  "mov,mp4,m4a,3gp,3g2,mj2": ["mp4", "mov", "m4v", "m4a", "3gp", "3g2", "mj2"],
  "matroska,webm": ["mkv", "webm", "mka"],
  avi: ["avi"],
  mpegts: ["ts", "mts", "m2ts"],
  wav: ["wav"],
  mp3: ["mp3"],
  flac: ["flac"],
  aac: ["aac"],
  ogg: ["ogg", "oga", "opus"],
  image2: ["png", "jpg", "jpeg", "bmp", "tif", "tiff", "webp"],
  png_pipe: ["png"],
  jpeg_pipe: ["jpg", "jpeg"],
  webp_pipe: ["webp"],
};
const IMAGE_FORMATS: ReadonlySet<string> = new Set(["image2", "png_pipe", "jpeg_pipe", "webp_pipe"]);
const FORMAT_WHITELIST = Object.keys(STORED_EXTENSIONS).join(",");
const HDR_TRANSFERS: ReadonlySet<string> = new Set(["smpte2084", "arib-std-b67"]);
/** Text heads of HLS/DASH playlists, PLS and ffconcat lists: rejected before ffprobe ever sees them. */
const PLAYLIST_HEADS = ["#EXTM3U", "ffconcat", "[playlist]", "<?xml", "<MPD"];
const SNIFF_BYTES = 512;
const PROBE_TIMEOUT_MS = 30_000;
const PROBE_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const FULL_TURN_DEGREES = 360;

const runFile = promisify(execFile);

const ProbeStreamSchema = z.looseObject({
  codec_type: z.string().optional(),
  codec_name: z.string().optional(),
  width: z.int().optional(),
  height: z.int().optional(),
  r_frame_rate: z.string().optional(),
  avg_frame_rate: z.string().optional(),
  color_transfer: z.string().optional(),
  disposition: z.looseObject({ attached_pic: z.int().optional() }).optional(),
  side_data_list: z.array(z.looseObject({ rotation: z.number().optional() })).optional(),
  tags: z.looseObject({ rotate: z.string().optional() }).optional(),
});
const ProbeOutputSchema = z.looseObject({
  streams: z.array(ProbeStreamSchema).default([]),
  format: z.looseObject({ format_name: z.string(), duration: z.string().optional() }),
});
type ProbeStream = z.infer<typeof ProbeStreamSchema>;

export interface ProbeResult {
  readonly formatName: string;
  readonly kind: MediaAsset["kind"];
  readonly durationS: number | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly fps: MediaAsset["fps"];
  readonly rotation: number;
  readonly isHdr: boolean;
  readonly colorTransfer: string | null;
  readonly videoCodec: string | null;
  readonly audioCodec: string | null;
}

export async function probeMedia(ffprobePath: string, filePath: string): Promise<ProbeResult> {
  await rejectPlaylistText(filePath);
  const output = ProbeOutputSchema.safeParse(JSON.parse(await runFfprobe(ffprobePath, filePath)));
  if (!output.success) throw new MediaRejectedError("ffprobe returned an unexpected report");
  const { format, streams } = output.data;
  if (!(format.format_name in STORED_EXTENSIONS)) throw new MediaRejectedError(`Container "${format.format_name}" is not supported`);

  const isImage = IMAGE_FORMATS.has(format.format_name);
  const video = streams.find((stream) => stream.codec_type === "video" && stream.disposition?.attached_pic !== 1);
  const audio = streams.find((stream) => stream.codec_type === "audio");
  if (video === undefined && audio === undefined) throw new MediaRejectedError("The file has no audio or video stream");

  return {
    formatName: format.format_name,
    kind: isImage ? "image" : video === undefined ? "audio" : "camera",
    durationS: isImage ? null : positiveNumberOrNull(format.duration),
    width: video?.width && video.width > 0 ? video.width : null,
    height: video?.height && video.height > 0 ? video.height : null,
    fps: isImage || video === undefined ? null : (parseFrameRate(video.r_frame_rate) ?? parseFrameRate(video.avg_frame_rate)),
    rotation: video === undefined ? 0 : readRotation(video),
    isHdr: HDR_TRANSFERS.has(video?.color_transfer ?? ""),
    colorTransfer: video?.color_transfer ?? null,
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
  };
}

export function chooseStoredExtension(formatName: string, displayName: string): string {
  const allowedExtensions = STORED_EXTENSIONS[formatName];
  if (allowedExtensions === undefined) throw new MediaRejectedError(`Container "${formatName}" is not supported`);
  const originalExtension = extname(displayName).slice(1).toLowerCase();
  return allowedExtensions.includes(originalExtension) ? originalExtension : allowedExtensions[0];
}

async function rejectPlaylistText(filePath: string): Promise<void> {
  let head: string;
  try {
    const file = await open(filePath, "r");
    try {
      const { buffer, bytesRead } = await file.read({ buffer: Buffer.alloc(SNIFF_BYTES), position: 0 });
      head = buffer.subarray(0, bytesRead).toString("utf8").replace(/^\uFEFF/, "").trimStart();
    } finally {
      await file.close();
    }
  } catch {
    throw new MediaRejectedError("The file could not be read");
  }
  if (PLAYLIST_HEADS.some((playlistHead) => head.startsWith(playlistHead))) {
    throw new MediaRejectedError("Playlists and concat lists are not media files");
  }
}

async function runFfprobe(ffprobePath: string, filePath: string): Promise<string> {
  const args = ["-v", "error", "-protocol_whitelist", "file,pipe", "-format_whitelist", FORMAT_WHITELIST, "-pattern_type", "none"];
  args.push("-print_format", "json", "-show_format", "-show_streams", `file:${filePath}`);
  try {
    const { stdout } = await runFile(ffprobePath, args, { timeout: PROBE_TIMEOUT_MS, maxBuffer: PROBE_MAX_OUTPUT_BYTES });
    return stdout;
  } catch {
    throw new MediaRejectedError("ffprobe could not read the file as supported media");
  }
}

function positiveNumberOrNull(rawNumber: string | undefined): number | null {
  const parsedNumber = Number(rawNumber);
  return rawNumber !== undefined && Number.isFinite(parsedNumber) && parsedNumber >= 0 ? parsedNumber : null;
}

function parseFrameRate(rawRate: string | undefined): MediaAsset["fps"] {
  const match = /^(\d+)\/(\d+)$/.exec(rawRate ?? "");
  const num = Number(match?.[1]);
  const den = Number(match?.[2]);
  return num > 0 && den > 0 ? { num, den } : null;
}

function readRotation(video: ProbeStream): number {
  const rotation = video.side_data_list?.find((sideData) => sideData.rotation !== undefined)?.rotation ?? Number(video.tags?.rotate ?? 0);
  return Number.isFinite(rotation) ? ((Math.round(rotation) % FULL_TURN_DEGREES) + FULL_TURN_DEGREES) % FULL_TURN_DEGREES : 0;
}
