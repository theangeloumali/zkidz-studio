// Created by The Angelo Umali.
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { deliverables } from "@zks/db/schema";
import { DeliverableSchema } from "@zks/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProjectDirs, projectDir } from "../../src/config.ts";
import { exportDeliverables, registerExportHandler, toDeliverableDto } from "../../src/jobs/deliverables.ts";
import type { EngineProcessRequest } from "../../src/jobs/engine-process.ts";
import { createTestServer, insertProject, type TestServer } from "../support/test-server.ts";
import { newRunner, readJob } from "./job-test-kit.ts";

let server: TestServer;
beforeAll(async () => {
  server = await createTestServer();
});
afterAll(async () => {
  await server.close();
});

const sha256Of = (content: string) => createHash("sha256").update(content).digest("hex");

/** Stands in for `zks-engine qc-status`: passes unless the video is listed as failing, and records every call. */
function fakeQcEngine(failingVideos: readonly string[] = []) {
  const requests: EngineProcessRequest[] = [];
  const engine = {
    run: (request: EngineProcessRequest) => {
      requests.push(request);
      const video = request.args[request.args.indexOf("--video") + 1] ?? "";
      if (failingVideos.includes(video)) return Promise.reject(new Error(`zks-engine qc-status failed: ${video} failed QC (motion)`));
      return Promise.resolve({ ok: true });
    },
  };
  return { engine, requests };
}

/** The paths the engine writes: render-master's work/out/<v>[-4k|-draft].mp4 and make-covers' work/covers/<v>-cover-<x>.png. */
async function projectWithMasters(failingVideos: readonly string[] = []) {
  const project = await insertProject(server);
  await createProjectDirs(server.studioHome, project.slug);
  const projectRoot = projectDir(server.studioHome, project.slug);
  const writeSource = async (relPath: string, content: string) => {
    await mkdir(dirname(join(projectRoot, relPath)), { recursive: true });
    await writeFile(join(projectRoot, relPath), content);
  };
  await writeSource("work/out/v1-4k.mp4", "full master bytes");
  await writeSource("work/out/v1r-4k.mp4", "reels master bytes");
  await writeSource("work/covers/v1-cover-a.png", "cover a bytes");
  const qc = fakeQcEngine(failingVideos);
  const deps = { database: server.database.db, studioHome: server.studioHome, engine: qc.engine };
  return { project, projectRoot, deps, writeSource, qcRequests: qc.requests };
}

describe("export deliverables", () => {
  it("copies each master into deliverables/ and records its SHA-256", async () => {
    const { project, projectRoot, deps } = await projectWithMasters();

    const exported = await exportDeliverables(deps, { projectId: project.id, videoId: "v1", kinds: ["full", "reels", "cover_a"], jobId: null });

    expect(exported).toEqual([
      { kind: "full", path: `deliverables/${project.slug}-4k.mp4`, sha256: sha256Of("full master bytes") },
      { kind: "reels", path: `deliverables/reels-${project.slug}-4k.mp4`, sha256: sha256Of("reels master bytes") },
      { kind: "cover_a", path: "deliverables/cover-A.png", sha256: sha256Of("cover a bytes") },
    ]);
    expect(await readFile(join(projectRoot, "deliverables", `${project.slug}-4k.mp4`), "utf8")).toBe("full master bytes");
    const rows = await server.database.db.select().from(deliverables).where(eq(deliverables.projectId, project.id));
    expect(rows.map((row) => [row.kind, row.bytes, row.sha256]).sort()).toEqual(
      [
        ["cover_a", 13, sha256Of("cover a bytes")],
        ["full", 17, sha256Of("full master bytes")],
        ["reels", 18, sha256Of("reels master bytes")],
      ].sort(),
    );
  });

  it("exports a CPU render's 1080 master as <v>.mp4, named by its resolution", async () => {
    const project = await insertProject(server);
    await createProjectDirs(server.studioHome, project.slug);
    const projectRoot = projectDir(server.studioHome, project.slug);
    await mkdir(join(projectRoot, "work", "out"), { recursive: true });
    await writeFile(join(projectRoot, "work", "out", "v1.mp4"), "cpu master");
    const deps = { database: server.database.db, studioHome: server.studioHome, engine: fakeQcEngine().engine };

    const exported = await exportDeliverables(deps, { projectId: project.id, videoId: "v1", kinds: ["full"], jobId: null });

    expect(exported).toEqual([{ kind: "full", path: `deliverables/${project.slug}-1080.mp4`, sha256: sha256Of("cpu master") }]);
  });

  it("exports the newest master, as the engine's QC judged it", async () => {
    const { project, deps, writeSource, projectRoot } = await projectWithMasters();
    await writeSource("work/out/v1-draft.mp4", "newer draft");
    const anHourAgo = new Date(Date.now() - 3_600_000);
    await utimes(join(projectRoot, "work", "out", "v1-4k.mp4"), anHourAgo, anHourAgo);

    const exported = await exportDeliverables(deps, { projectId: project.id, videoId: "v1", kinds: ["full"], jobId: null });

    expect(exported).toEqual([{ kind: "full", path: `deliverables/${project.slug}-draft.mp4`, sha256: sha256Of("newer draft") }]);
  });

  it("asks the engine's QC gate about every master it exports before copying", async () => {
    const { project, deps, qcRequests, projectRoot } = await projectWithMasters();

    await exportDeliverables(deps, { projectId: project.id, videoId: "v1", kinds: ["full", "cover_a", "reels"], jobId: null });

    expect(qcRequests.map((request) => [request.command, ...request.args])).toEqual([
      ["qc-status", "--video", "v1"],
      ["qc-status", "--video", "v1r"],
    ]);
    expect(qcRequests[0]?.workDir).toBe(join(projectRoot, "work"));
  });

  it("blocks the export when QC failed, leaving no file and no row", async () => {
    const { project, projectRoot, deps } = await projectWithMasters(["v1r"]);

    await expect(exportDeliverables(deps, { projectId: project.id, videoId: "v1", kinds: ["full", "reels"], jobId: null })).rejects.toThrow(
      /v1r has not passed QC: .*failed QC \(motion\)/,
    );
    expect(await readdir(join(projectRoot, "deliverables"))).toEqual([]);
    expect(await server.database.db.select().from(deliverables).where(eq(deliverables.projectId, project.id))).toEqual([]);
  });

  it("replaces the earlier deliverable of the same kind on re-export", async () => {
    const { project, deps, writeSource } = await projectWithMasters();
    await exportDeliverables(deps, { projectId: project.id, videoId: "v1", kinds: ["full"], jobId: null });
    await writeSource("work/out/v1-4k.mp4", "re-rendered master");

    await exportDeliverables(deps, { projectId: project.id, videoId: "v1", kinds: ["full"], jobId: null });

    const rows = await server.database.db.select().from(deliverables).where(eq(deliverables.projectId, project.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sha256).toBe(sha256Of("re-rendered master"));
  });

  it("checks every source before copying any, so a missing cover leaves nothing behind", async () => {
    const { project, projectRoot, deps } = await projectWithMasters();

    await expect(exportDeliverables(deps, { projectId: project.id, videoId: "v1", kinds: ["full", "cover_b"], jobId: null })).rejects.toThrow(
      /cover_b: work\/covers\/v1-cover-b\.png is missing; run make_covers first/,
    );
    expect(await readdir(join(projectRoot, "deliverables"))).toEqual([]);
  });

  it("exports make-covers' post caption as caption.txt; a caption is not a render, so it has no QC gate", async () => {
    const { project, deps, qcRequests, writeSource } = await projectWithMasters();
    await writeSource("work/covers/v1-caption.txt", "Beach day #zkidz\n");

    const exported = await exportDeliverables(deps, { projectId: project.id, videoId: "v1", kinds: ["caption_txt"], jobId: null });

    expect(exported).toEqual([{ kind: "caption_txt", path: "deliverables/caption.txt", sha256: sha256Of("Beach day #zkidz\n") }]);
    expect(qcRequests).toEqual([]);
  });

  it("refuses caption.txt until make_covers wrote the post caption", async () => {
    const { project, deps } = await projectWithMasters();

    await expect(exportDeliverables(deps, { projectId: project.id, videoId: "v1", kinds: ["caption_txt"], jobId: null })).rejects.toThrow(
      /caption_txt: work\/covers\/v1-caption\.txt is missing; run make_covers with a postCaption first/,
    );
  });

  it("runs as the export_deliverable job and links each row to it", async () => {
    const { project, deps } = await projectWithMasters();
    const runner = newRunner(server);
    registerExportHandler(runner, deps);

    const job = await runner.enqueue({ projectId: project.id, kind: "export_deliverable", videoId: "v1", lane: "cpu", params: { kinds: ["full"] } });
    await runner.idle();

    expect((await readJob(server, job.id)).status).toBe("succeeded");
    const [row] = await server.database.db.select().from(deliverables).where(eq(deliverables.projectId, project.id));
    expect(row?.jobId).toBe(job.id);
    expect(DeliverableSchema.parse(toDeliverableDto(row ?? expect.fail("no deliverable row")))).toMatchObject({ kind: "full", name: `${project.slug}-4k.mp4` });
  });

  it("fails the export job when QC failed", async () => {
    const { project, projectRoot, deps } = await projectWithMasters(["v1"]);
    const runner = newRunner(server);
    registerExportHandler(runner, deps);

    const job = await runner.enqueue({ projectId: project.id, kind: "export_deliverable", videoId: "v1", lane: "cpu", params: { kinds: ["full"] } });
    await runner.idle();

    const { status, error } = await readJob(server, job.id);
    expect(status).toBe("failed");
    expect(error).toMatch(/v1 has not passed QC/);
    expect(await readdir(join(projectRoot, "deliverables"))).toEqual([]);
  });

  it("fails the job when its params name no deliverable kinds", async () => {
    const { project, deps } = await projectWithMasters();
    const runner = newRunner(server);
    registerExportHandler(runner, deps);

    const job = await runner.enqueue({ projectId: project.id, kind: "export_deliverable", videoId: "v1", lane: "cpu", params: { kinds: ["poster"] } });
    await runner.idle();

    expect(await readJob(server, job.id)).toMatchObject({ status: "failed" });
  });
});
