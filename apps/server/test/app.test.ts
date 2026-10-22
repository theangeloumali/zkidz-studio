// Created by The Angelo Umali.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSecurity } from "../src/security/index.ts";
import { connectionFrom, createTestServer, getRequest, TEST_HOST, type TestServer } from "./support/test-server.ts";

let guarded: TestServer;
let plain: TestServer;
beforeAll(async () => {
  guarded = await createTestServer({ security: createSecurity({ appPort: 4317, previewPort: 4318, container: false }) });
  plain = await createTestServer();
  await mkdir(join(plain.scratchDir, "web-dist", "assets"), { recursive: true });
  await writeFile(join(plain.scratchDir, "web-dist", "index.html"), "<!doctype html><title>studio</title>");
  await writeFile(join(plain.scratchDir, "web-dist", "assets", "app.js"), "console.log(1)");
});
afterAll(async () => {
  await Promise.all([guarded.close(), plain.close()]);
});

describe("createApp", () => {
  it("mounts the security middleware before every route", async () => {
    const response = await guarded.app.request(
      "/api/projects",
      { method: "POST", headers: { host: TEST_HOST, "content-type": "application/json" }, body: JSON.stringify({ title: "x" }) },
      connectionFrom("127.0.0.1"),
    );
    expect(response.status).toBe(403);
    expect((await getRequest(guarded, "/api/projects")).status).toBe(200);
    expect((await guarded.app.request("/api/projects", { headers: { host: "evil.example:4317" } }, connectionFrom("127.0.0.1"))).status).toBe(403);
  });

  it("answers unknown API routes with a JSON 404", async () => {
    const response = await getRequest(plain, "/api/nope");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
  });

  it("turns an unexpected failure into a stack-free 500 and a redacted log line", async () => {
    const broken = await createTestServer();
    await broken.database.close();
    const response = await getRequest(broken, "/api/projects");
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Internal server error" });
    expect(broken.logLines.some((line) => line.includes('"level":"error"'))).toBe(true);
    await broken.close().catch(() => undefined);
  });

  it("serves the built web app, falling back to index.html for client routes", async () => {
    const index = await getRequest(plain, "/");
    expect(index.status).toBe(200);
    expect(await index.text()).toContain("<title>studio</title>");
    expect(await (await getRequest(plain, "/assets/app.js")).text()).toBe("console.log(1)");
    expect(await (await getRequest(plain, "/projects/abc")).text()).toContain("<title>studio</title>");
  });

  it("answers 404 when the web app has not been built", async () => {
    expect((await getRequest(guarded, "/")).status).toBe(404);
  });
});
