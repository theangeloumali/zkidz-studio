// Created by The Angelo Umali.
// Fault injection for the QC e2e: each rendered master is swapped for one that holds its first picture (the ep25 frozen-footage bug).
// Size, frame count and audio are kept, so only the moving-footage gate can tell.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, rename, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { EngineRunner } from "../../../server/src/tools/engine-jobs.ts";

const execFileAsync = promisify(execFile);
const MasterReportSchema = z.looseObject({ path: z.string().min(1), frames: z.int().positive(), master: z.looseObject({}) });

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
        const parsed = MasterReportSchema.parse(report);
        const masterPath = resolve(request.workDir, parsed.path);
        await freezeMaster(ffmpegPath, masterPath, parsed.frames);
        // The swap stands in for the engine writing a frozen master, so its report hashes the swapped bytes.
        const [bytes, stats] = await Promise.all([readFile(masterPath), stat(masterPath, { bigint: true })]);
        const digest = { size: Number(stats.size), mtimeNs: String(stats.mtimeNs), sha256: createHash("sha256").update(bytes).digest("hex") };
        return { ...parsed, bytes: digest.size, master: { ...parsed.master, ...digest } };
      }
      return report;
    },
  };
}
