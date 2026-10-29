// Created by The Angelo Umali.
// set_project_style (slice D): the agent's write of the look the Style panel also edits.
import { writeProjectStyle } from "../../projects/project-style.ts";
import { implementTool } from "../define-tool.ts";
import { loadProject } from "../project-files.ts";

const setProjectStyle = implementTool("set_project_style", {
  description:
    "Set the project's style over its theme: theme, colour tokens, bundled faces per role, boil, captions, sfx and pace. Tokens the theme lacks are dropped with a warning.",
  handler: async (input, context) => {
    const project = await loadProject(context);
    const written = await writeProjectStyle({ database: context.db, studioHome: context.studioHome }, project, input.style);
    // The input is never null, so neither is what is written back.
    return { output: { style: written.style ?? input.style, warnings: written.warnings } };
  },
});

export const styleTools = [setProjectStyle];
