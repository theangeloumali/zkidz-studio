// Created by The Angelo Umali.
// render_preview (plan §6.8): stills of the edit, returned as paths and as PNG image blocks the model can look at.
import type { ImageContent } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { editGate, editGateKey } from "../../jobs/edit-gate.ts";
import { openConfined } from "../../security/confine-path.ts";
import { implementTool } from "../define-tool.ts";
import { projectWorkDir, runEngineCheck } from "../engine-check.ts";
import { workRelativePath } from "../engine-jobs.ts";
import { assetEngineInput, findProjectAsset, loadProject, projectRootOf } from "../project-files.ts";
import { cutSourceAssetId } from "../render-tools.ts";
import { ToolError } from "../result.ts";

// Paths arrive relative to work/ and are confined before any file is read; the contract caps the count.
const PreviewReportSchema = z.object({ stills: z.array(z.object({ at: z.number().nonnegative(), path: z.string().min(1) })) });

const renderPreview = implementTool("render_preview", {
  description:
    "Render up to 4 stills of the edit with its cues (at: edited-timeline seconds; omit to let the studio pick). guides: true overlays the safe areas.",
  handler: async (input, context) => {
    const project = await loadProject(context);
    const projectRoot = projectRootOf(context, project);
    const source = assetEngineInput(projectRoot, await findProjectAsset(context, await cutSourceAssetId(context, project.videoId)));
    const atArgs = (input.at ?? []).flatMap((at) => ["--at", String(at)]);
    const args = ["--video", project.videoId, "--source", source.path, ...atArgs, ...(input.guides === true ? ["--guides"] : [])];
    const workDir = await projectWorkDir(context, project);
    // Its edit stage rewrites work/edl/<v>.json and the edit's audio, which a render, QC, covers or motion job reads mid-run.
    const previewing = editGate.tryWriting(editGateKey(context.projectId, project.videoId), () =>
      runEngineCheck(() => context.engine.run({ command: "render-preview", args, workDir, inPlacePaths: source.inPlacePaths })),
    );
    if (previewing === undefined) throw new ToolError("A render, QC, covers or motion job is reading this edit: preview once it finishes");
    const report = PreviewReportSchema.parse(await previewing);
    const stills = report.stills.map((still) => ({ at: still.at, path: workRelativePath(workDir, still.path) }));
    const images = await Promise.all(
      stills.map(async (still): Promise<ImageContent> => {
        // Confined at open, so a still the engine left as a link out of the project is never read back to the model.
        const { handle } = await openConfined(projectRoot, still.path);
        try {
          return { type: "image", data: (await handle.readFile()).toString("base64"), mimeType: "image/png" };
        } finally {
          await handle.close();
        }
      }),
    );
    return { output: { stills }, images };
  },
});

export const previewTools = [renderPreview];
