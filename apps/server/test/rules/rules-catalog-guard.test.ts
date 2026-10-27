// Created by The Angelo Umali.
// Plan §6.9: a rule exists only because the user clicked; no MCP tool may create or edit one.
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { STUDIO_TOOLS } from "@zks/shared";
import { describe, expect, it } from "vitest";
import { studioTwinCatalog } from "../../src/tools/catalog.ts";

const SERVER_SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const RULE_WRITE = /\.(insert|update|delete)\(\s*rules\s*\)/;
const RULES_IMPORT = /from\s+["']([^"']*\/rules\/[^"']*)["']/g;
/** Read-only, so project_info shares the system prompt's query without reaching a writer. */
const RULE_READER = "rules/rule-reader.ts";

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".ts")).map((entry) => join(entry.parentPath, entry.name));
}

describe("no tool can create a rule", () => {
  it("has no rule-writing tool in the contract or the served catalog", () => {
    const toolNames = [...Object.keys(STUDIO_TOOLS), ...studioTwinCatalog().map((studioTool) => studioTool.name)];

    expect(toolNames.length).toBeGreaterThan(0);
    expect(toolNames.filter((toolName) => /rule/i.test(toolName))).toEqual([]);
  });

  it("writes the rules table only from the user's routes in src/rules", async () => {
    const writers: string[] = [];
    for (const file of await sourceFiles(SERVER_SRC)) {
      if (RULE_WRITE.test(await readFile(file, "utf8"))) writers.push(relative(SERVER_SRC, file).replaceAll("\\", "/"));
    }

    expect(writers).toEqual(["rules/rule-store.ts"]);
  });

  it("lets the tool handlers import only the read-only rule reader", async () => {
    const toolFiles = await sourceFiles(join(SERVER_SRC, "tools"));
    const forbiddenImports: string[] = [];
    for (const file of toolFiles) {
      for (const [, specifier = ""] of (await readFile(file, "utf8")).matchAll(RULES_IMPORT)) {
        const target = relative(SERVER_SRC, resolve(dirname(file), specifier)).replaceAll("\\", "/");
        if (target !== RULE_READER) forbiddenImports.push(`${relative(SERVER_SRC, file)} -> ${target}`);
      }
    }

    expect(toolFiles.length).toBeGreaterThan(0);
    expect(forbiddenImports).toEqual([]);
  });

  it("serves project_info's rules through the shared reader, not a second query", async () => {
    const projectTools = await readFile(join(SERVER_SRC, "tools/handlers/project-tools.ts"), "utf8");

    expect(projectTools).toContain("readEnabledRuleTexts(");
    expect(projectTools).not.toMatch(/from\(\s*rules\s*\)/);
  });
});
