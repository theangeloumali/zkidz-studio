// Created by The Angelo Umali.
import { rules } from "@zks/db/schema";
import { API_ROUTES, UPLOAD_FILENAME_HEADER } from "@zks/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSON_BODY_MAX_BYTES } from "../../src/http/json-body-limit.ts";
import { connectionFrom, createTestServer, insertProject, TEST_HOST, type TestServer } from "../support/test-server.ts";

let server: TestServer;
beforeAll(async () => {
  server = await createTestServer();
});
afterAll(async () => {
  await server.close();
});

function post(path: string, body: string, contentType: string) {
  return server.app.request(path, { method: "POST", headers: { host: TEST_HOST, "content-type": contentType }, body }, connectionFrom("127.0.0.1"));
}
/** A valid JSON body padded past the cap, so only its size can be refused. */
const oversizedRule = () => JSON.stringify({ text: "Keep cuts short", sourceQuote: " ".repeat(JSON_BODY_MAX_BYTES) });

describe("JSON body limit", () => {
  it("refuses an oversized JSON body with 413 before parsing it", async () => {
    const response = await post(API_ROUTES.createRule.path, oversizedRule(), "application/json");

    expect(response.status).toBe(413);
    expect(await server.database.db.select().from(rules)).toEqual([]);
  });

  it("refuses it whatever content type the client claims", async () => {
    expect((await post(API_ROUTES.createRule.path, oversizedRule(), "text/plain")).status).toBe(413);
  });

  it("still accepts a JSON body under the cap", async () => {
    expect((await post(API_ROUTES.createRule.path, JSON.stringify({ text: "Keep cuts short" }), "application/json")).status).toBe(201);
  });

  it("leaves the binary upload routes to their own caps", async () => {
    const project = await insertProject(server);
    const uploadPath = API_ROUTES.uploadMedia.path.replace(":projectId", project.id);
    const notMedia = new Uint8Array(JSON_BODY_MAX_BYTES * 2);
    const response = await server.app.request(
      uploadPath,
      { method: "POST", headers: { host: TEST_HOST, "content-type": "application/octet-stream", [UPLOAD_FILENAME_HEADER]: "clip.mp4" }, body: notMedia },
      connectionFrom("127.0.0.1"),
    );

    expect(response.status).not.toBe(413);
  });
});
