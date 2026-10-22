// Created by The Angelo Umali.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { confineSearchInput } from "./confine.mjs";

const projectDir = fileURLToPath(new URL("./fixture/project", import.meta.url));
const fixtureDir = fileURLToPath(new URL("./fixture", import.meta.url));
const glob = (toolInput) => confineSearchInput(projectDir, projectDir, "Glob", toolInput);
const grep = (toolInput) => confineSearchInput(projectDir, projectDir, "Grep", toolInput);

describe("confineSearchInput", () => {
  it("allows a relative pattern inside the project", () => {
    assert.equal(glob({ pattern: "**/*.txt" }), undefined);
    assert.equal(glob({ pattern: "sub/*.{txt,md}", path: "sub" }), undefined);
    assert.equal(grep({ pattern: "ZKS_SPIKE_MARKER", glob: "*.txt" }), undefined);
  });

  it("denies a path outside the project, including a sibling prefix", () => {
    assert.match(glob({ pattern: "*", path: ".." }), /path/);
    assert.match(grep({ pattern: "ZKS", path: ".." }), /path/);
    assert.match(glob({ pattern: "*", path: `${projectDir}-evil` }), /path/);
  });

  it("denies a path that does not resolve", () => {
    assert.match(glob({ pattern: "*", path: "missing" }), /path/);
  });

  it("denies an absolute Glob pattern even when path is the project", () => {
    assert.match(glob({ pattern: `${fixtureDir}/outside/*.txt`, path: "." }), /pattern/);
  });

  it("denies '..' segments in Glob pattern and Grep glob", () => {
    assert.match(glob({ pattern: "../outside/*.txt" }), /pattern/);
    assert.match(glob({ pattern: "sub/../../outside/*" }), /pattern/);
    assert.match(grep({ pattern: "ZKS", glob: "../outside/*.txt" }), /glob/);
    assert.match(grep({ pattern: "ZKS", glob: "sub\\..\\..\\outside\\*" }), /glob/);
  });

  it("denies drive, UNC, device and home prefixes in pattern-bearing fields", () => {
    for (const escape of ["C:/Users/*", "c:\\Users\\*", "\\\\server\\share\\*", "//server/share/*", "\\\\?\\C:\\*", "~/secret/*"]) {
      assert.match(glob({ pattern: escape }), /pattern/, escape);
      assert.match(grep({ pattern: "x", glob: escape }), /glob/, escape);
    }
  });

  it("denies an absolute alternative hidden inside braces", () => {
    assert.match(glob({ pattern: "{sub,/etc}/*" }), /pattern/);
    assert.match(grep({ pattern: "x", glob: "{*.txt,../outside/*}" }), /glob/);
  });

  it("denies UNC and device paths without resolving them", () => {
    assert.match(glob({ pattern: "*", path: "\\\\server\\share" }), /path/);
    assert.match(glob({ pattern: "*", path: "//server/share" }), /path/);
    assert.match(glob({ pattern: "*", path: "\\\\?\\C:\\" }), /path/);
  });

  it("does not treat Grep's regex pattern as a path", () => {
    assert.equal(grep({ pattern: "^/etc/..*", glob: "*.txt" }), undefined);
  });
});
