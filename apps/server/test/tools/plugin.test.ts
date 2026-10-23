// Created by The Angelo Umali.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PLUGIN_DIR = fileURLToPath(new URL("../../../../plugin", import.meta.url));
const BUNDLED_SKILLS = ["cut-spec", "edit-director"];

describe("studio plugin", () => {
  it("declares no hooks and no MCP servers", async () => {
    const manifest: unknown = JSON.parse(await readFile(join(PLUGIN_DIR, ".claude-plugin", "plugin.json"), "utf8"));
    expect(manifest).toMatchObject({ name: "zkidz-studio" });
    expect(manifest).not.toHaveProperty("hooks");
    expect(manifest).not.toHaveProperty("mcpServers");
  });

  it("ships each skill with frontmatter on line 1 and the attribution right after it", async () => {
    expect((await readdir(join(PLUGIN_DIR, "skills"))).sort()).toEqual(BUNDLED_SKILLS);
    for (const skillName of BUNDLED_SKILLS) {
      const lines = (await readFile(join(PLUGIN_DIR, "skills", skillName, "SKILL.md"), "utf8")).split("\n");
      expect(lines[0]).toBe("---");
      expect(lines).toContain(`name: ${skillName}`);
      const closingIndex = lines.indexOf("---", 1);
      expect(lines.slice(closingIndex + 1).find((line) => line.trim() !== "")).toBe("<!-- Created by The Angelo Umali. -->");
    }
  });

  it("names only studio tools, never a file path or an Edit tool", async () => {
    for (const skillName of BUNDLED_SKILLS) {
      const skillText = await readFile(join(PLUGIN_DIR, "skills", skillName, "SKILL.md"), "utf8");
      expect(skillText).not.toMatch(/\/mnt\/|\/home\/|[A-Z]:\\/);
      expect(skillText).toMatch(/Hands to next:/);
    }
  });
});
