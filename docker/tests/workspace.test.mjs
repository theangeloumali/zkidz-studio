// Created by The Angelo Umali.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

describe("@zks/docker workspace package", () => {
  it("is a workspace member, so pnpm -r lint, typecheck and test cover these tests", () => {
    const workspace = readFileSync(join(REPO_ROOT, "pnpm-workspace.yaml"), "utf8");
    expect(workspace).toMatch(/^ {2}- docker$/m);
    const dockerPackage = JSON.parse(readFileSync(join(REPO_ROOT, "docker/package.json"), "utf8"));
    expect(dockerPackage).toMatchObject({ name: "@zks/docker", private: true });
    expect(Object.keys(dockerPackage.scripts)).toEqual(expect.arrayContaining(["lint", "typecheck", "test"]));
  });

  it("is not run a second time through another package's vitest root", () => {
    const rootPackage = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
    expect(rootPackage.scripts.verify).not.toContain("--root ../docker");
  });
});
