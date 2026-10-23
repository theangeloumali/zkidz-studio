// Created by The Angelo Umali.
// A finished job's result lives beside its project, since the jobs row has no result column (job_status reads it back).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { hasErrorCode } from "@zks/db";

function jobResultPath(projectRoot: string, jobId: string): string {
  return join(projectRoot, "work", "jobs", `${jobId}.json`);
}

export async function writeJobResult(projectRoot: string, jobId: string, result: unknown): Promise<void> {
  await mkdir(join(projectRoot, "work", "jobs"), { recursive: true });
  await writeFile(jobResultPath(projectRoot, jobId), JSON.stringify(result), { mode: 0o600 });
}

export async function readJobResult(projectRoot: string, jobId: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(jobResultPath(projectRoot, jobId), "utf8"));
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return undefined;
    throw error;
  }
}
