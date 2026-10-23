// Created by The Angelo Umali.
import { CSRF_HEADER, type MediaAsset, type Project } from "@zks/shared";
import type { UploadRequest } from "../src/api/upload.ts";
import type { EventSourceLike } from "../src/events/connection.ts";

export const PROJECT_ID = "5f0c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f";

export function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: PROJECT_ID,
    slug: "beach-day",
    title: "Beach day",
    status: "draft",
    videoId: "v1",
    createdAt: "2026-10-20T10:00:00.000Z",
    updatedAt: "2026-10-21T10:00:00.000Z",
    ...overrides,
  };
}

export function makeAsset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: "0b6f8c2a-1d3e-4f5a-9b7c-2d4e6f8a0b1c",
    projectId: PROJECT_ID,
    kind: "camera",
    name: "beach.mp4",
    bytes: 1_500_000_000,
    isInPlace: false,
    durationS: 107,
    width: 3840,
    height: 2160,
    fps: { num: 30000, den: 1001 },
    isHdr: true,
    createdAt: "2026-10-21T10:00:00.000Z",
    ...overrides,
  };
}

export class FakeUploadRequest implements UploadRequest {
  static readonly instances: FakeUploadRequest[] = [];
  readonly upload: UploadRequest["upload"] = { onprogress: null };
  readonly headers = new Map<string, string>();
  method = "";
  url = "";
  body: Blob | null = null;
  status = 0;
  responseText = "";
  onload: UploadRequest["onload"] = null;
  onerror: UploadRequest["onerror"] = null;
  onabort: UploadRequest["onabort"] = null;

  constructor() {
    FakeUploadRequest.instances.push(this);
  }

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers.set(name.toLowerCase(), value);
  }

  send(body: Blob): void {
    this.body = body;
  }

  abort(): void {
    this.onabort?.(new ProgressEvent("abort"));
  }

  progress(loaded: number, total: number): void {
    this.upload.onprogress?.(new ProgressEvent("progress", { lengthComputable: true, loaded, total }));
  }

  respond(status: number, body: unknown): void {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.(new ProgressEvent("load"));
  }

  fail(): void {
    this.onerror?.(new ProgressEvent("error"));
  }
}

export class FakeEventSource implements EventSourceLike {
  static readonly instances: FakeEventSource[] = [];
  readyState = 0;
  onopen: EventSourceLike["onopen"] = null;
  onmessage: EventSourceLike["onmessage"] = null;
  onerror: EventSourceLike["onerror"] = null;
  isClosed = false;

  readonly url: string;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  close(): void {
    this.readyState = 2;
    this.isClosed = true;
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }

  emit(data: string, lastEventId = ""): void {
    this.onmessage?.(new MessageEvent("message", { data, lastEventId }));
  }

  /** readyState 0: the browser retries itself; 2: it gave up. */
  error(readyState: 0 | 2): void {
    this.readyState = readyState;
    this.onerror?.(new Event("error"));
  }
}

export const TEST_CSRF_TOKEN = "test-launch-token";

/** Like the real server, every response carries the launch CSRF token. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", [CSRF_HEADER]: TEST_CSRF_TOKEN } });
}
