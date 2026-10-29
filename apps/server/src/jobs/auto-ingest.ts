// Created by The Angelo Umali.
// Starts a project's ingest by itself once its uploads go quiet, so the editor has footage before the agent runs.
import { mediaAssets, projects } from "@zks/db/schema";
import { asc, eq } from "drizzle-orm";
import type { Logger } from "../logging/logger.ts";
import { type IngestStartDeps, openIngestJobIds, startIngest } from "../tools/ingest-start.ts";

const DEFAULT_QUIET_MS = 3000;

export interface AutoIngest {
  /** Runs an upload; once the project has no upload in flight and the drop goes quiet, its ingest starts. */
  track<T>(projectId: string, upload: () => Promise<T>): Promise<T>;
  /** For an upload that created its project: it is already committed, so only the quiet period remains. */
  committed(projectId: string): void;
}

export interface AutoIngestOptions extends IngestStartDeps {
  readonly logger: Logger;
  readonly quietMs?: number;
}

/** For servers that do not wire it, so the routes never branch on its presence. */
export const noAutoIngest: AutoIngest = {
  track: (_projectId, upload) => upload(),
  committed: () => undefined,
};

export function createAutoIngest(options: AutoIngestOptions): AutoIngest {
  const quietMs = options.quietMs ?? DEFAULT_QUIET_MS;
  const uploadsInFlight = new Map<string, number>();
  const timers = new Map<string, NodeJS.Timeout>();
  /** The ingest this module started per project, the only open one it may replace. */
  const ownJobs = new Map<string, string>();

  function scheduleStart(projectId: string): void {
    clearTimeout(timers.get(projectId));
    const timer = setTimeout(() => {
      timers.delete(projectId);
      startFor(projectId).catch((error: unknown) => options.logger.warn("auto ingest failed", { projectId, error: String(error) }));
    }, quietMs);
    timer.unref();
    timers.set(projectId, timer);
  }

  async function startFor(projectId: string): Promise<void> {
    if ((uploadsInFlight.get(projectId) ?? 0) > 0) return;
    const [project] = await options.db.select().from(projects).where(eq(projects.id, projectId));
    if (project === undefined) return;
    const assets = await options.db
      .select({ id: mediaAssets.id, kind: mediaAssets.kind })
      .from(mediaAssets)
      .where(eq(mediaAssets.projectId, projectId))
      .orderBy(asc(mediaAssets.createdAt));
    if (assets.some((asset) => asset.kind === "source")) return;
    const clips = assets.filter((asset) => asset.kind === "camera").map((asset) => ({ assetId: asset.id }));
    if (clips.length === 0) return;
    const ownJobId = ownJobs.get(projectId);
    if ((await openIngestJobIds(options.db, projectId)).some((jobId) => jobId !== ownJobId)) return;
    const started = await startIngest(options, { projectId, videoId: project.videoId, input: { clips } });
    ownJobs.set(projectId, started.jobId);
  }

  return {
    async track(projectId, upload) {
      uploadsInFlight.set(projectId, (uploadsInFlight.get(projectId) ?? 0) + 1);
      clearTimeout(timers.get(projectId));
      try {
        return await upload();
      } finally {
        const remaining = (uploadsInFlight.get(projectId) ?? 1) - 1;
        if (remaining === 0) uploadsInFlight.delete(projectId);
        else uploadsInFlight.set(projectId, remaining);
        // A failed upload still ends the wait, so the drop's earlier files are not left without an ingest.
        if (remaining === 0) scheduleStart(projectId);
      }
    },
    committed: scheduleStart,
  };
}
