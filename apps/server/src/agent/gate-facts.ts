// Created by The Angelo Umali.
// Server-derived approval facts: the card shows these above any agent note, so an injected note cannot misdescribe the action.
import { STUDIO_TOOLS, type ApprovalFacts } from "@zks/shared";
import { describeRenderAction } from "../jobs/master-files.ts";

type FactFields = Omit<ApprovalFacts, "action" | "outputPaths" | "filesToDelete">;

/** Null when the input does not match the tool's contract, which the decider denies. */
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
