// Created by The Angelo Umali.
// The 4318 preview origin (plan §9.3): a second loopback listener that serves built compositions and nothing else. A
// composition runs agent-authored script, so it gets an origin with no API, no network and no framing but the app's.
import { extname, join } from "node:path";
import { Readable } from "node:stream";
import type { StudioDatabase } from "@zks/db";
import { VideoIdSchema } from "@zks/shared";
import { Hono } from "hono";
import { projectDir } from "../config.ts";
import { HttpError, notFound, toHttpError } from "../http/http-error.ts";
import { findProjectOrThrow } from "../projects/project-store.ts";
import { allowedHostsFor, isAllowedHost } from "../security/request-guards.ts";
import { openConfined } from "../security/confine-path.ts";

export interface PreviewOriginDependencies {
  readonly database: StudioDatabase;
  readonly studioHome: string;
  readonly appPort: number;
  readonly previewPort: number;
}

export const COMPOSITION_PATH_PREFIX = "/compositions";

const COMPOSITION_CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
};

// The sandboxed frame has a null origin, so its @font-face loads are cross-origin and need CORS; nothing else gets it.
const isFontType = (contentType: string) => contentType.startsWith("font/");

/** Where the engine's preview build writes a video's composition inside its project. */
const compositionDirOf = (projectRoot: string, videoId: string) => join(projectRoot, "work", "preview", videoId);

export function createPreviewOrigin(deps: PreviewOriginDependencies): Hono {
  const app = new Hono();
  const allowedHosts = allowedHostsFor(deps.previewPort);
  const previewHeaders = buildPreviewHeaders(deps.appPort);

  app.use("*", async (c, next) => {
    if (isAllowedHost(c.req.header("host"), allowedHosts)) await next();
    else c.res = c.json({ error: "Forbidden: host" }, 403);
    for (const [name, value] of Object.entries(previewHeaders)) c.res.headers.set(name, value);
  });

  app.on(["GET", "HEAD"], `${COMPOSITION_PATH_PREFIX}/:projectId/:videoId/*`, async (c) => {
    const project = await findProjectOrThrow(deps.database, c.req.param("projectId"));
    const videoId = VideoIdSchema.safeParse(c.req.param("videoId"));
    if (!videoId.success) throw notFound();
    const filePrefix = `${COMPOSITION_PATH_PREFIX}/${project.id}/${videoId.data}/`;
    const compositionDir = compositionDirOf(projectDir(deps.studioHome, project.slug), videoId.data);
    const { handle, realPath } = await openConfined(compositionDir, c.req.path.slice(filePrefix.length));
    const contentType = COMPOSITION_CONTENT_TYPES[extname(realPath).toLowerCase()] ?? "application/octet-stream";
    c.header("Content-Type", contentType);
    if (isFontType(contentType)) c.header("Access-Control-Allow-Origin", "*");
    return c.body(Readable.toWeb(handle.createReadStream()));
  });
  app.all("*", (c) => {
    const isReadMethod = c.req.method === "GET" || c.req.method === "HEAD";
    if (!isReadMethod && c.req.path.startsWith(`${COMPOSITION_PATH_PREFIX}/`)) throw new HttpError(405, "Method not allowed");
    throw notFound();
  });

  app.onError((error, c) => {
    const httpError = toHttpError(error);
    return c.json({ error: httpError.message }, httpError.status);
  });
  return app;
}

function buildPreviewHeaders(appPort: number): Readonly<Record<string, string>> {
  // Chrome rejects an IPv6 literal as a CSP source, so the app opened as [::1] cannot frame the preview.
  const frameAncestors = allowedHostsFor(appPort)
    .filter((host) => !host.startsWith("["))
    .map((host) => `http://${host}`)
    .join(" ");
  return {
    // Every Host the app answers to may frame it, or the app opened as localhost shows an empty preview.
    "Content-Security-Policy": `default-src 'self'; connect-src 'none'; frame-ancestors ${frameAncestors}`,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    // A rebuild replaces files in place, so a stale cached script must never mix with a fresh page.
    "Cache-Control": "no-store",
  };
}
