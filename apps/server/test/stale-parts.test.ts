// Created by The Angelo Umali.
// A crash mid-upload leaves its .part behind; the next start removes those and nothing else.
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { removeStaleParts } from "../src/media-io/store.ts";

let studioHome: string;
afterEach(async () => {
  await rm(studioHome, { recursive: true, force: true });
});

async function placeFile(path: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, "bytes");
}

describe("removeStaleParts", () => {
  it("removes .part files from incoming and every project's raw folder, and keeps stored media", async () => {
    studioHome = await mkdtemp(join(tmpdir(), "zks-stale-parts-"));
    const rawDir = join(studioHome, "projects", "trip", "media", "raw");
    await placeFile(join(studioHome, "incoming", "first-upload.part"));
    await placeFile(join(rawDir, "later-upload.part"));
    await placeFile(join(rawDir, "stored.mp4"));
    await mkdir(join(studioHome, "projects", "no-media-yet"), { recursive: true });

    await removeStaleParts(studioHome);

    expect(await readdir(join(studioHome, "incoming"))).toEqual([]);
    expect(await readdir(rawDir)).toEqual(["stored.mp4"]);
  });

  it("does nothing on a home that has never staged an upload", async () => {
    studioHome = await mkdtemp(join(tmpdir(), "zks-stale-parts-"));

    await expect(removeStaleParts(studioHome)).resolves.toBeUndefined();
  });
});
