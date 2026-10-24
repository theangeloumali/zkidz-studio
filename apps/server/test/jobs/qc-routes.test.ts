// Created by The Angelo Umali.
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { API_ROUTES } from "@zks/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { projectDir } from "../../src/config.ts";
import { createTestServer, getRequest, insertProject, type TestServer } from "../support/test-server.ts";

let server: TestServer;
beforeAll(async () => {
  server = await createTestServer();
});
afterAll(async () => {
  await server.close();
});

const GATES = ["format", "frames", "loudness", "motion", "cutWords", "captionContrast", "hookMouth", "lipSync"];

async function projectWithMaster() {
  const project = await insertProject(server);
  const workDir = join(projectDir(server.studioHome, project.slug), "work");
  await mkdir(join(workDir, "out"), { recursive: true });
  await mkdir(join(workDir, "qc"), { recursive: true });
  const masterPath = join(workDir, "out", `${project.videoId}-4k.mp4`);
  await writeFile(masterPath, "master");
  return { project, workDir, masterPath };
}

/** As qc_master writes it (qc/__init__.py master_record): the judged master's work-relative path, and mtimeNs as a string. */
async function writeReport(workDir: string, videoId: string, masterPath: string, failing: string | null) {
  const { size, mtimeNs } = await stat(masterPath, { bigint: true });
  const checks = GATES.map((name) => ({ name, ok: name !== failing, detail: name === failing ? "frozen 2.0–4.5 s" : "pass" }));
  const master = { relPath: `out/${videoId}-4k.mp4`, size: Number(size), mtimeNs: String(mtimeNs), sha256: "0".repeat(64) };
  await writeFile(join(workDir, "qc", `${videoId}.json`), JSON.stringify({ master, ok: failing === null, checks }, null, 2));
}

async function readChecks(projectId: string) {
  const response = await getRequest(server, `/api/projects/${projectId}/qc`);
  expect(response.status).toBe(200);
  return API_ROUTES.listQcChecks.response.parse(await response.json()).checks;
}

describe("QC checks route", () => {
  it("lists every gate as pending before QC has run", async () => {
    const project = await insertProject(server);

    const checks = await readChecks(project.id);

    expect(checks.map((check) => check.id)).toEqual(GATES);
    expect(checks.every((check) => check.status === "pending" && check.detail === null)).toBe(true);
  });

  it("shows each gate's verdict for the latest master", async () => {
    const { project, workDir, masterPath } = await projectWithMaster();
    await writeReport(workDir, project.videoId, masterPath, "motion");

    const checks = await readChecks(project.id);

    expect(checks.find((check) => check.id === "motion")).toMatchObject({ label: "Moving footage", status: "fail", detail: "frozen 2.0–4.5 s" });
    expect(checks.find((check) => check.id === "loudness")).toMatchObject({ status: "pass", detail: null });
  });

  it("goes back to pending once a newer master replaces the one QC judged", async () => {
    const { project, workDir, masterPath } = await projectWithMaster();
    await writeReport(workDir, project.videoId, masterPath, null);
    await writeFile(masterPath, "re-rendered master");

    const checks = await readChecks(project.id);

    expect(checks.every((check) => check.status === "pending")).toBe(true);
    expect(checks[0]?.detail).toBe("The master changed after this check ran");
  });

  it("adds the Reels cut's gates once a Reels master exists", async () => {
    const { project, workDir } = await projectWithMaster();
    await writeFile(join(workDir, "out", `${project.videoId}r.mp4`), "reel master");

    const checks = await readChecks(project.id);

    expect(checks).toHaveLength(GATES.length * 2);
    expect(checks.at(-1)).toEqual({ id: "reel:lipSync", label: "Reels: Lip sync", status: "pending", detail: null });
  });

  it("answers 404 for an unknown project", async () => {
    const response = await getRequest(server, "/api/projects/00000000-0000-4000-8000-00000000dead/qc");
    expect(response.status).toBe(404);
  });
});
