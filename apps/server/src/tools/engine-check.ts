// Created by The Angelo Umali.
// Short engine checks a tool waits on: the engine's own refusal reaches the agent as a tool error.
import { EngineReportedError } from "../jobs/engine-process.ts";
import type { ToolContext } from "./context.ts";
import { prepareWorkDir } from "./engine-jobs.ts";
import { loadProject, projectRootOf } from "./project-files.ts";
import { ToolError } from "./result.ts";

export async function runEngineCheck(runCheck: () => Promise<unknown>): Promise<unknown> {
  try {
    return await runCheck();
  } catch (error) {
    if (error instanceof EngineReportedError) throw new ToolError(error.reason);
    throw error;
  }
}

/** project: the caller's loaded project, so a tool call loads it once. */
export async function projectWorkDir(context: ToolContext, project?: Awaited<ReturnType<typeof loadProject>>): Promise<string> {
  return prepareWorkDir(projectRootOf(context, project ?? (await loadProject(context))), ".");
}
