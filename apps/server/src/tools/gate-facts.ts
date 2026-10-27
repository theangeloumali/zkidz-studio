// Created by The Angelo Umali.
// A gated tool's approval card facts, derived by the server from the input and project rows, so an agent note cannot misdescribe them.
import { STUDIO_TOOLS, type ApprovalFacts } from "@zks/shared";
import { describeJobOutputFacts } from "../jobs/approval-facts.ts";
import { describeRenderAction } from "../jobs/master-files.ts";
import type { ToolContext } from "./context.ts";
import { findProjectAsset, loadProject, projectRootOf, uploadedFilePath } from "./project-files.ts";

/** Null when the input fails the tool's contract; throws ToolError when it names something outside the project. A resumed
 * job passes the spec snapshot it started with, so its card is costed from those specs. */
export async function describeStudioGate(context: ToolContext, toolName: string, input: unknown, specSnapshotSha256?: string): Promise<ApprovalFacts | null> {
  const facts = describeGateCall(toolName, input);
  if (facts === null) return null;
  const jobFacts = await describeJobOutputFacts(context, toolName, input, specSnapshotSha256);
  if (jobFacts !== null) return { ...facts, ...jobFacts };
  if (toolName !== "delete_asset" || facts.target === undefined) return facts;
  const [project, asset] = await Promise.all([loadProject(context), findProjectAsset(context, facts.target)]);
  // An in-place original stays on disk, so the card lists only the studio's own upload copy.
  const uploaded = uploadedFilePath(projectRootOf(context, project), asset);
  return { ...facts, filesToDelete: uploaded === undefined ? [] : [uploaded] };
}

type FactFields = Omit<ApprovalFacts, "action" | "outputPaths" | "filesToDelete">;

/** The facts the input alone states; null when it does not match the tool's contract. */
export function describeGateCall(tool: string, input: unknown): ApprovalFacts | null {
  switch (tool) {
    case "render_master": {
      const parsed = STUDIO_TOOLS.render_master.input.safeParse(input);
      if (!parsed.success) return null;
      return facts(describeRenderAction(parsed.data.quality, undefined), { target: parsed.data.target, quality: parsed.data.quality });
    }
    case "export_deliverable": {
      const parsed = STUDIO_TOOLS.export_deliverable.input.safeParse(input);
      return parsed.success ? facts("Export deliverables", { target: parsed.data.kinds.join(", ") }) : null;
    }
    case "delete_asset": {
      const parsed = STUDIO_TOOLS.delete_asset.input.safeParse(input);
      return parsed.success ? facts("Delete a media asset", { target: parsed.data.assetId }) : null;
    }
    default:
      return null;
  }
}

function facts(action: string, fields: FactFields): ApprovalFacts {
  return { action, ...fields, outputPaths: [], filesToDelete: [] };
}
