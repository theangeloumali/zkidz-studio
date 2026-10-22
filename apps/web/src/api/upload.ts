// Created by The Angelo Umali.
import { API_ROUTES, CSRF_HEADER, MediaAssetSchema, UPLOAD_FILENAME_HEADER, type MediaAsset } from "@zks/shared";
import { csrfToken, errorMessageFrom, routeUrl } from "./client.ts";

/** The slice of XMLHttpRequest an upload uses. fetch() cannot report upload progress, so this stays XHR (plan §9.4). */
export interface UploadRequest {
  readonly upload: { onprogress: ((event: ProgressEvent) => void) | null };
  readonly status: number;
  readonly responseText: string;
  onload: ((event: ProgressEvent) => void) | null;
  onerror: ((event: ProgressEvent) => void) | null;
  onabort: ((event: ProgressEvent) => void) | null;
  open(method: string, url: string): void;
  setRequestHeader(name: string, value: string): void;
  send(body: Blob): void;
  abort(): void;
}

export class UploadError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "UploadError";
  }
}

interface UploadOptions {
  readonly projectId: string;
  readonly file: File;
  readonly onProgress: (fraction: number) => void;
  readonly signal?: AbortSignal;
  readonly createRequest?: () => UploadRequest;
}

export function uploadFile({ projectId, file, onProgress, signal, createRequest = () => new XMLHttpRequest() }: UploadOptions): Promise<MediaAsset> {
  return new Promise((resolve, reject) => {
    const request = createRequest();
    request.open(API_ROUTES.uploadMedia.method, routeUrl(API_ROUTES.uploadMedia.path, { projectId }));
    request.setRequestHeader(CSRF_HEADER, csrfToken());
    // Header values must be ASCII, so non-Latin names travel percent-encoded.
    request.setRequestHeader(UPLOAD_FILENAME_HEADER, encodeURIComponent(file.name));
    request.setRequestHeader("content-type", "application/octet-stream");

    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
    request.onload = () => settleUpload(request, resolve, reject);
    request.onerror = () => reject(new UploadError("The connection to the studio dropped during the upload.", 0));
    request.onabort = () => reject(new UploadError("Upload cancelled.", 0));
    signal?.addEventListener("abort", () => request.abort(), { once: true });
    request.send(file);
  });
}

function settleUpload(request: UploadRequest, resolve: (asset: MediaAsset) => void, reject: (error: UploadError) => void): void {
  const body = parseJson(request.responseText);
  if (request.status < 200 || request.status >= 300) {
    reject(new UploadError(errorMessageFrom(body, `Upload failed (${request.status}).`), request.status));
    return;
  }
  const asset = MediaAssetSchema.safeParse(body);
  if (asset.success) resolve(asset.data);
  else reject(new UploadError("The studio sent back an unexpected reply.", request.status));
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
