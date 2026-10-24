// Created by The Angelo Umali.
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { replaceSpecFile } from "../../src/specs/spec-files.ts";

const ADDRESS = { videoId: "v1", kind: "cuts" } as const;

async function projectWithSpecFile(text: string): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "zks-spec-files-"));
  await replaceSpecFile(projectRoot, ADDRESS, { previousVersion: 0, version: 1, specText: text }, () => Promise.resolve(1));
  return projectRoot;
}

describe("replacing a spec file", () => {
  it("keeps the file when a newer version landed before the rename, and leaves no part file", async () => {
    const projectRoot = await projectWithSpecFile("version 1\n");

    const replaced = await replaceSpecFile(projectRoot, ADDRESS, { previousVersion: 1, version: 2, specText: "version 2\n" }, () => Promise.resolve(3));

    expect(replaced).toBe(false);
    expect(await readFile(join(projectRoot, "work/cuts/v1.json"), "utf8")).toBe("version 1\n");
    expect(await readdir(join(projectRoot, "work/cuts"))).toEqual(["v1.json"]);
  });

  it("snapshots the file it replaces, then writes the new version", async () => {
    const projectRoot = await projectWithSpecFile("version 1\n");

    const replaced = await replaceSpecFile(projectRoot, ADDRESS, { previousVersion: 1, version: 2, specText: "version 2\n" }, () => Promise.resolve(2));

    expect(replaced).toBe(true);
    expect(await readFile(join(projectRoot, "work/cuts/v1.json"), "utf8")).toBe("version 2\n");
    expect(await readFile(join(projectRoot, "work/versions/cuts/v1.v1.json"), "utf8")).toBe("version 1\n");
  });

  it("writes a first version when no file exists yet", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "zks-spec-files-"));
    await writeFile(join(projectRoot, "marker"), "");

    expect(await replaceSpecFile(projectRoot, ADDRESS, { previousVersion: 0, version: 1, specText: "version 1\n" }, () => Promise.resolve(1))).toBe(true);
    expect(await readFile(join(projectRoot, "work/cuts/v1.json"), "utf8")).toBe("version 1\n");
  });
});
