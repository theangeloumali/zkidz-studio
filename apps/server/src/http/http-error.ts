// Created by The Angelo Umali.
// Every route failure becomes `{ error }` with a status; nothing else (stacks, SQL, paths) reaches a client.
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { hasErrorCode } from "@zks/db";
import type { z } from "zod";
import { UserPathError } from "../fs/path-policy.ts";
import { MediaRejectedError } from "../media-io/probe.ts";
import { DiskFullError, UploadTooLargeError } from "../media-io/store.ts";
import { PathEscapeError } from "../security/index.ts";

export class HttpError extends Error {
  override readonly name = "HttpError";
  readonly status: ContentfulStatusCode;

  constructor(status: ContentfulStatusCode, message: string) {
    super(message);
    this.status = status;
  }
}

export const notFound = () => new HttpError(404, "Not found");

export function toHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  if (error instanceof HTTPException) return new HttpError(error.status, error.message || "Request failed");
  if (error instanceof UserPathError) return new HttpError(400, error.message);
  if (error instanceof UploadTooLargeError) return new HttpError(413, error.message);
  if (error instanceof DiskFullError) return new HttpError(507, error.message);
  if (error instanceof MediaRejectedError) return new HttpError(415, error.message);
  if (error instanceof PathEscapeError || hasErrorCode(error, "ENOENT")) return notFound();
  return new HttpError(500, "Internal server error");
}

export function parseOrBadRequest<Output>(schema: z.ZodType<Output>, input: unknown): Output {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  const [issue] = parsed.error.issues;
  const fieldPath = issue?.path.join(".") ?? "";
  throw new HttpError(400, `${fieldPath === "" ? "" : `${fieldPath}: `}${issue?.message ?? "Invalid request"}`);
}

export async function readJsonBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json<unknown>();
  } catch {
    throw new HttpError(400, "The body is not valid JSON");
  }
}
