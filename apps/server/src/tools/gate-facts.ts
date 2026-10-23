// Created by The Angelo Umali.
// Facts for a gated studio tool's approval card, derived by the server from the validated input and the project rows.
import type { ApprovalFacts } from "@zks/shared";
import { describeGateCall } from "../agent/gate-facts.ts";
import { describeJobOutputFacts } from "../jobs/approval-facts.ts";
import type { ToolContext } from "./context.ts";
import { assetFilePath, findProjectAsset, loadProject, projectRootOf } from "./project-files.ts";

/** Null when the input fails the tool's contract; throws ToolError when it names something outside the project. */
export async function describeStudioGate(context: ToolContext, toolName: string, input: unknown): Promise<ApprovalFacts | null> {
  const facts = describeGateCall(toolName, input);
  if (facts === null) return null;
  const jobFacts = await describeJobOutputFacts(context, toolName, input);
  if (jobFacts !== null) return { ...facts, ...jobFacts };
  if (toolName !== "delete_asset" || facts.target === undefined) return facts;
  const [project, asset] = await Promise.all([loadProject(context), findProjectAsset(context, facts.target)]);
  return { ...facts, filesToDelete: [assetFilePath(projectRootOf(context, project), asset)] };
}
