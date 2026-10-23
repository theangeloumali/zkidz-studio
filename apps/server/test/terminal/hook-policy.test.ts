// Created by The Angelo Umali.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decideTerminalTool, type TerminalToolScope } from "../../src/terminal/hook-policy.ts";

let scratchDir: string;
let scope: TerminalToolScope;

beforeAll(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), "zks-policy-"));
  const projectDir = join(scratchDir, "project");
  const pluginDir = join(scratchDir, "plugin");
  await Promise.all([mkdir(projectDir), mkdir(pluginDir)]);
  await Promise.all([
    writeFile(join(projectDir, "cuts.json"), "{}"),
    writeFile(join(pluginDir, "SKILL.md"), "skill"),
    writeFile(join(scratchDir, "secret.txt"), "outside"),
  ]);
  scope = { projectDir, pluginDir, studioToolNames: ["mcp__studio__render_preview"] };
});

afterAll(async () => {
  await rm(scratchDir, { recursive: true, force: true });
});

describe("decideTerminalTool", () => {
  it("denies Bash and every other tool outside the studio allowlist, with a reason", async () => {
    for (const toolName of ["Bash", "Write", "Edit", "WebFetch", "mcp__other__tool", "mcp__studio__not_in_catalog"]) {
      const decision = await decideTerminalTool(toolName, {}, scope);
      expect(decision).toMatchObject({ isAllowed: false });
      expect(decision.isAllowed ? "" : decision.reason).toContain(toolName);
    }
  });

  it("allows catalog tools, Skill and AskUserQuestion", async () => {
    for (const toolName of ["mcp__studio__render_preview", "Skill", "AskUserQuestion"]) {
      expect(await decideTerminalTool(toolName, {}, scope)).toEqual({ isAllowed: true });
    }
  });

  it("allows Read inside the project or plugin folder", async () => {
    expect(await decideTerminalTool("Read", { file_path: join(scope.projectDir, "cuts.json") }, scope)).toEqual({ isAllowed: true });
    expect(await decideTerminalTool("Read", { file_path: join(scope.pluginDir, "SKILL.md") }, scope)).toEqual({ isAllowed: true });
  });

  it("denies Read outside both folders, through a traversal, or without a path", async () => {
    const outsideReads = [{ file_path: join(scratchDir, "secret.txt") }, { file_path: join(scope.projectDir, "..", "secret.txt") }, {}, "not an object"];
    for (const toolInput of outsideReads) {
      expect(await decideTerminalTool("Read", toolInput, scope)).toMatchObject({ isAllowed: false });
    }
  });
});
