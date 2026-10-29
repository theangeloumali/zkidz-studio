// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { listSkills, PLUGIN_SKILLS_DIR, readSkillText } from "../../../src/tools/handlers/skill-tools.ts";
import { ToolError } from "../../../src/tools/result.ts";

describe("studio skills", () => {
  it("lists every plugin skill with its one-line description", async () => {
    const skills = await listSkills(PLUGIN_SKILLS_DIR);
    expect(skills.map((skill) => skill.name)).toEqual(["captions", "covers", "cues", "cut-spec", "edit-director", "qc-gates", "reels", "style-rules"]);
    expect(skills.every((skill) => skill.description.length > 0 && !skill.description.includes("\n"))).toBe(true);
  });

  it("reads a skill body without its frontmatter, and one of its references", async () => {
    const body = await readSkillText(PLUGIN_SKILLS_DIR, { name: "edit-director" });
    expect(body.startsWith("---")).toBe(false);
    expect(body.length).toBeGreaterThan(100);
    expect(await readSkillText(PLUGIN_SKILLS_DIR, { name: "style-rules", reference: "card-tiers.md" })).not.toBe("");
  });

  it("answers an unknown skill or reference with a tool error", async () => {
    await expect(readSkillText(PLUGIN_SKILLS_DIR, { name: "no-such-skill" })).rejects.toThrow(ToolError);
    await expect(readSkillText(PLUGIN_SKILLS_DIR, { name: "captions", reference: "missing.md" })).rejects.toThrow(ToolError);
  });

  it("never reads outside the skills folder", async () => {
    await expect(readSkillText(PLUGIN_SKILLS_DIR, { name: ".." })).rejects.toThrow(ToolError);
    await expect(readSkillText(PLUGIN_SKILLS_DIR, { name: "captions", reference: "../../edit-director/SKILL.md" })).rejects.toThrow(ToolError);
  });
});
