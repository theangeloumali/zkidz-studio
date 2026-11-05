// Created by The Angelo Umali.
// A drop of several clips through the real upload routes starts one ingest of all of them, in upload order.
import { readFile, rm } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { jobs } from "@zks/db/schema";
import { API_ROUTES, MediaAssetSchema, PROJECT_TITLE_HEADER, ProjectSchema, UPLOAD_FILENAME_HEADER } from "@zks/shared";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createAutoIngest } from "../src/jobs/auto-ingest.ts";
import { hasFfmpeg, makeMediaFixtures, type MediaFixtures } from "./support/media-fixtures.ts";
import { connectionFrom, createTestServer, TEST_HOST, type TestServer } from "./support/test-server.ts";

const ffmpegAvailable = await hasFfmpeg();
const QUIET_MS = 60;
const CreatedSchema = z.strictObject({ project: ProjectSchema, asset: MediaAssetSchema });

let server: TestServer;
let fixtures: MediaFixtures;
beforeAll(async () => {
  server = await createTestServer((base) => ({
    autoIngest: createAutoIngest({ db: base.database.db, studioHome: base.studioHome, jobs: base.jobRunner, logger: base.logger, quietMs: QUIET_MS }),
  }));
  server.jobRunner.registerHandler("ingest", () => Promise.resolve());
  if (ffmpegAvailable) fixtures = await makeMediaFixtures();
});
afterAll(async () => {
  await server.close();
  if (ffmpegAvailable) await rm(fixtures.dir, { recursive: true, force: true });
});

async function post(path: string, name: string, headers: Record<string, string> = {}) {
  const allHeaders = { host: TEST_HOST, "content-type": "application/octet-stream", [UPLOAD_FILENAME_HEADER]: name, ...headers };
  const body = await readFile(fixtures.clipMp4);
  return server.app.request(path, { method: "POST", headers: allHeaders, body, duplex: "half" }, connectionFrom("127.0.0.1"));
}

describe.skipIf(!ffmpegAvailable)("auto ingest from the upload routes", () => {
  it("ingests the first clip and its follow-ups as one job", async () => {
    const created = CreatedSchema.parse(await (await post(API_ROUTES.createProjectWithMedia.path, "a.mp4", { [PROJECT_TITLE_HEADER]: "drop" })).json());
    const second = MediaAssetSchema.parse(await (await post(`/api/projects/${created.project.id}/media`, "b.mp4")).json());
    const third = MediaAssetSchema.parse(await (await post(`/api/projects/${created.project.id}/media`, "c.mp4")).json());

    // A finished ingest also queues its transcription (auto-transcribe), so only ingest jobs are counted.
    const ingestJobs = () =>
      server.database.db
        .select()
        .from(jobs)
        .where(and(eq(jobs.projectId, created.project.id), eq(jobs.kind, "ingest")));
    await vi.waitFor(async () => expect(await ingestJobs()).toHaveLength(1));
    await delay(QUIET_MS * 3);

    const started = await ingestJobs();
    expect(started).toHaveLength(1);
    expect(started[0]?.params).toMatchObject({ clips: [created.asset, second, third].map(({ id }) => ({ assetId: id })), mode: "join" });
  });
});
