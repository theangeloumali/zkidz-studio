// Created by The Angelo Umali.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SKILLS_DIR = fileURLToPath(new URL("../../plugin/skills", import.meta.url));
const ATTRIBUTION = "<!-- Created by The Angelo Umali. -->";
// The skills ship in a public plugin: no personal paths, infra, hostnames or names from the private edits they came from.
const PRIVATE_MARKERS = [/\/mnt\//, /\/home\//, /[A-Z]:\\/, /\bAngelo\b/i, /Tailscale/i, /\bNAS\b/, /Forgejo/i, /\bep\d+\b/i, /\bv\d+r?\.json\b/];

const skillNames = readdirSync(SKILLS_DIR).filter((entry) => statSync(join(SKILLS_DIR, entry)).isDirectory());

/** @param {string} skillName */
const readSkill = (skillName) => readFileSync(join(SKILLS_DIR, skillName, "SKILL.md"), "utf8");

/** @param {string} skillName */
function referenceFiles(skillName) {
  const referencesDir = join(SKILLS_DIR, skillName, "references");
  try {
    return readdirSync(referencesDir).map((fileName) => join(referencesDir, fileName));
  } catch {
    return [];
  }
}

describe("bundled skills", () => {
  it("include the Phase 6 style-rules skill", () => {
    expect(skillNames).toEqual(expect.arrayContaining(["cut-spec", "edit-director", "style-rules"]));
  });

  it.each(skillNames)("%s ends with a Hands to next line naming what it produces", (skillName) => {
    const lines = readSkill(skillName).trimEnd().split("\n");
    expect(lines.at(-1)).toMatch(/^Hands to next: .+→ .+/);
  });

  it.each(skillNames)("%s references are attributed and linked from SKILL.md", (skillName) => {
    const skillText = readSkill(skillName);
    for (const referencePath of referenceFiles(skillName)) {
      expect(readFileSync(referencePath, "utf8").split("\n")[0]).toBe(ATTRIBUTION);
      expect(skillText).toContain(`references/${referencePath.split(/[\\/]/).at(-1)}`);
    }
  });

  it.each(skillNames)("%s carries no private names, paths or infra", (skillName) => {
    const texts = [readSkill(skillName), ...referenceFiles(skillName).map((referencePath) => readFileSync(referencePath, "utf8"))];
    for (const text of texts) for (const marker of PRIVATE_MARKERS) expect(text.replaceAll(ATTRIBUTION, "")).not.toMatch(marker);
  });
});

describe("edit-director editorial method", () => {
  const directorText = readSkill("edit-director");

  it.each([
    ["the first-3-seconds gate", /first 3 seconds gate/i],
    ["the open-loop limit", /one main and one secondary open loop/i],
    ["three rough openings compared before polish", /three rough openings/i],
    ["a timestamped entertainment review", /entertainment review/i],
  ])("covers %s", (_label, pattern) => {
    expect(directorText).toMatch(pattern);
  });
});

describe("style-rules only asks for data the tools and prompt deliver", () => {
  const styleText = readSkill("style-rules");
  const THEME_DIR = fileURLToPath(new URL("../../themes/zkidz", import.meta.url));
  const tierTable = readFileSync(join(SKILLS_DIR, "style-rules", "references", "card-tiers.md"), "utf8");
  /** @type {{ components: { kind: string, tier: string }[] }} */
  const manifest = JSON.parse(readFileSync(join(THEME_DIR, "index.json"), "utf8"));
  /** @type {[string, string][]} */
  const kindTiers = manifest.components.map((component) => [component.kind, component.tier]);

  it("never says project_info returns the preset or list_cue_kinds returns a tier", () => {
    // project_info returns rules only; list_cue_kinds returns no tier (packages/shared tools contracts).
    expect(styleText).not.toMatch(/project_info[^.]*returns[^.]*(preset|both)/i);
    expect(styleText).not.toMatch(/whose tier/i);
    expect(styleText).toMatch(/list_cue_kinds[^.]*not its tier/);
    expect(styleText).toContain("references/card-tiers.md");
  });

  it.each(kindTiers)("card-tiers.md files %s under %s", (kind, tier) => {
    const section = tierTable.split(/^## /m).find((part) => part.startsWith(`\`${tier}\``)) ?? "";
    expect(section).toMatch(new RegExp(`^\\| \`${kind}\` +\\|`, "m"));
  });

  it("card-tiers.md lists no kind the manifest lacks", () => {
    const listedKinds = [...tierTable.matchAll(/^\| `(\w+)` +\|/gm)].map((match) => match[1]);
    expect(listedKinds.sort()).toEqual(manifest.components.map((component) => component.kind).sort());
  });

  it.each(readdirSync(join(THEME_DIR, "presets", "styles")))("the preset table matches %s", (fileName) => {
    const preset = JSON.parse(readFileSync(join(THEME_DIR, "presets", "styles", fileName), "utf8"));
    const row = styleText.split("\n").find((line) => line.startsWith(`| \`${preset.id}\``)) ?? "";
    const cardsCell = row.split("|")[2] ?? "";
    for (const tier of ["core", "accent", "special"]) expect(cardsCell.includes(tier), `${preset.id} ${tier}`).toBe(preset.cardTiers.includes(tier));
  });
});
