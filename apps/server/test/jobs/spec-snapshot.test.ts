// Created by The Angelo Umali.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { editSpecs, editSpecVersions } from "@zks/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProjectDirs, projectDir } from "../../src/config.ts";
import { activeSpecSnapshotDir, snapshotRenderJobSpecs, snapshotSpecsAtStart, specSnapshotDir } from "../../src/jobs/spec-snapshot.ts";
import { createTestServer, insertProject, type TestServer } from "../support/test-server.ts";
import { newRunner, readJob, startedSignal } from "./job-test-kit.ts";

let server: TestServer;
beforeAll(async () => {
  server = await createTestServer();
});
afterAll(async () => {
  await server.close();
});

const RENDER_JOB_KINDS = ["render_master", "qc_master", "check_motion", "make_covers"];
const CUTS_V1 = `{"removals":[]}\n`;
const CUTS_V2 = `{"removals":[{"at":1,"end":2}]}\n`;

async function projectWithCutSpec() {
  const project = await insertProject(server);
  await createProjectDirs(server.studioHome, project.slug);
  const [spec] = await server.database.db
    .insert(editSpecs)
    .values({ projectId: project.id, videoId: "v1", kind: "cuts", relPath: "work/cuts/v1.json", currentVersion: 1 })
    .returning();
  if (spec === undefined) throw new Error("spec insert returned no row");
  await server.database.db.insert(editSpecVersions).values({ specId: spec.id, version: 1, sha256: "a", content: CUTS_V1, author: "agent" });
  return { project, specId: spec.id, projectRoot: projectDir(server.studioHome, project.slug) };
}

/** What an agent edit does mid-render: a new version row becomes current. */
async function editSpecMidRender(specId: string) {
  await server.database.db.insert(editSpecVersions).values({ specId, version: 2, sha256: "b", content: CUTS_V2, author: "agent" });
  await server.database.db.update(editSpecs).set({ currentVersion: 2 }).where(eq(editSpecs.id, specId));
}

describe("spec snapshot at job start", () => {
  it("renders the spec set captured at start, not a spec edited mid-render", async () => {
    const { project, specId, projectRoot } = await projectWithCutSpec();
    const runner = newRunner(server);
    let renderedCuts = "";
    const deps = { database: server.database.db, studioHome: server.studioHome };
    runner.registerHandler(
      "render_master",
      snapshotSpecsAtStart(async (job) => {
        await editSpecMidRender(specId);
        renderedCuts = await readFile(join(specSnapshotDir(projectRoot, job.specSnapshotSha256 ?? ""), "cuts", "v1.json"), "utf8");
      }, deps),
    );
    const job = await runner.enqueue({ projectId: project.id, kind: "render_master", videoId: "v1", lane: "gpu" });
    await runner.idle();

    expect((await readJob(server, job.id)).status).toBe("succeeded");
    expect(renderedCuts).toBe(CUTS_V1);
    expect((await readJob(server, job.id)).specSnapshotSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("names the snapshot by content, so the same spec set gets the same hash", async () => {
    const { project } = await projectWithCutSpec();
    const runner = newRunner(server);
    const deps = { database: server.database.db, studioHome: server.studioHome };
    runner.registerHandler(
      "render_master",
      snapshotSpecsAtStart(() => Promise.resolve(), deps),
    );
    const first = await runner.enqueue({ projectId: project.id, kind: "render_master", videoId: "v1", lane: "gpu" });
    const second = await runner.enqueue({ projectId: project.id, kind: "render_master", videoId: "v1", lane: "gpu" });
    await runner.idle();
    expect((await readJob(server, first.id)).specSnapshotSha256).toBe((await readJob(server, second.id)).specSnapshotSha256);
  });

  it("keeps the first snapshot when an interrupted job resumes", async () => {
    const { project, specId } = await projectWithCutSpec();
    const runner = newRunner(server);
    const deps = { database: server.database.db, studioHome: server.studioHome };
    const firstAttempt = startedSignal();
    runner.registerHandler(
      "render_master",
      snapshotSpecsAtStart(async (job, _reportProgress, signal) => {
        if (job.attempt > 0) return;
        await editSpecMidRender(specId);
        firstAttempt.markStarted();
        await new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("engine killed")), { once: true }));
      }, deps),
    );
    const job = await runner.enqueue({ projectId: project.id, kind: "render_master", videoId: "v1", lane: "gpu" });
    await firstAttempt.hasStarted;
    await runner.cancel(job.id);
    const firstSnapshot = (await readJob(server, job.id)).specSnapshotSha256;
    expect(firstSnapshot).toMatch(/^[0-9a-f]{64}$/);

    await runner.resume(job.id);
    await runner.idle();
    expect(await readJob(server, job.id)).toMatchObject({ status: "succeeded", specSnapshotSha256: firstSnapshot });
  });

  it("points the engine at the job's snapshot while its handler runs", async () => {
    const { project, projectRoot } = await projectWithCutSpec();
    const runner = newRunner(server);
    const deps = { database: server.database.db, studioHome: server.studioHome };
    let engineSpecsDir: string | undefined;
    runner.registerHandler(
      "render_master",
      snapshotSpecsAtStart(() => {
        engineSpecsDir = activeSpecSnapshotDir();
        return Promise.resolve();
      }, deps),
    );
    const job = await runner.enqueue({ projectId: project.id, kind: "render_master", videoId: "v1", lane: "gpu" });
    await runner.idle();

    const { specSnapshotSha256 } = await readJob(server, job.id);
    expect(engineSpecsDir).toBe(specSnapshotDir(projectRoot, specSnapshotSha256 ?? ""));
    expect(activeSpecSnapshotDir()).toBeUndefined();
  });

  it("snapshots every render job kind the production handlers register", async () => {
    const { project, projectRoot } = await projectWithCutSpec();
    const runner = newRunner(server);
    const seen = new Map<string, string | undefined>();
    for (const kind of RENDER_JOB_KINDS) {
      runner.registerHandler(kind, () => {
        seen.set(kind, activeSpecSnapshotDir());
        return Promise.resolve();
      });
    }
    snapshotRenderJobSpecs(runner, { database: server.database.db, studioHome: server.studioHome });
    for (const kind of RENDER_JOB_KINDS) {
      await runner.enqueue({ projectId: project.id, kind, videoId: "v1", lane: "gpu" });
    }
    await runner.idle();

    expect([...seen.keys()]).toEqual(RENDER_JOB_KINDS);
    for (const specsDir of seen.values()) expect(specsDir?.startsWith(join(projectRoot, "work", "snapshots"))).toBe(true);
  });
});
