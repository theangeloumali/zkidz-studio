// Created by The Angelo Umali.
import { API_ROUTES } from "@zks/shared";
import type { DatabaseCheck } from "@zks/shared/node";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestServer, getRequest, type TestServer } from "../support/test-server.ts";

/** What `zks doctor --json` prints: CLI statuses, plus fields the web never sees. */
const CLI_REPORT = {
  ok: false,
  checks: [
    { id: "ffmpeg", status: "ok", required: true, detail: "7.1 with NVENC", data: { path: "~/bin/ffmpeg" } },
    { id: "chrome", status: "fail", required: true, detail: "not installed", fix: "run: pnpm zks setup" },
    { id: "port", status: "fail", required: true, detail: "4317 is in use" },
    { id: "something-new", status: "warn", required: false, detail: "later CLI check" },
  ],
};
const EMBEDDED: DatabaseCheck = { id: "database", status: "ok", required: true, detail: "Embedded database (PGlite)" };

// One server per test, booted in the hook: a PGlite boot takes up to ~30 s on a loaded machine, past the 5 s test timeout.
// Each test swaps in its own doctor before its first request; the fresh server keeps the cache per test.
let server: TestServer;
let runDoctor: () => Promise<unknown> = () => Promise.resolve(CLI_REPORT);
let databaseCheck: DatabaseCheck = EMBEDDED;
beforeEach(async () => {
  runDoctor = () => Promise.resolve(CLI_REPORT);
  databaseCheck = EMBEDDED;
  server = await createTestServer({ doctor: { runDoctor: () => runDoctor(), checkDatabase: () => Promise.resolve(databaseCheck) } });
});
afterEach(async () => {
  await server.close();
});

function serverWith(doctor: () => Promise<unknown>): TestServer {
  runDoctor = doctor;
  return server;
}

describe("GET /api/doctor", () => {
  it("answers the web contract: pass/warn/fail rows with labels, without the server's own port", async () => {
    const app = serverWith(() => Promise.resolve(CLI_REPORT));
    const response = await getRequest(app, API_ROUTES.getDoctor.path);

    expect(response.status).toBe(200);
    expect(API_ROUTES.getDoctor.response.parse(await response.json())).toEqual({
      checks: [
        { id: "ffmpeg", label: "ffmpeg", status: "pass", detail: "7.1 with NVENC" },
        { id: "chrome", label: "Chrome", status: "fail", detail: "not installed", fix: "run: pnpm zks setup" },
        { id: "something-new", label: "something-new", status: "warn", detail: "later CLI check" },
        { id: "database", label: "Data backend", status: "pass", detail: "Embedded database (PGlite)" },
      ],
    });
  });

  // The doctor child never sees DATABASE_URL, so on Postgres its own database row would still say PGlite.
  it("reports the server's own database check in place of the doctor child's", async () => {
    const app = serverWith(() =>
      Promise.resolve({ checks: [...CLI_REPORT.checks, { id: "database", status: "ok", required: true, detail: "Embedded database (PGlite)" }] }),
    );
    databaseCheck = {
      id: "database",
      status: "fail",
      required: true,
      detail: "Postgres at 127.0.0.1:45322, but port 45322 answers on 192.0.2.10",
      fix: "Publish Postgres on 127.0.0.1:45322 only",
    };

    const { checks } = API_ROUTES.getDoctor.response.parse(await (await getRequest(app, API_ROUTES.getDoctor.path)).json());

    expect(checks.filter((check) => check.id === "database")).toEqual([
      { id: "database", label: "Data backend", status: "fail", detail: databaseCheck.detail, fix: "Publish Postgres on 127.0.0.1:45322 only" },
    ]);
  });

  it("runs the checks once and serves the cached rows until ?refresh=1", async () => {
    let runs = 0;
    const app = serverWith(() => Promise.resolve(void (runs += 1)).then(() => CLI_REPORT));

    await getRequest(app, "/api/doctor");
    await getRequest(app, "/api/doctor");
    expect(runs).toBe(1);

    expect((await getRequest(app, "/api/doctor?refresh=1")).status).toBe(200);
    expect(runs).toBe(2);
  });

  it("answers a 500 with a plain message when the checks cannot run, and retries on the next request", async () => {
    let runs = 0;
    const app = serverWith(() => {
      runs += 1;
      return runs === 1 ? Promise.reject(new Error("spawn node ENOENT")) : Promise.resolve(CLI_REPORT);
    });

    const failed = await getRequest(app, "/api/doctor");
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "The system checks could not run; see the server log" });
    expect((await getRequest(app, "/api/doctor")).status).toBe(200);
    expect(runs).toBe(2);
  });

  it("logs the CLI's own error when the doctor could not run at all", async () => {
    const app = serverWith(() => Promise.resolve({ ok: false, error: "EACCES: permission denied, open '$ZKS_HOME/capabilities.json'" }));

    expect((await getRequest(app, "/api/doctor")).status).toBe(500);
    expect(app.logLines.some((line) => line.includes("doctor checks failed") && line.includes("EACCES: permission denied"))).toBe(true);
  });

  it("rejects a report that does not match the CLI's shape instead of passing it on", async () => {
    const app = serverWith(() => Promise.resolve({ checks: [{ id: "node", status: "maybe" }] }));
    expect((await getRequest(app, "/api/doctor")).status).toBe(500);
  });
});
