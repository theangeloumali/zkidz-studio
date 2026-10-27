// Created by The Angelo Umali.
// GET /api/media/:assetId with Range. Only registered files are served: uploads through confinePath, in-place files only
// while their path still resolves to the realpath recorded at registration. GET …/videos/:videoId/proxy serves the
// video's ingest proxy, the one file the live preview plays.
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { extname } from "node:path";
import { Readable } from "node:stream";
import type { StudioDatabase } from "@zks/db";
import { mediaAssets, projects } from "@zks/db/schema";
import { API_ROUTES, BaseVideoIdSchema, IdSchema } from "@zks/shared";
import { eq } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { projectDir } from "../config.ts";
import { notFound } from "../http/http-error.ts";
import { parseByteRange } from "../media-io/range.ts";
import type { Security } from "../security/index.ts";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  "3gp": "video/3gpp",
  "3g2": "video/3gpp2",
  mkv: "video/x-matroska",
  webm: "video/webm",
  avi: "video/x-msvideo",
  ts: "video/mp2t",
  mts: "video/mp2t",
  m2ts: "video/mp2t",
  m4a: "audio/mp4",
  mka: "audio/x-matroska",
  wav: "audio/wav",
  mp3: "audio/mpeg",
  flac: "audio/flac",
  aac: "audio/aac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  webp: "image/webp",
};

export interface MediaStreamDeps {
  readonly database: StudioDatabase;
  readonly studioHome: string;
  readonly confinePath: Security["confinePath"];
}

export function registerMediaStreamRoute(app: Hono, deps: MediaStreamDeps): void {
  app.get(API_ROUTES.streamMedia.path, async (c) => streamFile(c, await resolveRegisteredFile(deps, c.req.param("assetId"))));
  app.get(API_ROUTES.streamProxy.path, async (c) => streamFile(c, await resolveProxyFile(deps, c.req.param("projectId"), c.req.param("videoId"))));
}

async function streamFile(c: Context, filePath: string): Promise<Response> {
  const { size } = await stat(filePath);
  const headers: Record<string, string> = {
    "accept-ranges": "bytes",
    "content-type": CONTENT_TYPES[extname(filePath).slice(1).toLowerCase()] ?? "application/octet-stream",
    "cross-origin-resource-policy": "same-origin",
  };
  const range = parseByteRange(c.req.header("range"), size);
  if (range === "unsatisfiable") return c.body(null, 416, { ...headers, "content-range": `bytes */${size}` });
  const { start, end } = range ?? { start: 0, end: size - 1 };
  const body = size === 0 ? new Uint8Array(0) : Readable.toWeb(createReadStream(filePath, { start, end }));
  headers["content-length"] = String(size === 0 ? 0 : end - start + 1);
  if (range === null) return c.body(body, 200, headers);
  return c.body(body, 206, { ...headers, "content-range": `bytes ${start}-${end}/${size}` });
}

async function resolveProxyFile(deps: MediaStreamDeps, rawProjectId: string | undefined, rawVideoId: string | undefined): Promise<string> {
  const projectId = IdSchema.safeParse(rawProjectId);
  const videoId = BaseVideoIdSchema.safeParse(rawVideoId);
  if (!projectId.success || !videoId.success) throw notFound();
  const [project] = await deps.database.select({ slug: projects.slug }).from(projects).where(eq(projects.id, projectId.data));
  if (project === undefined) throw notFound();
  return deps.confinePath(projectDir(deps.studioHome, project.slug), `work/mezz/${videoId.data}.mp4`).catch(() => {
    throw notFound();
  });
}

async function resolveRegisteredFile(deps: MediaStreamDeps, rawAssetId: string): Promise<string> {
  const assetId = IdSchema.safeParse(rawAssetId);
  if (!assetId.success) throw notFound();
  const [asset] = await deps.database
    .select({ relPath: mediaAssets.relPath, inPlacePath: mediaAssets.inPlacePath, slug: projects.slug })
    .from(mediaAssets)
    .innerJoin(projects, eq(projects.id, mediaAssets.projectId))
    .where(eq(mediaAssets.id, assetId.data));
  if (asset === undefined) throw notFound();
  if (asset.relPath !== null) return deps.confinePath(projectDir(deps.studioHome, asset.slug), asset.relPath);
  if (asset.inPlacePath === null) throw notFound();
  const currentPath = await realpath(asset.inPlacePath).catch(() => null);
  if (currentPath !== asset.inPlacePath) throw notFound();
  return currentPath;
}
