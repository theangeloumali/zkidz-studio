// Created by The Angelo Umali.
// One video's edit-stage files (work/edl/<v>.json, the edit's audio): the render jobs read them for minutes while
// render_preview rewrites them. Jobs share a video; a preview holds it alone, so neither lands mid-way through the other.
import type { JobRunner } from "./job-runner.ts";
import { RENDER_JOB_KINDS } from "./spec-snapshot.ts";

export const editGateKey = (projectId: string, videoId: string) => `${projectId}:${videoId}`;

export class EditGate {
  readonly #readers = new Map<string, number>();
  readonly #writers = new Map<string, Promise<void>>();

  /** Runs `read` once no preview holds the video. */
  async whileReading<Result>(key: string, read: () => Promise<Result>): Promise<Result> {
    while (this.#writers.has(key)) await this.#writers.get(key);
    this.#readers.set(key, (this.#readers.get(key) ?? 0) + 1);
    try {
      return await read();
    } finally {
      const left = (this.#readers.get(key) ?? 1) - 1;
      if (left === 0) this.#readers.delete(key);
      else this.#readers.set(key, left);
    }
  }

  /** Runs `write` alone on the video, or returns undefined at once while a job reads it or another preview writes it. */
  tryWriting<Result>(key: string, write: () => Promise<Result>): Promise<Result> | undefined {
    if (this.#readers.has(key) || this.#writers.has(key)) return undefined;
    const running = write();
    const release = () => {
      this.#writers.delete(key);
    };
    this.#writers.set(key, running.then(release, release));
    return running;
  }
}

/** The one gate the render jobs and render_preview share. */
export const editGate = new EditGate();

/** Wraps the production render handlers; call it after they are registered. */
export function gateRenderJobs(jobRunner: JobRunner, gate: EditGate = editGate): void {
  for (const kind of RENDER_JOB_KINDS) {
    jobRunner.wrapHandler(
      kind,
      (handler) => (job, reportProgress, signal) => gate.whileReading(editGateKey(job.projectId, job.videoId), () => handler(job, reportProgress, signal)),
    );
  }
}
