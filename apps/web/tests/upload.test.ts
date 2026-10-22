// Created by The Angelo Umali.
import { CSRF_HEADER, UPLOAD_FILENAME_HEADER } from "@zks/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { UploadError, uploadFile } from "../src/api/upload.ts";
import { FakeUploadRequest, PROJECT_ID, makeAsset } from "./fakes.ts";

function startUpload(onProgress: (fraction: number) => void = () => undefined) {
  const file = new File(["frames"], "Beach día.mp4", { type: "video/mp4" });
  const result = uploadFile({ projectId: PROJECT_ID, file, onProgress, createRequest: () => new FakeUploadRequest() });
  const request = FakeUploadRequest.instances.at(-1);
  if (!request) throw new Error("no request was created");
  return { file, result, request };
}

describe("uploadFile", () => {
  beforeEach(() => {
    FakeUploadRequest.instances.length = 0;
  });

  it("streams the file to the project's media route with the CSRF and filename headers", async () => {
    const { file, result, request } = startUpload();
    request.respond(201, makeAsset());
    await result;

    expect(request.method).toBe("POST");
    expect(request.url).toBe(`/api/projects/${PROJECT_ID}/media`);
    expect(request.headers.get(CSRF_HEADER)).toBeTruthy();
    expect(request.headers.get(UPLOAD_FILENAME_HEADER)).toBe(encodeURIComponent("Beach día.mp4"));
    expect(request.headers.get("content-type")).toBe("application/octet-stream");
    expect(request.body).toBe(file);
  });

  it("reports progress as a 0..1 fraction", async () => {
    const fractions: number[] = [];
    const { result, request } = startUpload((fraction) => fractions.push(fraction));
    request.progress(25, 100);
    request.progress(100, 100);
    request.respond(201, makeAsset());
    await result;

    expect(fractions).toEqual([0.25, 1]);
  });

  it("resolves with the validated media asset", async () => {
    const { result, request } = startUpload();
    request.respond(201, makeAsset({ name: "beach.mp4" }));

    await expect(result).resolves.toMatchObject({ name: "beach.mp4", width: 3840 });
  });

  it("rejects with the server's message on a non-2xx status", async () => {
    const { result, request } = startUpload();
    request.respond(415, { error: "Not a video file" });

    await expect(result).rejects.toEqual(new UploadError("Not a video file", 415));
  });

  it("rejects when the connection drops", async () => {
    const { result, request } = startUpload();
    request.fail();

    await expect(result).rejects.toBeInstanceOf(UploadError);
  });
});
