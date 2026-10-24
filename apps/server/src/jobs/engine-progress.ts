// Created by The Angelo Umali.
// Mirrors the progress record the engine writes per edit (packages/engine/zks_engine/progress_store.py) into a job row (plan §5.2).
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type { JobProgress, ReportProgress } from "./job-runner.ts";

const POLL_INTERVAL_MS = 1000;
const FULL_PCT = 100;

const EngineProgressRecordSchema = z.object({
  stage: z.string().min(1),
  state: z.string(),
  done: z.number().nonnegative().nullish(),
  total: z.number().nonnegative().nullish(),
  started: z.number(),
  updated: z.number(),
});
type EngineProgressRecord = z.infer<typeof EngineProgressRecordSchema>;

export interface EngineProgressTarget {
  readonly studioHome: string;
  readonly workDir: string;
  readonly videoId: string;
}

/** progress_store.record_path: the engine keys each edit's record by its work dir's sha1, lower-cased on Windows. */
export function engineProgressRecordPath(target: EngineProgressTarget): string {
  const workDir = resolve(target.workDir);
  const workKey = process.platform === "win32" ? workDir.toLowerCase() : workDir;
  const recordName = `${createHash("sha1").update(workKey).digest("hex").slice(0, 8)}-${target.videoId}.json`;
  return join(target.studioHome, "progress", recordName);
}

/** The record as job progress, or undefined until this run writes one: a record updated before `runStartedS` is a past render's. */
export async function readEngineProgress(recordPath: string, runStartedS: number): Promise<JobProgress | undefined> {
  // Progress is advisory: a record not written yet, or unreadable, never fails the render it describes.
  const text = await readFile(recordPath, "utf8").catch(() => undefined);
  if (text === undefined) return undefined;
  const parsed = EngineProgressRecordSchema.safeParse(parseJsonOrUndefined(text));
  if (!parsed.success || parsed.data.updated < runStartedS) return undefined;
  return progressOf(parsed.data);
}

/** ETA from the stage's live pace; progress_eta.py's history blend reaches only the status line text, never the record. */
function progressOf(record: EngineProgressRecord): JobProgress {
  const { stage, state, done, total } = record;
  if (total === undefined || total === null || total <= 0 || done === undefined || done === null) {
    return { stage, pct: state === "done" ? FULL_PCT : 0 };
  }
  const pct = Math.min(FULL_PCT, (FULL_PCT * done) / total);
  const elapsedS = record.updated - record.started;
  if (state !== "running" || done <= 0 || elapsedS <= 0) return { stage, pct };
  return { stage, pct, etaS: (Math.max(0, total - done) * elapsedS) / done };
}

function parseJsonOrUndefined(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Runs `work` while the edit's engine record is mirrored into the job each second, then once more for its final state. */
export async function followEngineProgress<T>(target: EngineProgressTarget, reportProgress: ReportProgress, work: () => Promise<T>): Promise<T> {
  const recordPath = engineProgressRecordPath(target);
  const runStartedS = Date.now() / 1000;
  const mirror = async () => {
    const progress = await readEngineProgress(recordPath, runStartedS);
    if (progress !== undefined) await reportProgress(progress);
  };
  const stop = Promise.withResolvers<void>();
  let following = true;
  let followError: Error | undefined;
  const follower = (async () => {
    while (following) {
      await mirror();
      await Promise.race([delay(POLL_INTERVAL_MS, undefined, { ref: false }), stop.promise]);
    }
  })().catch((error: unknown) => {
    followError = error instanceof Error ? error : new Error(String(error));
  });
  const stopFollowing = async () => {
    following = false;
    stop.resolve();
    await follower;
  };
  try {
    const result = await work();
    // The follower settles first, so no stale write can land after the final one.
    await stopFollowing();
    if (followError !== undefined) throw followError;
    await mirror();
    return result;
  } finally {
    await stopFollowing();
  }
}

/** For engine commands that write no progress record: the job shows `stage` from its start, full once it succeeds. */
export async function reportStage<T>(reportProgress: ReportProgress, stage: string, work: () => Promise<T>): Promise<T> {
  await reportProgress({ stage, pct: 0 });
  const result = await work();
  await reportProgress({ stage, pct: FULL_PCT });
  return result;
}
