// Created by The Angelo Umali.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Paths git ignores, checked case-sensitively the way Linux CI clones see them. */
function ignoredPaths(/** @type {string[]} */ candidatePaths) {
  try {
    const output = execFileSync("git", ["-c", "core.ignorecase=false", "check-ignore", "--no-index", "--stdin"], {
      cwd: REPO_ROOT,
      input: candidatePaths.join("\n"),
      encoding: "utf8",
    });
    return output.split("\n").filter(Boolean);
  } catch (error) {
    // Exit 1 means nothing matched.
    if (/** @type {{ status?: number }} */ (error).status === 1) return [];
    throw error;
  }
}

const CAMERA_AND_AUDIO_FILES = [
  "clip.mp4",
  "clip.MP4",
  "clip.mov",
  "clip.MOV",
  "clip.mkv",
  "clip.MKV",
  "take.wav",
  "take.WAV",
  "clip.MTS",
  "clip.m2ts",
  "clip.M2TS",
  "pano.insv",
  "pano.INSV",
  "pano.insp",
  "proxy.LRV",
  "proxy.lrv",
  "screen.webm",
  "screen.WEBM",
  "old.AVI",
  "voice.m4a",
  "voice.M4A",
  "song.mp3",
  "song.MP3",
  "voice.AAC",
  "master.flac",
  "photo.HEIC",
  "photo.heic",
];

describe(".gitignore media rules", () => {
  it("ignores camera, phone and audio files in any letter case", () => {
    expect(ignoredPaths(CAMERA_AND_AUDIO_FILES).sort()).toEqual([...CAMERA_AND_AUDIO_FILES].sort());
  });

  it("ignores everything under media/ and raw/, images included", () => {
    const mediaPaths = ["media/photo.jpg", "media/still.PNG", "raw/IMG_0001.JPG", "packages/x/media/a.jpeg"];
    expect(ignoredPaths(mediaPaths).sort()).toEqual([...mediaPaths].sort());
  });

  it("tracks only the launch film among site media", () => {
    expect(ignoredPaths(["site/assets/zkidz-studio-launch.mp4"])).toEqual([]);
    expect(ignoredPaths(["site/assets/other.mp4"])).toEqual(["site/assets/other.mp4"]);
  });

  it("keeps design images tracked", () => {
    expect(ignoredPaths(["design/mockup/screens/home.png", "design/logo.jpg"])).toEqual([]);
  });
});
