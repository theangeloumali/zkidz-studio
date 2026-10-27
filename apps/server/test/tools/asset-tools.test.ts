// Created by The Angelo Umali.
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jobs, mediaAssets, transcripts } from "@zks/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { describeStudioGate } from "../../src/tools/gate-facts.ts";
import { writeJobResult } from "../../src/tools/job-results.ts";
import { writeAgentSpec } from "../../src/tools/spec-store.ts";
import { createTestServer, type TestServer } from "../support/test-server.ts";
import { callTool, messageOf } from "./cue-fixtures.ts";
import { insertInPlaceAsset } from "./fake-engine.ts";
import { createToolFixture, cutSpecFor, insertCameraAsset, insertTranscript, type ToolFixture } from "./tool-fixtures.ts";

let server: TestServer;
let originalsDir: string;
beforeAll(async () => {
  server = await createTestServer();
  originalsDir = await mkdtemp(join(tmpdir(), "zks-originals-"));
});
afterAll(async () => {
  await server.close();
  await rm(originalsDir, { recursive: true, force: true });
});

async function assetRow(assetId: string) {
  const [row] = await server.database.db.select().from(mediaAssets).where(eq(mediaAssets.id, assetId));
  return row;
}

/** A joined source under work/sources, built by a finished ingest of `clipIds` (and `insertIds` as inserts). */
async function ingestedSource(fixture: ToolFixture, clipIds: readonly string[], insertIds: readonly string[] = []): Promise<string> {
  const relPath = "work/sources/v1.mkv";
  await mkdir(join(fixture.projectRoot, "work", "sources"), { recursive: true });
  await writeFile(join(fixture.projectRoot, relPath), "joined");
  const [source] = await server.database.db
    .insert(mediaAssets)
    .values({ projectId: fixture.context.projectId, kind: "source", name: "v1 source", relPath, bytes: 6, mtimeMs: 0, durationS: 30, fpsNum: 30, fpsDen: 1 })
    .returning();
  if (source === undefined) throw new Error("source insert returned no row");
  const inserts = insertIds.map((srcAssetId) => ({ at: 1, end: 2, srcAssetId, srcAt: 0 }));
  const params = { clips: clipIds.map((assetId) => ({ assetId })), ...(inserts.length === 0 ? {} : { inserts }) };
  const [ingestJob] = await server.database.db
    .insert(jobs)
    .values({ projectId: fixture.context.projectId, kind: "ingest", videoId: "v1", lane: "gpu", status: "succeeded", params })
    .returning();
  if (ingestJob === undefined) throw new Error("ingest job insert returned no row");
  await writeJobResult(fixture.projectRoot, ingestJob.id, {
    sourceAssetId: source.id,
    frames: 900,
    joins: clipIds.map((assetId, index) => ({ assetId, at: index * 10 })),
  });
  return source.id;
}

async function setCuts(fixture: ToolFixture, sourceAssetId: string): Promise<void> {
  expect((await callTool(fixture, "set_cuts", { cuts: cutSpecFor(sourceAssetId) })).isError).toBeUndefined();
}

describe("delete_asset", () => {
  it("deletes an unused upload's row, its transcripts and its file under media/raw", async () => {
    const fixture = await createToolFixture(server);
    const asset = await insertCameraAsset(fixture);
    await insertTranscript(fixture, asset.id, [{ at: 0, end: 1, text: "hi" }]);
    const filePath = join(fixture.projectRoot, asset.relPath ?? "");

    const result = await callTool(fixture, "delete_asset", { assetId: asset.id });
    expect(result.structuredContent).toEqual({ ok: true });
    expect(await assetRow(asset.id)).toBeUndefined();
    expect(await server.database.db.select().from(transcripts).where(eq(transcripts.mediaAssetId, asset.id))).toEqual([]);
    expect(existsSync(filePath)).toBe(false);
  });

  it("drops an in-place asset's row but never touches the user's original", async () => {
    const fixture = await createToolFixture(server);
    const asset = await insertInPlaceAsset(fixture, originalsDir);
    expect((await callTool(fixture, "delete_asset", { assetId: asset.id })).structuredContent).toEqual({ ok: true });
    expect(await assetRow(asset.id)).toBeUndefined();
    expect(existsSync(asset.inPlacePath)).toBe(true);
  });

  it("refuses the cut spec's source", async () => {
    const fixture = await createToolFixture(server);
    const asset = await insertCameraAsset(fixture);
    await setCuts(fixture, asset.id);
    const result = await callTool(fixture, "delete_asset", { assetId: asset.id });
    expect(result.isError).toBe(true);
    expect(messageOf(result)).toMatch(/source of the edit/);
    expect(await assetRow(asset.id)).toBeDefined();
    expect(existsSync(join(fixture.projectRoot, asset.relPath ?? ""))).toBe(true);
  });

  it("refuses a clip or an insert the edit's ingested source was built from", async () => {
    const fixture = await createToolFixture(server);
    const [clip, recording, unrelated] = [await insertCameraAsset(fixture), await insertCameraAsset(fixture), await insertCameraAsset(fixture)];
    await setCuts(fixture, await ingestedSource(fixture, [clip.id], [recording.id]));

    for (const assetId of [clip.id, recording.id]) {
      const result = await callTool(fixture, "delete_asset", { assetId });
      expect(result.isError).toBe(true);
      expect(messageOf(result)).toMatch(/built from/);
      expect(await assetRow(assetId)).toBeDefined();
    }
    expect((await callTool(fixture, "delete_asset", { assetId: unrelated.id })).structuredContent).toEqual({ ok: true });
  });

  // Codex review: an ingest already accepted reads its clips and inserts when it runs, before any spec names them.
  it.each(["queued", "running"] as const)("refuses a clip or insert of an ingest that is %s", async (status) => {
    const fixture = await createToolFixture(server);
    const clip = await insertCameraAsset(fixture);
    const insert = await insertCameraAsset(fixture);
    const params = { clips: [{ assetId: clip.id }], inserts: [{ at: 1, end: 2, srcAssetId: insert.id, srcAt: 0 }] };
    await server.database.db.insert(jobs).values({ projectId: fixture.context.projectId, kind: "ingest", videoId: "v1", lane: "gpu", status, params });
    for (const asset of [clip, insert]) {
      const result = await callTool(fixture, "delete_asset", { assetId: asset.id });
      expect(messageOf(result)).toMatch(/being ingested/);
      expect(await assetRow(asset.id)).toBeDefined();
    }
  });

  it("refuses an asset the current inserts spec plays", async () => {
    const fixture = await createToolFixture(server);
    const recording = await insertCameraAsset(fixture);
    await writeAgentSpec(fixture.context, { videoId: "v1", kind: "inserts" }, [{ at: 1, end: 2, srcAssetId: recording.id, srcAt: 0 }]);
    const result = await callTool(fixture, "delete_asset", { assetId: recording.id });
    expect(result.isError).toBe(true);
    expect(messageOf(result)).toMatch(/insert/);
  });

  it("lets a clip go once the edit no longer uses the source built from it", async () => {
    const fixture = await createToolFixture(server);
    const [clip, otherClip] = [await insertCameraAsset(fixture), await insertCameraAsset(fixture)];
    await ingestedSource(fixture, [clip.id]);
    await setCuts(fixture, otherClip.id);
    expect((await callTool(fixture, "delete_asset", { assetId: clip.id })).structuredContent).toEqual({ ok: true });
  });

  it("refuses another project's asset", async () => {
    const fixture = await createToolFixture(server);
    const other = await insertCameraAsset(await createToolFixture(server));
    expect((await callTool(fixture, "delete_asset", { assetId: other.id })).isError).toBe(true);
    expect(await assetRow(other.id)).toBeDefined();
  });
});

describe("delete_asset approval card", () => {
  it("lists an upload's file, and nothing for an in-place original that stays on disk", async () => {
    const fixture = await createToolFixture(server);
    const upload = await insertCameraAsset(fixture);
    const original = await insertInPlaceAsset(fixture, originalsDir);
    expect(await describeStudioGate(fixture.context, "delete_asset", { assetId: upload.id })).toMatchObject({
      filesToDelete: [join(fixture.projectRoot, upload.relPath ?? "")],
    });
    expect(await describeStudioGate(fixture.context, "delete_asset", { assetId: original.id })).toMatchObject({ filesToDelete: [] });
  });
});
