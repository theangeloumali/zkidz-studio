// Created by The Angelo Umali.
// A project's first uploads start their own ingest, once for the whole drop, without an agent session.
import { setTimeout as delay } from "node:timers/promises";
import { jobs, mediaAssets } from "@zks/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createAutoIngest, type AutoIngest } from "../../src/jobs/auto-ingest.ts";
import { createLogger } from "../../src/logging/logger.ts";
import { startIngest } from "../../src/tools/ingest-start.ts";
import { insertProject, type TestServer, createTestServer } from "../support/test-server.ts";

const QUIET_MS = 40;
let server: TestServer;
let autoIngest: AutoIngest;
/** Set by a test: an ingest run waits here, and rejects when its job is cancelled. */
let runGate: Promise<void> | undefined;

beforeAll(async () => {
  server = await createTestServer();
  const gatedRun = async (_job: unknown, _report: unknown, signal: AbortSignal) => {
    const gate = runGate;
    if (gate === undefined) return;
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) reject(new Error("aborted"));
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      void gate.then(resolve);
    });
  };
  server.jobRunner.registerHandler("ingest", gatedRun);
  server.jobRunner.registerHandler("transcribe", gatedRun);
  autoIngest = createAutoIngest({
    db: server.database.db,
    studioHome: server.studioHome,
    jobs: server.jobRunner,
    logger: createLogger(() => undefined),
    quietMs: QUIET_MS,
  });
});
afterAll(async () => {
  await server.close();
});

async function upload(projectId: string, kind: "camera" | "image" | "source" | "screen_recording" | "reference" = "camera") {
  return autoIngest.track(projectId, async () => {
    const [asset] = await server.database.db
      .insert(mediaAssets)
      .values({ projectId, kind, name: "clip.mp4", relPath: `media/raw/${crypto.randomUUID()}.mp4`, bytes: 1, mtimeMs: 0, durationS: 5 })
      .returning();
    if (asset === undefined) throw new Error("asset insert returned no row");
    return asset;
  });
}

async function projectJobs(projectId: string, kind: "ingest" | "transcribe") {
  return server.database.db
    .select()
    .from(jobs)
    .where(and(eq(jobs.projectId, projectId), eq(jobs.kind, kind)))
    .orderBy(asc(jobs.queuedAt));
}

const ingestJobs = (projectId: string) => projectJobs(projectId, "ingest");

describe("auto ingest", () => {
  it("starts one ingest of every clip in upload order once the drop goes quiet", async () => {
    const project = await insertProject(server);
    const clipIds = [(await upload(project.id)).id, (await upload(project.id)).id];
    await upload(project.id, "image");
    clipIds.push((await upload(project.id)).id);

    await vi.waitFor(async () => expect(await ingestJobs(project.id)).toHaveLength(1));
    await delay(QUIET_MS * 3);

    const started = await ingestJobs(project.id);
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ kind: "ingest", lane: "gpu", videoId: project.videoId });
    expect(started[0]?.params).toMatchObject({ clips: clipIds.map((assetId) => ({ assetId })), mode: "join" });
  });

  it("queues the transcription beside the ingest, so whisper starts once the audio exists", async () => {
    const project = await insertProject(server);
    await upload(project.id);

    await vi.waitFor(async () => expect(await projectJobs(project.id, "transcribe")).toHaveLength(1));
    const [transcription] = await projectJobs(project.id, "transcribe");
    expect(transcription).toMatchObject({ lane: "whisper", videoId: project.videoId, params: { language: "auto", model: "turbo" } });
  });

  it("replaces its transcription with the ingest when a later clip lands", async () => {
    const project = await insertProject(server);
    const release = Promise.withResolvers<void>();
    runGate = release.promise;
    try {
      await upload(project.id);
      await vi.waitFor(async () => expect(await projectJobs(project.id, "transcribe")).toHaveLength(1));
      await upload(project.id);

      await vi.waitFor(async () => expect(await projectJobs(project.id, "transcribe")).toHaveLength(2));
      const [replaced, current] = await projectJobs(project.id, "transcribe");
      expect(["cancelled", "interrupted"]).toContain(replaced?.status);
      expect(current?.status).not.toBe("cancelled");
    } finally {
      runGate = undefined;
      release.resolve();
    }
  });

  it("does nothing for a project that already has its source", async () => {
    const project = await insertProject(server);
    await upload(project.id, "source");
    await upload(project.id);

    await delay(QUIET_MS * 4);

    expect(await ingestJobs(project.id)).toHaveLength(0);
  });

  // A screen recording beside a camera clip is a showcase insert: the template's ingest places it, so a join would be thrown away.
  it("leaves a drop with a screen recording to the template's ingest", async () => {
    const project = await insertProject(server);
    await upload(project.id);
    await upload(project.id, "screen_recording");

    await delay(QUIET_MS * 4);

    expect(await ingestJobs(project.id)).toHaveLength(0);
  });

  it("keeps its running ingest when a style reference lands, since a reference is never footage", async () => {
    const project = await insertProject(server);
    const release = Promise.withResolvers<void>();
    runGate = release.promise;
    try {
      const camera = await upload(project.id);
      await vi.waitFor(async () => expect((await ingestJobs(project.id))[0]?.status).toBe("running"));
      await upload(project.id, "reference");
      await delay(QUIET_MS * 4);

      const started = await ingestJobs(project.id);
      expect(started).toHaveLength(1);
      expect(started[0]?.status).toBe("running");
      expect(started[0]?.params).toMatchObject({ clips: [{ assetId: camera.id }] });
    } finally {
      release.resolve();
    }
  });

  it("replaces its own running ingest when a later clip lands", async () => {
    const project = await insertProject(server);
    const release = Promise.withResolvers<void>();
    runGate = release.promise;
    try {
      const first = await upload(project.id);
      await vi.waitFor(async () => expect((await ingestJobs(project.id))[0]?.status).toBe("running"));
      const second = await upload(project.id);

      await vi.waitFor(async () => expect(await ingestJobs(project.id)).toHaveLength(2));
      const [replaced, current] = await ingestJobs(project.id);
      expect(replaced?.status).toBe("interrupted");
      expect(current?.params).toMatchObject({ clips: [{ assetId: first.id }, { assetId: second.id }] });
    } finally {
      runGate = undefined;
      release.resolve();
    }
  });

  it("leaves an ingest the agent started alone", async () => {
    const project = await insertProject(server);
    const release = Promise.withResolvers<void>();
    runGate = release.promise;
    try {
      const clip = await upload(project.id);
      await vi.waitFor(async () => expect(await ingestJobs(project.id)).toHaveLength(1));
      await server.jobRunner.cancel((await ingestJobs(project.id))[0]?.id ?? "");
      const agentJob = await startIngest(
        { db: server.database.db, jobs: server.jobRunner, studioHome: server.studioHome },
        { projectId: project.id, videoId: project.videoId, input: { clips: [{ assetId: clip.id, zoom: 1.2 }] } },
      );
      await upload(project.id);

      await delay(QUIET_MS * 4);

      const open = (await ingestJobs(project.id)).filter((job) => job.status === "queued" || job.status === "running");
      expect(open.map((job) => job.id)).toEqual([agentJob.jobId]);
    } finally {
      runGate = undefined;
      release.resolve();
    }
  });
});
