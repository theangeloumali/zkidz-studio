// Created by The Angelo Umali.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

describe("committed shell scripts", () => {
  // core.filemode is off on Windows-mounted checkouts, so a lost execute bit only shows up as "Permission denied" for users.
  it("are executable in the git index", () => {
    const indexLines = execFileSync("git", ["ls-files", "-s", "--", "*.sh"], { cwd: REPO_ROOT, encoding: "utf8" }).trim().split("\n");
    const notExecutable = indexLines.filter((line) => !line.startsWith("100755")).map((line) => line.split("\t")[1]);
    expect(notExecutable).toEqual([]);
  });
});
