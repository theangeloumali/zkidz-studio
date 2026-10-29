// Created by The Angelo Umali.
// read_skill: the studio skills for agents with no plugin system; read-only and confined to plugin/skills.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readSkill } from "@zks/shared";
import { confinePath } from "../../security/confine-path.ts";
import { implementTool, type StudioTool } from "../define-tool.ts";
import { ToolError } from "../result.ts";

export const PLUGIN_SKILLS_DIR = fileURLToPath(new URL("../../../../../plugin/skills/", import.meta.url));

const SKILL_FILE = "SKILL.md";
const REFERENCES_DIR = "references";
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
// The file header comment is for the repo, not for the agent reading the skill.
const LEADING_COMMENT = /^\s*<!--[\s\S]*?-->\s*/;

interface SkillSummary {
  readonly name: string;
  readonly description: string;
}

interface SkillTextRequest {
  readonly name: string;
  readonly reference?: string | undefined;
}

export async function listSkills(skillsDir: string): Promise<readonly SkillSummary[]> {
  const entries = await readdir(skillsDir, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  return Promise.all(names.map(async (name) => ({ name, description: describeSkill(await readFile(join(skillsDir, name, SKILL_FILE), "utf8")) })));
}

/** The skill body without frontmatter, or one reference file verbatim. */
export async function readSkillText(skillsDir: string, request: SkillTextRequest): Promise<string> {
  // path.join folds "a/../b" away before confinePath sees it, so the names are checked against the contract first.
  if (!readSkill.input.safeParse(request).success) throw new ToolError(`There is no studio skill named ${request.name}.`);
  const relativePath = request.reference === undefined ? join(request.name, SKILL_FILE) : join(request.name, REFERENCES_DIR, request.reference);
  try {
    const text = await readFile(await confinePath(skillsDir, relativePath), "utf8");
    return request.reference === undefined ? text.replace(FRONTMATTER, "").replace(LEADING_COMMENT, "") : text;
  } catch {
    throw new ToolError(
      request.reference === undefined ? `There is no studio skill named ${request.name}.` : `${request.name} has no reference named ${request.reference}.`,
    );
  }
}

function describeSkill(skillText: string): string {
  const frontmatter = FRONTMATTER.exec(skillText)?.[1] ?? "";
  return /^description:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim() ?? "";
}

export const skillTools: readonly StudioTool[] = [
  implementTool("read_skill", {
    description: "Read a studio skill in full (or one of its reference files) before using it.",
    handler: async (input) => ({ output: { text: await readSkillText(PLUGIN_SKILLS_DIR, input) } }),
  }),
];
