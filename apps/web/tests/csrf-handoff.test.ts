// Created by The Angelo Umali.
import { CSRF_HEADER } from "@zks/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeUploadRequest, PROJECT_ID, makeAsset, makeProject } from "./fakes.ts";

const LAUNCH_TOKEN = "per-launch-token";

/** Mirrors the server guard: every response carries the launch token, and a write without it gets 403. */
function stubGuardedServer() {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const headers = { "content-type": "application/json", [CSRF_HEADER]: LAUNCH_TOKEN };
    if (method !== "GET" && new Headers(init?.headers).get(CSRF_HEADER) !== LAUNCH_TOKEN) {
      return Promise.resolve(new Response(JSON.stringify({ error: "Forbidden: csrf" }), { status: 403 }));
    }
    const body = method === "POST" && url === "/api/projects" ? makeProject() : { projects: [] };
    return Promise.resolve(new Response(JSON.stringify(body), { status: method === "POST" ? 201 : 200, headers }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// A fresh module per test, so the token cache starts empty like a freshly loaded page.
async function loadApi() {
  vi.resetModules();
  const client = await import("../src/api/client.ts");
  const upload = await import("../src/api/upload.ts");
  return { ...client, ...upload };
}

describe("CSRF token handoff", () => {
  beforeEach(() => {
    FakeUploadRequest.instances.length = 0;
  });

  it("fetches the launch token before the first write when no response has carried it yet", async () => {
    const fetchMock = stubGuardedServer();
    const { createProject } = await loadApi();

    await expect(createProject("Beach day")).resolves.toMatchObject({ id: PROJECT_ID });
    expect(fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${url}`)).toEqual(["GET /api/projects", "POST /api/projects"]);
  });

  it("reuses the token from an earlier read without another round trip", async () => {
    const fetchMock = stubGuardedServer();
    const { createProject, fetchProjects } = await loadApi();

    await fetchProjects();
    await createProject("Beach day");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("sends the launch token on an upload", async () => {
    stubGuardedServer();
    const { uploadFile } = await loadApi();

    const result = uploadFile({
      projectId: PROJECT_ID,
      file: new File(["frames"], "beach.mp4"),
      onProgress: () => undefined,
      createRequest: () => new FakeUploadRequest(),
    });
    const request = await vi.waitFor(() => {
      const created = FakeUploadRequest.instances.at(-1);
      if (!created) throw new Error("no upload request yet");
      return created;
    });
    request.respond(201, makeAsset());

    await result;
    expect(request.headers.get(CSRF_HEADER)).toBe(LAUNCH_TOKEN);
  });
});
