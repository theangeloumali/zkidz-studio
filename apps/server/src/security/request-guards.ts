// Created by The Angelo Umali.
// Browser-facing request guards (plan §11): Host allowlist, fetch metadata, and Origin + CSRF + JSON on writes.
import { timingSafeEqual } from "node:crypto";
import { API_ROUTES, CSRF_HEADER, isStateChangingMethod, LOOPBACK_HOST } from "@zks/shared";
import type { Context, MiddlewareHandler } from "hono";
import { applySecurityHeaders, buildSecurityHeaders } from "./security-headers.ts";

export interface RequestGuardConfig {
  readonly appPort: number;
  readonly previewPort: number;
  readonly csrfToken: string;
}

type RejectionReason = "host" | "framed" | "fetch-site" | "origin" | "csrf" | "content-type";

const FRAME_DESTINATIONS: ReadonlySet<string> = new Set(["iframe", "frame", "embed", "object", "fencedframe"]);
const ALWAYS_ALLOWED_FETCH_SITES: ReadonlySet<string> = new Set(["same-origin", "none"]);
const FOREIGN_FETCH_SITES: ReadonlySet<string> = new Set(["cross-site", "same-site"]);
const STREAMED_UPLOAD_ROUTES = Object.values(API_ROUTES)
  .filter((route) => "body" in route && route.body === "binary")
  .map((route) => ({ method: route.method, pattern: new RegExp(`^${route.path.replace(/:[A-Za-z]+/g, "[^/]+")}$`) }));

export function createRequestGuard(config: RequestGuardConfig): MiddlewareHandler {
  const allowedHosts: ReadonlySet<string> = new Set([`${LOOPBACK_HOST}:${config.appPort}`, `localhost:${config.appPort}`, `[::1]:${config.appPort}`]);
  const securityHeaders = buildSecurityHeaders(config.previewPort);

  return async (c, next) => {
    const rejectionReason = findRejectionReason(c, { allowedHosts, csrfToken: config.csrfToken });
    if (rejectionReason !== null) {
      const rejection = c.json({ error: `Forbidden: ${rejectionReason}` }, 403);
      applySecurityHeaders(rejection.headers, securityHeaders);
      return rejection;
    }
    await next();
    applySecurityHeaders(c.res.headers, securityHeaders);
    // Readable only by same-origin script: the server never grants CORS, so no other origin sees response headers.
    c.res.headers.set(CSRF_HEADER, config.csrfToken);
  };
}

function findRejectionReason(c: Context, guard: { allowedHosts: ReadonlySet<string>; csrfToken: string }): RejectionReason | null {
  const host = c.req.header("host")?.toLowerCase();
  if (host === undefined || !guard.allowedHosts.has(host)) return "host";
  if (FRAME_DESTINATIONS.has(c.req.header("sec-fetch-dest")?.toLowerCase() ?? "")) return "framed";
  if (!isFetchSiteAllowed(c)) return "fetch-site";
  if (!isStateChangingMethod(c.req.method)) return null;

  // Exact same-origin: the scheme and the Host the browser actually used.
  if (c.req.header("origin") !== `http://${host}`) return "origin";
  if (!isLaunchToken(c.req.header(CSRF_HEADER), guard.csrfToken)) return "csrf";
  if (mediaTypeOf(c.req.header("content-type")) !== expectedMediaType(c)) return "content-type";
  return null;
}

/** Browsers omit Origin on same-origin GETs, so reads are guarded by Sec-Fetch-Site instead (plan §11). */
function isFetchSiteAllowed(c: Context): boolean {
  const fetchSite = c.req.header("sec-fetch-site")?.toLowerCase();
  if (fetchSite === undefined || ALWAYS_ALLOWED_FETCH_SITES.has(fetchSite)) return true;
  if (!FOREIGN_FETCH_SITES.has(fetchSite)) return false;
  // c.req.path is the decoded path the router matches, so "/%61pi" counts as an API route.
  if (c.req.path.toLowerCase().startsWith("/api")) return false;
  // A link from another site may open the app page, but never load it as a subresource.
  return c.req.header("sec-fetch-mode") === "navigate" && c.req.header("sec-fetch-dest") === "document";
}

function isLaunchToken(presentedToken: string | undefined, csrfToken: string): boolean {
  if (presentedToken === undefined) return false;
  const presentedBytes = Buffer.from(presentedToken);
  const expectedBytes = Buffer.from(csrfToken);
  return presentedBytes.length === expectedBytes.length && timingSafeEqual(presentedBytes, expectedBytes);
}

function mediaTypeOf(contentType: string | undefined): string | undefined {
  return contentType?.split(";")[0]?.trim().toLowerCase();
}

function expectedMediaType(c: Context): string {
  const isStreamedUpload = STREAMED_UPLOAD_ROUTES.some((route) => route.method === c.req.method && route.pattern.test(c.req.path));
  return isStreamedUpload ? "application/octet-stream" : "application/json";
}
