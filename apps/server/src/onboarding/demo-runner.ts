// Created by The Angelo Umali.
// examples/demo/make_demo.py as a DemoRunner: it generates its own clip, so the demo needs no footage.
import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import type { ReportProgress } from "../jobs/job-runner.ts";
import { engineParentEnv } from "../jobs/engine-process.ts";

const runFile = promisify(execFile);
const STDERR_TAIL_CHARS = 2000;
/** make_demo.py writes the master here (VIDEO = "v1") and generates its clip at CLIP_NAME. */
const DEMO_MASTER_REL_PATH = "work/out/v1.mp4";
const DEMO_CLIP_REL_PATH = "media/demo.mp4";
/** Above the job runner's 1 s throttle, which drops (not defers) a report that comes sooner. */
const STAGE_POLL_MS = 1500;
/** Each stage runs until the file its step writes last appears; the script prints nothing per step. */
const DEMO_STAGES = [
  { stage: "generating clip", doneMarker: "work/cues/v1.json" },
  { stage: "preparing", doneMarker: "work/edl/v1.json" },
  { stage: "mixing audio", doneMarker: "work/audio/v1_edit.wav" },
  { stage: "rendering", doneMarker: DEMO_MASTER_REL_PATH },
] as const;

export interface DemoResult {
  readonly masterRelPath: string;
  readonly clipRelPath: string;
}

export interface DemoRunner {
  readonly run: (projectRoot: string, reportProgress: ReportProgress) => Promise<DemoResult>;
}

export interface DemoRunnerOptions {
  readonly engineDir: string;
  readonly demoScript: string;
  readonly studioHome: string;
}

export function createDemoRunner({ engineDir, demoScript, studioHome }: DemoRunnerOptions): DemoRunner {
  return {
    run: async (projectRoot, reportProgress) => {
      const argv = ["run", "--project", engineDir, "python", demoScript, "--project", projectRoot];
      const env = { ...engineParentEnv({}), ZKS_HOME: studioHome };
      const watcher = watchDemoStages(projectRoot, reportProgress);
      try {
        await runFile("uv", argv, { cwd: projectRoot, env, shell: false });
      } catch (error) {
        const stderr = typeof error === "object" && error !== null && "stderr" in error ? String(error.stderr) : "";
        throw new Error(`demo render failed: ${stderr.slice(-STDERR_TAIL_CHARS).trim() || String(error)}`, { cause: error });
      } finally {
        await watcher.stop();
      }
      await access(join(projectRoot, DEMO_MASTER_REL_PATH));
      return { masterRelPath: DEMO_MASTER_REL_PATH, clipRelPath: DEMO_CLIP_REL_PATH };
    },
  };
}

/** Polls the stage markers and reports each new stage once; no ETA, since the steps take very uneven times. */
export function watchDemoStages(projectRoot: string, reportProgress: ReportProgress, pollMs = STAGE_POLL_MS): { readonly stop: () => Promise<void> } {
  const stopSignal = new AbortController();
  const poll = async () => {
    let reportedIndex = -1;
    while (!stopSignal.signal.aborted) {
      const stageIndex = await countFinishedStages(projectRoot);
      const current = DEMO_STAGES[stageIndex];
      if (current !== undefined && stageIndex !== reportedIndex) {
        reportedIndex = stageIndex;
        await reportProgress({ stage: current.stage, pct: Math.round((100 * stageIndex) / DEMO_STAGES.length) });
      }
      await sleep(pollMs, undefined, { signal: stopSignal.signal }).catch(() => undefined);
    }
  };
  // Held as a value, so a failed report waits for stop() instead of surfacing as an unhandled rejection.
  const outcome = poll().then(
    () => undefined,
    (error: unknown) => ({ error }),
  );
  return {
    stop: async () => {
      stopSignal.abort();
      const failed = await outcome;
      if (failed !== undefined) throw failed.error;
    },
  };
}

async function countFinishedStages(projectRoot: string): Promise<number> {
  let finished = 0;
  for (const { doneMarker } of DEMO_STAGES) {
    if (!(await exists(join(projectRoot, doneMarker)))) break;
    finished += 1;
  }
  return finished;
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}
