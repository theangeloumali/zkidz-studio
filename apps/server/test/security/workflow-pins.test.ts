// Created by The Angelo Umali.
// Threat: supply chain through GitHub Actions (plan §11). A tag can be moved to new code; a commit SHA cannot. The
// workflow_dispatch-only rule is enforced by scripts/tests/workflow-triggers.test.mjs.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WORKFLOWS_DIR = fileURLToPath(new URL("../../../../.github/workflows/", import.meta.url));
const WORKFLOWS = readdirSync(WORKFLOWS_DIR).filter((name) => name.endsWith(".yml"));
const PINNED_ACTION = /^[\w.-]+\/[\w.-]+(?:\/[\w./-]+)?@[0-9a-f]{40} # v\d+\.\d+\.\d+$/;

const read = (name: string) => readFileSync(join(WORKFLOWS_DIR, name), "utf8");
const usesOf = (workflow: string) => [...workflow.matchAll(/^\s*(?:- )?uses:\s*(.+)$/gm)].map((match) => match[1]?.trim() ?? "");

describe("GitHub workflows", () => {
  it("include the CodeQL and dependency review workflows", () => {
    expect(WORKFLOWS).toEqual(expect.arrayContaining(["codeql.yml", "dependency-review.yml"]));
  });

  it.each(WORKFLOWS)("%s pins every action to a full commit SHA with its tag beside it", (name) => {
    const uses = usesOf(read(name));
    // A local action (./path) is reviewed with the repo, so only remote ones need a pin.
    for (const action of uses.filter((use) => !use.startsWith("./"))) expect(action).toMatch(PINNED_ACTION);
  });

  it.each(WORKFLOWS)("%s declares its token permissions instead of taking the repository default", (name) => {
    const workflow = read(name);
    expect(workflow).toMatch(/^permissions:/m);
    expect(workflow).not.toMatch(/write-all|pull_request_target/);
  });

  it.each([
    ["codeql.yml", ["security-events"]],
    ["dependency-review.yml", []],
  ])("%s reads the repository and writes only %j", (name, expectedWrites) => {
    const workflow = read(name);
    expect(workflow).toMatch(/^permissions:\n {2}contents: read\n/m);
    expect([...workflow.matchAll(/^\s+([\w-]+): write$/gm)].map((match) => match[1])).toEqual(expectedWrites);
  });
});
