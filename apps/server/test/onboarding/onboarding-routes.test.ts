// Created by The Angelo Umali.
import { access, copyFile, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { jobs } from "@zks/db/schema";
import { API_ROUTES, HomeTemplateSchema, StylePresetSchema } from "@zks/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { projectDir } from "../../src/config.ts";
import { DEFAULT_UPLOAD_LIMITS } from "../../src/media-io/store.ts";
import { createOnboardingServices, type DemoRunner } from "../../src/onboarding/onboarding-services.ts";
import { readProjectTemplate } from "../../src/onboarding/project-template.ts";
import { readJobResult } from "../../src/tools/job-results.ts";
import { createToolFixture, insertCameraAsset } from "../tools/tool-fixtures.ts";
import { hasFfmpeg, makeMediaFixtures, type MediaFixtures } from "../support/media-fixtures.ts";
import { connectionFrom, createTestServer, getRequest, postJson, TEST_HOST, type TestServer } from "../support/test-server.ts";

const PRESETS_DIR = fileURLToPath(new URL("../../../../themes/zkidz/presets", import.meta.url));

const ffmpegAvailable = await hasFfmpeg();
let server: TestServer;
let fixtures: MediaFixtures | undefined;
const demoRuns: { projectRoot: string; mediaBefore: string[] }[] = [];
/** Stands in for make_demo.py: it writes the clip where the script does and reports one stage. */
const fakeDemoRunner: DemoRunner = {
  run: async (projectRoot, reportProgress) => {
    demoRuns.push({ projectRoot, mediaBefore: await readdir(join(projectRoot, "media")) });
    if (fixtures !== undefined) await copyFile(fixtures.clipMp4, join(projectRoot, "media", "demo.mp4"));
    await reportProgress({ stage: "rendering", pct: 75 });
    return { masterRelPath: "work/out/v1.mp4", clipRelPath: "media/demo.mp4" };
  },
};

beforeAll(async () => {
  if (ffmpegAvailable) fixtures = await makeMediaFixtures();
  server = await createTestServer((base) => ({
    onboarding: createOnboardingServices({
      database: base.database.db,
      studioHome: base.studioHome,
      eventBus: base.eventBus,
      jobRunner: base.jobRunner,
      demoRunner: fakeDemoRunner,
      ffprobePath: "ffprobe",
      uploadLimits: DEFAULT_UPLOAD_LIMITS,
    }),
  }));
});
afterAll(async () => {
  await server.close();
  if (fixtures !== undefined) await rm(fixtures.dir, { recursive: true, force: true });
});

function putJson(path: string, body: unknown) {
  const init = { method: "PUT", headers: { host: TEST_HOST, "content-type": "application/json" }, body: JSON.stringify(body) };
  return server.app.request(path, init, connectionFrom("127.0.0.1"));
}

async function presetFiles(kind: "styles" | "templates"): Promise<unknown[]> {
  const names = (await readdir(join(PRESETS_DIR, kind))).filter((name) => name.endsWith(".json")).sort();
  return Promise.all(names.map(async (name) => JSON.parse(await readFile(join(PRESETS_DIR, kind, name), "utf8")) as unknown));
}

describe("house style", () => {
  it("defaults to the ZKidz style before one is saved", async () => {
    const response = await getRequest(server, API_ROUTES.getStyle.path);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ styleId: "zkidz" });
  });

  it("keeps the saved choice for the next read", async () => {
    const saved = await putJson(API_ROUTES.setStyle.path, { styleId: "loud" });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ styleId: "loud" });

    const read = await getRequest(server, API_ROUTES.getStyle.path);
    expect(await read.json()).toEqual({ styleId: "loud" });
  });

  it("rejects a style that is not shipped", async () => {
    const response = await putJson(API_ROUTES.setStyle.path, { styleId: "neon" });
    expect(response.status).toBe(400);
  });
});

describe("presets", () => {
  it("serves every shipped style preset, validated", async () => {
    const response = await getRequest(server, API_ROUTES.listStylePresets.path);
    const { styles } = API_ROUTES.listStylePresets.response.parse(await response.json());
    const files = (await presetFiles("styles")).map((file) => StylePresetSchema.parse(file));
    expect([...styles].sort((left, right) => left.id.localeCompare(right.id))).toEqual(files.sort((left, right) => left.id.localeCompare(right.id)));
  });

  it("serves every shipped Home template, validated", async () => {
    const response = await getRequest(server, API_ROUTES.listTemplates.path);
    const { templates } = API_ROUTES.listTemplates.response.parse(await response.json());
    const files = (await presetFiles("templates")).map((file) => HomeTemplateSchema.parse(file));
    expect(templates.map((template) => template.id).sort()).toEqual(files.map((template) => template.id).sort());
    expect(templates).toEqual(expect.arrayContaining(files));
  });
});

describe("start from a template", () => {
  async function startTemplate(projectId: string, body: unknown) {
    return postJson(server, API_ROUTES.startTemplate.path.replace(":projectId", projectId), body);
  }

  async function firstIngestJob(projectId: string) {
    const [job] = await server.database.db.select().from(jobs).where(eq(jobs.projectId, projectId));
    return job;
  }

  it.each([
    ["talking-head-short", "single", 1],
    ["vlog", "join", 2],
  ] as const)("stores %s as %s and ingests its clips in order", async (templateId, ingestMode, clipCount) => {
    const fixture = await createToolFixture(server);
    const clips = await Promise.all(Array.from({ length: clipCount }, () => insertCameraAsset(fixture)));
    const response = await startTemplate(fixture.context.projectId, { templateId, clipAssetIds: clips.map((clip) => clip.id) });

    expect(response.status).toBe(200);
    const started = API_ROUTES.startTemplate.response.parse(await response.json());
    expect(started).toMatchObject({ templateId, ingestMode });
    const job = await firstIngestJob(fixture.context.projectId);
    expect(job).toMatchObject({ id: started.ingestJobId, kind: "ingest", lane: "gpu" });
    expect(job?.params).toEqual({ clips: clips.map((clip) => ({ assetId: clip.id })) });

    expect(await readProjectTemplate(server.database.db, fixture.context.projectId)).toEqual({ templateId, ingestMode });
  });

  it("stores a showcase and ingests the camera with the screen recording as an insert", async () => {
    const fixture = await createToolFixture(server);
    const camera = await insertCameraAsset(fixture, 30);
    const screen = await insertCameraAsset(fixture, 12);
    const response = await startTemplate(fixture.context.projectId, {
      templateId: "screen-recording-showcase",
      clipAssetIds: [camera.id],
      insertAssetId: screen.id,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ingestMode: "showcase" });
    const job = await firstIngestJob(fixture.context.projectId);
    expect(job?.params).toEqual({ clips: [{ assetId: camera.id }], inserts: [{ at: 0, end: 12, srcAssetId: screen.id, srcAt: 0 }] });
  });

  it("refuses footage that does not fit the template's ingest mode", async () => {
    const fixture = await createToolFixture(server);
    const [first, second] = [await insertCameraAsset(fixture), await insertCameraAsset(fixture)];
    const tooMany = await startTemplate(fixture.context.projectId, { templateId: "talking-head-short", clipAssetIds: [first.id, second.id] });
    const noScreen = await startTemplate(fixture.context.projectId, { templateId: "screen-recording-showcase", clipAssetIds: [first.id] });
    const unknown = await startTemplate(fixture.context.projectId, { templateId: "nope", clipAssetIds: [first.id] });

    expect([tooMany.status, noScreen.status, unknown.status]).toEqual([400, 400, 400]);
    expect(await firstIngestJob(fixture.context.projectId)).toBeUndefined();
  });

  it("refuses an asset from another project", async () => {
    const owner = await createToolFixture(server);
    const stranger = await createToolFixture(server);
    const foreign = await insertCameraAsset(stranger);
    const response = await startTemplate(owner.context.projectId, { templateId: "talking-head-short", clipAssetIds: [foreign.id] });

    expect(response.status).toBe(400);
    expect(await firstIngestJob(owner.context.projectId)).toBeUndefined();
  });
});

describe.skipIf(!ffmpegAvailable)("demo project", () => {
  it("creates a project with no footage, renders the demo and lists its clip as media", async () => {
    const response = await postJson(server, API_ROUTES.openDemoProject.path, null);

    expect(response.status).toBe(200);
    const project = API_ROUTES.openDemoProject.response.parse(await response.json());
    const projectRoot = projectDir(server.studioHome, project.slug);
    await access(join(projectRoot, ".zks-demo"));

    await server.jobRunner.idle();
    const [job] = await server.database.db.select().from(jobs).where(eq(jobs.projectId, project.id));
    expect(job).toMatchObject({ kind: "demo", status: "succeeded", stage: "rendered", pct: 100 });
    expect(demoRuns).toEqual([{ projectRoot, mediaBefore: [] }]);
    expect(await readJobResult(projectRoot, job?.id ?? "")).toEqual({ masterRelPath: "work/out/v1.mp4" });

    const media = await getRequest(server, API_ROUTES.listMedia.path.replace(":projectId", project.id));
    const { assets } = API_ROUTES.listMedia.response.parse(await media.json());
    expect(assets).toEqual([expect.objectContaining({ name: "demo.mp4", kind: "camera", isInPlace: false })]);
  });
});
