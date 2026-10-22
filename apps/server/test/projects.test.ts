// Created by The Angelo Umali.
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { ProjectSchema } from "@zks/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { PROJECT_DIRS, projectDir } from "../src/config.ts";
import { createTestServer, getRequest, postJson, type TestServer } from "./support/test-server.ts";

let server: TestServer;
beforeAll(async () => {
  server = await createTestServer();
});
afterAll(async () => {
  await server.close();
});

async function createProject(title: string) {
  const response = await postJson(server, "/api/projects", { title });
  expect(response.status).toBe(201);
  return ProjectSchema.parse(await response.json());
}

describe("projects", () => {
  it("creates a project with a slug from its title and its folders under ZKS_HOME", async () => {
    const project = await createProject("  Mga Kwento: Ep 30!  ");
    expect(project).toMatchObject({ slug: "mga-kwento-ep-30", title: "Mga Kwento: Ep 30!", status: "draft", videoId: "v1" });
    for (const folder of PROJECT_DIRS) expect((await stat(join(projectDir(server.studioHome, project.slug), folder))).isDirectory()).toBe(true);
  });

  it("gives a repeated title the next free slug", async () => {
    const first = await createProject("Same Title");
    const second = await createProject("Same Title");
    expect([first.slug, second.slug]).toEqual(["same-title", "same-title-2"]);
  });

  it("falls back to a generic slug when the title has no usable characters", async () => {
    expect((await createProject("日本語")).slug).toMatch(/^project(-\d+)?$/);
  });

  it("rejects a blank or unknown-field body with 400 and no stack", async () => {
    for (const body of [{ title: "   " }, { title: "ok", extra: true }, "not json"]) {
      const response = await postJson(server, "/api/projects", body);
      expect(response.status).toBe(400);
      const payload: unknown = await response.json();
      expect(z.strictObject({ error: z.string() }).safeParse(payload).success).toBe(true);
      expect(JSON.stringify(payload)).not.toContain("    at ");
    }
  });

  it("lists projects newest first and reads one by id", async () => {
    const project = await createProject("Listed");
    const listing = (await (await getRequest(server, "/api/projects")).json()) as { projects: unknown[] };
    expect(listing.projects.map((entry) => ProjectSchema.parse(entry).id)[0]).toBe(project.id);
    const fetched = await getRequest(server, `/api/projects/${project.id}`);
    expect(ProjectSchema.parse(await fetched.json())).toEqual(project);
  });

  it("answers 404 for an unknown or malformed project id", async () => {
    expect((await getRequest(server, `/api/projects/${crypto.randomUUID()}`)).status).toBe(404);
    expect((await getRequest(server, "/api/projects/not-a-uuid")).status).toBe(404);
  });
});
