// Created by The Angelo Umali.
// Agents with no plugin system get the edit skills as instructions, generated from plugin/skills (plan §6.9: no copies).
import { join } from "node:path";
import { listSkills, readSkillText } from "../../tools/handlers/skill-tools.ts";

const DIRECTOR_SKILL = "edit-director";

interface AgentInstructionsRequest {
  readonly rulesText: string;
  readonly pluginDir: string;
}

export async function buildAgentInstructions(request: AgentInstructionsRequest): Promise<string> {
  const skillsDir = join(request.pluginDir, "skills");
  const [directorBody, skills] = await Promise.all([readSkillText(skillsDir, { name: DIRECTOR_SKILL }), listSkills(skillsDir)]);
  const skillIndex = skills.filter((skill) => skill.name !== DIRECTOR_SKILL).map((skill) => `- ${skill.name}: ${skill.description}`);
  return [
    request.rulesText.trim(),
    directorBody.trim(),
    "## Other studio skills",
    "Call the studio's read_skill tool with a skill's name to read it in full before you use it.",
    skillIndex.join("\n"),
  ].join("\n\n");
}
