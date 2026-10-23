// Created by The Angelo Umali.
// Fault injection for the QC e2e: each rendered master is swapped for one that holds its first picture (the ep25 frozen-footage bug).
// Size, frame count and audio are kept, so only the moving-footage gate can tell.
import { execFile } from "node:child_process";
import { rename } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { EngineRunner } from "../../../server/src/tools/engine-jobs.ts";

const execFileAsync = promisify(execFile);
const MasterReportSchema = z.object({ path: z.string().min(1), frames: z.int().positive() });

async function freezeMaster(ffmpegPath: string, masterPath: string, frames: number): Promise<void> {
  const frozenPath = `${masterPath}.frozen.mp4`;
  const holdFirstPicture = ["-vf", "trim=end_frame=1,tpad=stop_mode=clone:stop=-1", "-frames:v", String(frames)];
  // -g 1: P-frames would refine the cloned picture a little each frame and read as motion.
  const encode = ["-c:v", "libx264", "-preset", "ultrafast", "-g", "1", "-pix_fmt", "yuv420p", "-c:a", "copy"];
  await execFileAsync(ffmpegPath, ["-v", "error", "-y", "-i", masterPath, "-map", "0:v", "-map", "0:a", ...holdFirstPicture, ...encode, frozenPath]);
  await rename(frozenPath, masterPath);
}

export function withFrozenMasters(engine: EngineRunner, ffmpegPath: string): EngineRunner {
  return {
    run: async (request) => {
      const report = await engine.run(request);
      if (request.command === "render-master") {
        const { path, frames } = MasterReportSchema.parse(report);
        await freezeMaster(ffmpegPath, resolve(request.workDir, path), frames);
      }
      return report;
    },
  };
}
