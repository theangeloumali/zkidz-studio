// Created by The Angelo Umali.
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { jobs } from "@zks/db/schema";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerExportHandler } from "../../src/jobs/deliverables.ts";
import { STUDIO_TOOLS_BY_NAME } from "../../src/tools/catalog.ts";
import { registerRenderJobHandlers } from "../../src/tools/render-tools.ts";
import type { EngineRequest } from "../../src/tools/engine-jobs.ts";
import { writeJobResult } from "../../src/tools/job-results.ts";
import { passingQcVerdict } from "../jobs/job-test-kit.ts";
import { createTestServer, type TestServer } from "../support/test-server.ts";
import { createToolFixture, cutSpecFor, insertCameraAsset, insertTranscript, type ToolFixture } from "./tool-fixtures.ts";

const FAILING_QC_REPORT = {
  master: "out/v1-4k.mp4",
  ok: false,
  checks: [
    { name: "motion", ok: false, detail: "footage frozen in the shot at 3.00-9.00 s while the original moves" },
    { name: "lipSync", ok: true, detail: "pass" },
  ],
};
const MOTION_REPORT = { verdict: "PASS", shots: [{ at: 0, end: 3, score: 0.4, originalScore: 0.42, isFrozen: false }] };

let server: TestServer;
const engineRequests: EngineRequest[] = [];
let failNextQc = false;
let failNextQcStatus = false;
let hangNextRender: (() => void) | undefined;

/** A render that runs until the request's signal aborts, as the engine does once its process tree is killed. */
function renderUntilAborted(request: EngineRequest, markStarted: () => void): Promise<never> {
  return new Promise((_resolve, reject) => {
    request.signal?.addEventListener("abort", () => reject(new Error("zks-engine render-master cancelled")), { once: true });
    markStarted();
  });
}

function engineReport(request: EngineRequest): unknown {
  switch (request.command) {
    case "render-master":
      if (hangNextRender !== undefined) {
        const markStarted = hangNextRender;
        hangNextRender = undefined;
        return renderUntilAborted(request, markStarted);
      }
      return { path: "out/v1-4k.mp4", frames: 1798, lufs: -14.1, truePeak: -1.4, bytes: 52_000_000 };
    case "qc-master":
      if (failNextQc) throw new Error("zks-engine qc-master failed: whisper-cli is not installed. Run: pnpm zks setup");
      return FAILING_QC_REPORT;
    case "check-motion":
      return MOTION_REPORT;
    case "qc-status":
      if (failNextQcStatus) throw new Error("zks-engine qc-status failed: v1 failed QC (motion); fix it and re-render before export");
      return passingQcVerdict(request.workDir, argumentAfter(request, "--video"));
    case "make-covers": {
      const video = argumentAfter(request, "--video");
      const covers = request.args
        .filter((arg) => arg === "--at")
        .map((_flag, coverIndex) => ({ path: `covers/${video}-cover-${coverIndex}.png`, at: 1, blurBoxes: 1 }));
      return request.args.includes("--post-caption") ? { covers, postCaption: "covers/v1-caption.txt" } : { covers };
    }
    default:
      throw new Error(`unexpected engine command ${request.command}`);
  }
}

const fakeEngine = {
  run: (request: EngineRequest) => {
    engineRequests.push(request);
    return Promise.resolve().then(() => engineReport(request));
  },
};

beforeAll(async () => {
  server = await createTestServer();
  registerRenderJobHandlers(server.jobRunner, { db: server.database.db, studioHome: server.studioHome, engine: fakeEngine });
  registerExportHandler(server.jobRunner, { database: server.database.db, studioHome: server.studioHome, engine: fakeEngine });
});
afterAll(async () => {
  await server.close();
});

async function callTool(fixture: ToolFixture, name: string, input: unknown) {
  const studioTool = STUDIO_TOOLS_BY_NAME.get(name);
  if (studioTool === undefined) throw new Error(`no tool ${name}`);
  return studioTool.run(input, fixture.context);
}

function argumentAfter(request: EngineRequest | undefined, flag: string): string {
  const args = request?.args ?? [];
  return args[args.indexOf(flag) + 1] ?? "";
}

/** A project with a camera clip, its cut spec and transcript, ready for render tools. Approval cards are denied unless `decide` says otherwise. */
async function editedProject(decide?: Parameters<typeof createToolFixture>[1]): Promise<{ fixture: ToolFixture; assetId: string }> {
  const fixture = await createToolFixture(server, decide);
  const asset = await insertCameraAsset(fixture);
  await insertTranscript(fixture, asset.id, [{ at: 0.2, end: 0.6, text: " hello" }]);
  const setCuts = await callTool(fixture, "set_cuts", { cuts: cutSpecFor(asset.id) });
  expect(setCuts.isError).toBeUndefined();
  return { fixture, assetId: asset.id };
}

describe("render_master", () => {
  it("queues a gpu job that renders through the engine and reports the master", async () => {
    const { fixture } = await editedProject();
    const queued = await callTool(fixture, "render_master", { target: "full", quality: "4k" });
    const jobId = String(queued.structuredContent?.jobId);
    const [row] = await server.database.db.select().from(jobs).where(eq(jobs.id, jobId));
    expect(row).toMatchObject({ kind: "render_master", lane: "gpu" });

    const waited = await callTool(fixture, "job_wait", { jobId, timeoutS: 10 });
    expect(waited.structuredContent).toMatchObject({
      status: "succeeded",
      result: { path: "work/out/v1-4k.mp4", frames: 1798, lufs: -14.1, truePeak: -1.4, bytes: 52_000_000 },
    });
    const request = engineRequests.at(-1);
    expect(request).toMatchObject({ command: "render-master", args: ["--video", "v1", "--quality", "4k", "--source", expect.any(String)] });
    expect(argumentAfter(request, "--source").startsWith(fixture.projectRoot)).toBe(true);
    expect(request?.signal).toBeInstanceOf(AbortSignal);
  });

  it("cancels a running render through job_cancel, leaving it interrupted, and job_resume runs it again once approved", async () => {
    const { fixture } = await editedProject(() => Promise.resolve("allow"));
    const { promise: renderStarted, resolve: markStarted } = Promise.withResolvers<void>();
    hangNextRender = markStarted;
    const queued = await callTool(fixture, "render_master", { target: "full", quality: "draft" });
    const jobId = String(queued.structuredContent?.jobId);
    await renderStarted;

    expect((await callTool(fixture, "job_cancel", { jobId })).structuredContent).toEqual({ ok: true });
    expect((await callTool(fixture, "job_status", { jobId })).structuredContent).toMatchObject({ status: "interrupted" });

    expect((await callTool(fixture, "job_resume", { jobId })).structuredContent).toEqual({ ok: true });
    const resumed = await callTool(fixture, "job_wait", { jobId, timeoutS: 10 });
    expect(resumed.structuredContent).toMatchObject({ status: "succeeded", result: { frames: 1798 } });
  });

  it("gates job_resume on a render with the same card a fresh render raises, marked as a resume", async () => {
    const { fixture } = await editedProject(() => Promise.resolve("allow"));
    const jobId = await interruptedRender(fixture);

    expect((await callTool(fixture, "job_resume", { jobId })).structuredContent).toEqual({ ok: true });

    expect(fixture.approvalCards).toMatchObject([
      { tool: "mcp__studio__render_master", facts: { action: "Resume: Render the draft master", outputPaths: ["work/out/v1-draft.mp4"] } },
    ]);
  });

  it("leaves a render interrupted, and never starts the engine, when the user declines its resume", async () => {
    const { fixture } = await editedProject();
    const jobId = await interruptedRender(fixture);
    const enginesBefore = engineRequests.length;

    const result = await callTool(fixture, "job_resume", { jobId });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("The user declined resuming render_master");
    expect((await callTool(fixture, "job_status", { jobId })).structuredContent).toMatchObject({ status: "interrupted" });
    expect(engineRequests).toHaveLength(enginesBefore);
  });

  it("refuses to resume a job that was not interrupted", async () => {
    const { fixture } = await editedProject();
    const queued = await callTool(fixture, "render_master", { target: "full", quality: "draft" });
    const jobId = String(queued.structuredContent?.jobId);
    await callTool(fixture, "job_wait", { jobId, timeoutS: 10 });
    const result = await callTool(fixture, "job_resume", { jobId });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("succeeded");
  });

  it("renders the Reels cut as the reel video id", async () => {
    const { fixture } = await editedProject();
    const queued = await callTool(fixture, "render_master", { target: "reel", quality: "draft" });
    await callTool(fixture, "job_wait", { jobId: String(queued.structuredContent?.jobId), timeoutS: 10 });
    expect(argumentAfter(engineRequests.at(-1), "--video")).toBe("v1r");
  });
});

describe("qc_master", () => {
  it("runs every gate on the cut source and kept words and returns each check", async () => {
    const { fixture } = await editedProject();
    const result = await callTool(fixture, "qc_master", { target: "full" });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ ok: false, checks: FAILING_QC_REPORT.checks });

    const request = engineRequests.at(-1);
    expect(request?.command).toBe("qc-master");
    const sourcePath = argumentAfter(request, "--source");
    expect(isAbsolute(sourcePath) && sourcePath.startsWith(fixture.projectRoot)).toBe(true);
    const words: unknown = JSON.parse(await readFile(argumentAfter(request, "--words"), "utf8"));
    expect(words).toEqual([{ at: 0.2, end: 0.6, text: " hello" }]);
  });

  it("turns an engine failure into a tool error Claude can act on", async () => {
    const { fixture } = await editedProject();
    failNextQc = true;
    try {
      const result = await callTool(fixture, "qc_master", { target: "full" });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("whisper-cli is not installed");
    } finally {
      failNextQc = false;
    }
  });

  it("fails before any job when the video has no cut spec", async () => {
    const fixture = await createToolFixture(server);
    const result = await callTool(fixture, "qc_master", { target: "full" });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("set_cuts");
  });
});

describe("check_motion", () => {
  it("scores the master's shots against the cut source", async () => {
    const { fixture } = await editedProject();
    const result = await callTool(fixture, "check_motion", { stage: "master", regions: [{ x: 240, y: 880, w: 600, h: 380 }] });
    expect(result.structuredContent).toEqual(MOTION_REPORT);
    const request = engineRequests.at(-1);
    expect(request?.args).toEqual(expect.arrayContaining(["--stage", "master", "--region", "240,880,600,380"]));
  });

  it("compares the joined source with each ingested clip at its join", async () => {
    const { fixture, assetId } = await editedProject();
    const [ingestJob] = await server.database.db
      .insert(jobs)
      .values({ projectId: fixture.context.projectId, kind: "ingest", videoId: "v1", lane: "gpu", status: "succeeded", params: {} })
      .returning();
    if (ingestJob === undefined) throw new Error("ingest job insert returned no row");
    await writeJobResult(fixture.projectRoot, ingestJob.id, { sourceAssetId: assetId, frames: 900, joins: [{ assetId, at: 0 }] });
    await callTool(fixture, "check_motion", { stage: "source" });
    const clip = argumentAfter(engineRequests.at(-1), "--clip");
    expect(clip.startsWith(fixture.projectRoot) && clip.endsWith("@0")).toBe(true);
  });
});

describe("make_covers", () => {
  it("draws one cover per variant and stores a variant's cue as the cover sheet", async () => {
    const { fixture } = await editedProject();
    const cue = { kind: "keyword", at: 0, end: 2.5, text: "Covers" };
    const result = await callTool(fixture, "make_covers", {
      variants: [
        { source: "intro", at: 2.3 },
        { source: "free", at: 8, cue },
      ],
    });
    expect(result.structuredContent).toEqual({ covers: [{ path: "work/covers/v1-cover-0.png" }, { path: "work/covers/v1-cover-1.png" }] });

    const request = engineRequests.at(-1);
    expect(request?.args).toEqual(expect.arrayContaining(["--at", "2.3", "--at", "8"]));
    const sheet: unknown = JSON.parse(await readFile(argumentAfter(request, "--cover-sheet"), "utf8"));
    expect(sheet).toEqual([cue]);
  });

  it("draws the Reels covers as the reel's own video and hands the post caption to the engine", async () => {
    const { fixture } = await editedProject();
    const postCaption = "Three cuts that saved my edit\n#zkidz #shorts";
    const result = await callTool(fixture, "make_covers", { target: "reel", variants: [{ source: "intro", at: 2.3 }], postCaption });
    expect(result.structuredContent).toEqual({ covers: [{ path: "work/covers/v1r-cover-0.png" }], postCaption: "work/covers/v1-caption.txt" });

    const request = engineRequests.at(-1);
    expect(argumentAfter(request, "--video")).toBe("v1r");
    const captionPath = argumentAfter(request, "--post-caption");
    expect(captionPath.startsWith(fixture.projectRoot)).toBe(true);
    expect(await readFile(captionPath, "utf8")).toBe(postCaption);
  });
});

async function writeProjectFile(fixture: ToolFixture, relPath: string, content: string): Promise<void> {
  await mkdir(dirname(join(fixture.projectRoot, relPath)), { recursive: true });
  await writeFile(join(fixture.projectRoot, relPath), content);
}

/** A draft render cancelled mid-run, as job_cancel leaves it. */
async function interruptedRender(fixture: ToolFixture): Promise<string> {
  const { promise: renderStarted, resolve: markStarted } = Promise.withResolvers<void>();
  hangNextRender = markStarted;
  const queued = await callTool(fixture, "render_master", { target: "full", quality: "draft" });
  const jobId = String(queued.structuredContent?.jobId);
  await renderStarted;
  await callTool(fixture, "job_cancel", { jobId });
  expect((await callTool(fixture, "job_status", { jobId })).structuredContent).toMatchObject({ status: "interrupted" });
  return jobId;
}

describe("export_deliverable", () => {
  it("gates job_resume on an interrupted export, and a declined resume leaves it interrupted", async () => {
    const { fixture } = await editedProject();
    await writeProjectFile(fixture, "work/out/v1-4k.mp4", "master bytes");
    const [job] = await server.database.db
      .insert(jobs)
      .values({
        projectId: fixture.context.projectId,
        kind: "export_deliverable",
        videoId: "v1",
        lane: "cpu",
        status: "interrupted",
        params: { kinds: ["full"] },
      })
      .returning();
    const jobId = job?.id ?? expect.fail("no export job row");

    const result = await callTool(fixture, "job_resume", { jobId });

    expect(result.isError).toBe(true);
    expect(fixture.approvalCards).toMatchObject([
      { tool: "mcp__studio__export_deliverable", facts: { outputPaths: [`deliverables/${basename(fixture.projectRoot)}-4k.mp4`] } },
    ]);
    expect((await callTool(fixture, "job_status", { jobId })).structuredContent).toMatchObject({ status: "interrupted" });
  });

  it("exports the QC'd master and a cover through a cpu job and returns each file's SHA-256", async () => {
    const { fixture } = await editedProject();
    await writeProjectFile(fixture, "work/out/v1-4k.mp4", "master bytes");
    await writeProjectFile(fixture, "work/covers/v1-cover-a.png", "cover bytes");

    const result = await callTool(fixture, "export_deliverable", { kinds: ["full", "cover_a"] });
    expect(result.isError).toBeUndefined();
    const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
    expect(result.structuredContent).toEqual({
      deliverables: [
        { kind: "full", path: `deliverables/${basename(fixture.projectRoot)}-4k.mp4`, sha256: sha256("master bytes") },
        { kind: "cover_a", path: "deliverables/cover-A.png", sha256: sha256("cover bytes") },
      ],
    });
    const [exportJob] = await server.database.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.projectId, fixture.context.projectId), eq(jobs.kind, "export_deliverable")));
    expect(exportJob).toMatchObject({ lane: "cpu", status: "succeeded" });
    expect(engineRequests.at(-1)).toMatchObject({ command: "qc-status", args: ["--video", "v1"] });
  });

  it("refuses the export when the master failed QC, and delivers nothing", async () => {
    const { fixture } = await editedProject();
    await writeProjectFile(fixture, "work/out/v1-4k.mp4", "frozen master bytes");
    failNextQcStatus = true;
    try {
      const result = await callTool(fixture, "export_deliverable", { kinds: ["full"] });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("failed QC");
      expect(await readdir(join(fixture.projectRoot, "deliverables")).catch(() => [])).toEqual([]);
    } finally {
      failNextQcStatus = false;
    }
  });
});

describe("catalog", () => {
  it("serves the render and export tools with their approval modes", () => {
    expect(STUDIO_TOOLS_BY_NAME.get("render_master")?.contract.approval).toBe("gate");
    expect(STUDIO_TOOLS_BY_NAME.get("export_deliverable")?.contract.approval).toBe("gate");
    expect(["qc_master", "check_motion", "make_covers"].every((name) => STUDIO_TOOLS_BY_NAME.has(name))).toBe(true);
  });
});
