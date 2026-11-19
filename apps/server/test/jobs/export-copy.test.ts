// Created by The Angelo Umali.
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyToExportDir } from "../../src/jobs/export-copy.ts";

// Lets a test act between the folder check and the write, and between the copy and the rename.
const race = vi.hoisted(() => ({ beforeOpen: async () => {}, afterRead: async () => {} }));
vi.mock("../../src/security/confine-path.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/security/confine-path.ts")>();
  return {
    ...original,
    openConfined: async (rootDir: string, candidatePath: string) => {
      await race.beforeOpen();
      const confined = await original.openConfined(rootDir, candidatePath);
      const readStream = confined.handle.createReadStream.bind(confined.handle);
      confined.handle.createReadStream = (options) => readStream(options).on("end", () => void race.afterRead());
      return confined;
    },
  };
});

const SLUG = "beach-day";
const NAME = "beach-day-4k.mp4";
const BYTES = "full master bytes";
const sha256Of = (content: string) => createHash("sha256").update(content).digest("hex");

let scratchDir = "";
let projectRoot = "";
let exportDir = "";
beforeEach(async () => {
  scratchDir = await realpath(await mkdtemp(join(tmpdir(), "zks-export-copy-")));
  projectRoot = join(scratchDir, "project");
  exportDir = join(scratchDir, "export");
  await mkdir(join(projectRoot, "deliverables"), { recursive: true });
  await mkdir(exportDir);
  await writeFile(join(projectRoot, "deliverables", NAME), BYTES);
});
afterEach(async () => {
  race.beforeOpen = async () => {};
  race.afterRead = async () => {};
  await rm(scratchDir, { recursive: true, force: true });
});

const copy = (overrides: { sha256?: string; signal?: AbortSignal; slug?: string } = {}) =>
  copyToExportDir({
    exportDir,
    projectRoot,
    slug: overrides.slug ?? SLUG,
    deliverables: [{ path: `deliverables/${NAME}`, sha256: overrides.sha256 ?? sha256Of(BYTES) }],
    ...(overrides.signal === undefined ? {} : { signal: overrides.signal }),
  });

describe("copyToExportDir", () => {
  it("copies a verified deliverable into <dir>/<slug>/ with no temp file left", async () => {
    await copy();
    expect(await readdir(join(exportDir, SLUG))).toEqual([NAME]);
    expect(await readFile(join(exportDir, SLUG, NAME), "utf8")).toBe(BYTES);
  });

  it.each(["..", ".", ""])("refuses the slug %j before any path work, writing nothing outside the export folder", async (slug) => {
    await expect(copy({ slug })).rejects.toThrow(/not a valid folder name/);
    expect((await readdir(scratchDir)).toSorted()).toEqual(["export", "project"]);
    expect(await readdir(exportDir)).toEqual([]);
  });

  it.skipIf(process.platform === "win32")("refuses a source swapped for a symlink to a file outside the project", async () => {
    const outside = join(scratchDir, "secret.txt");
    await writeFile(outside, "not a deliverable");
    await rm(join(projectRoot, "deliverables", NAME));
    await symlink(outside, join(projectRoot, "deliverables", NAME));

    await expect(copy({ sha256: sha256Of("not a deliverable") })).rejects.toThrow(/Path rejected/);
    expect(await readdir(join(exportDir, SLUG))).toEqual([]);
  });

  it.skipIf(process.platform === "win32")("refuses a slug folder that is a symlink planted in the shared export folder", async () => {
    const elsewhere = join(scratchDir, "elsewhere");
    await mkdir(elsewhere);
    await symlink(elsewhere, join(exportDir, SLUG), "dir");

    await expect(copy()).rejects.toThrow(/symlink|not a folder/);
    expect(await readdir(elsewhere)).toEqual([]);
  });

  it("refuses bytes that differ from the deliverable QC passed, leaving no file", async () => {
    await expect(copy({ sha256: sha256Of("the bytes QC passed") })).rejects.toThrow(/SHA-256/);
    expect(await readdir(join(exportDir, SLUG))).toEqual([]);
  });

  it("stops before the rename when the job is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(copy({ signal: controller.signal })).rejects.toThrow();
    expect(await readdir(join(exportDir, SLUG))).toEqual([]);
  });

  it.skipIf(process.platform === "win32")("refuses a slug folder swapped for a symlink after the check, before the write", async () => {
    const elsewhere = await swapTarget();
    race.beforeOpen = () => swapSlugDirFor(elsewhere);

    await expect(copy()).rejects.toThrow(/changed during the copy/);
    expect(await readdir(elsewhere)).toEqual([]);
  });

  it.skipIf(process.platform === "win32")("refuses a slug folder swapped for a symlink after the copy, before the rename", async () => {
    const elsewhere = await swapTarget();
    let swapped: Promise<void> = Promise.resolve();
    race.afterRead = () => (swapped = swapSlugDirFor(elsewhere));

    await expect(copy()).rejects.toThrow(/changed during the copy/);
    await swapped;
    expect(await readdir(elsewhere)).toEqual([]);
  });

  it.skipIf(process.platform === "win32")("never renames over a symlink at the target name", async () => {
    const outside = join(scratchDir, "outside.mp4");
    await writeFile(outside, "keep me");
    await mkdir(join(exportDir, SLUG));
    await symlink(outside, join(exportDir, SLUG, NAME));

    await expect(copy()).rejects.toThrow(/symlink/);
    expect(await readFile(outside, "utf8")).toBe("keep me");
    expect(await readdir(join(exportDir, SLUG))).toEqual([NAME]);
  });
});

async function swapTarget(): Promise<string> {
  const elsewhere = join(scratchDir, "elsewhere");
  await mkdir(elsewhere);
  return elsewhere;
}

async function swapSlugDirFor(elsewhere: string): Promise<void> {
  await rename(join(exportDir, SLUG), join(exportDir, `${SLUG}-moved`));
  await symlink(elsewhere, join(exportDir, SLUG), "dir");
}
