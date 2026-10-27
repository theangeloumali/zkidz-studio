// Created by The Angelo Umali.
// Tiny real media made by ffmpeg, so the probe tests exercise the real demuxers.
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const TEST_SOURCE = ["-f", "lavfi", "-i", "testsrc=size=64x36:rate=30000/1001", "-t", "0.5"];

export interface MediaFixtures {
  readonly dir: string;
  readonly clipMp4: string;
  readonly rotatedMp4: string;
  readonly hdrMkv: string;
  readonly stillPng: string;
  readonly playlistAsMp4: string;
  readonly concatAsMp4: string;
  readonly garbage: string;
}

export async function hasFfmpeg(): Promise<boolean> {
  try {
    await runFile("ffprobe", ["-version"]);
    await runFile("ffmpeg", ["-version"]);
    return true;
  } catch {
    return false;
  }
}

export async function makeMediaFixtures(): Promise<MediaFixtures> {
  const dir = await mkdtemp(join(tmpdir(), "zks-media-"));
  const fixtures: MediaFixtures = {
    dir,
    clipMp4: join(dir, "clip.mp4"),
    rotatedMp4: join(dir, "rotated.mp4"),
    hdrMkv: join(dir, "hdr.mkv"),
    stillPng: join(dir, "still.png"),
    playlistAsMp4: join(dir, "playlist.mp4"),
    concatAsMp4: join(dir, "concat.mp4"),
    garbage: join(dir, "garbage.mp4"),
  };
  const ffmpeg = (args: string[]) => runFile("ffmpeg", ["-v", "error", "-y", ...args]);
  await ffmpeg([...TEST_SOURCE, "-c:v", "mpeg4", fixtures.clipMp4]);
  await Promise.all([
    ffmpeg(["-display_rotation", "90", "-i", fixtures.clipMp4, "-c", "copy", fixtures.rotatedMp4]),
    ffmpeg([...TEST_SOURCE, "-vf", "setparams=color_trc=smpte2084:color_primaries=bt2020:colorspace=bt2020nc", "-c:v", "ffv1", fixtures.hdrMkv]),
    ffmpeg(["-f", "lavfi", "-i", "color=red:size=8x8", "-frames:v", "1", fixtures.stillPng]),
    writeFile(fixtures.playlistAsMp4, `#EXTM3U\n#EXTINF:1,\n${fixtures.clipMp4}\n`),
    writeFile(fixtures.concatAsMp4, `ffconcat version 1.0\nfile '${fixtures.clipMp4}'\n`),
    writeFile(fixtures.garbage, "not media at all"),
  ]);
  return fixtures;
}

const CHUNK_BYTES = 1024 * 1024;

/** A body with no Content-Length, like a non-browser client streaming chunked, so only the streaming cap can stop it. */
export function chunkedBody(bytes: Uint8Array): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.subarray(offset, offset + CHUNK_BYTES));
      offset += CHUNK_BYTES;
    },
  });
}
