// Created by The Angelo Umali.
// Browser-facing request guards (plan §11): Host allowlist, fetch metadata, and Origin + CSRF + JSON on writes.
import { API_ROUTES, CSRF_HEADER, isStateChangingMethod, LOOPBACK_HOST } from "@zks/shared";
import type { Context, MiddlewareHandler } from "hono";
import { STUDIO_MCP_ROUTES } from "../tools/mcp-paths.ts";
import { applySecurityHeaders, buildSecurityHeaders } from "./security-headers.ts";
import { tokensMatch } from "./token.ts";

export interface RequestGuardConfig {
  readonly appPort: number;
  readonly previewPort: number;
  readonly csrfToken: string;
}

type RejectionReason = "host" | "framed" | "fetch-site" | "origin" | "csrf" | "content-type" | "bearer";

const FRAME_DESTINATIONS: ReadonlySet<string> = new Set(["iframe", "frame", "embed", "object", "fencedframe"]);
const ALWAYS_ALLOWED_FETCH_SITES: ReadonlySet<string> = new Set(["same-origin", "none"]);
const FOREIGN_FETCH_SITES: ReadonlySet<string> = new Set(["cross-site", "same-site"]);
const STREAMED_UPLOAD_ROUTES = Object.values(API_ROUTES)
  .filter((route) => "body" in route && route.body === "binary")
  .map((route) => ({ method: route.method, pattern: new RegExp(`^${route.path.replace(/:[A-Za-z]+/g, "[^/]+")}$`) }));
const SESSION_ID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
// The hook relay and the MCP twin are not browsers: they carry a per-session bearer, which the route checks, instead
// of Origin + CSRF.
const BEARER_ROUTES = [
  { method: "POST", path: API_ROUTES.terminalHooks.path },
  { method: "GET", path: STUDIO_MCP_ROUTES.listTools },
  { method: "POST", path: STUDIO_MCP_ROUTES.callTool },
].map((route) => ({ method: route.method, pattern: new RegExp(`^${route.path.replace(":sessionId", SESSION_ID_PATTERN)}$`) }));
const BEARER_PREFIX = "Bearer ";

/** The Host values a browser may send for the app (DNS rebinding guard, plan §11). */
export function allowedHostsFor(appPort: number): readonly string[] {
  return [`${LOOPBACK_HOST}:${appPort}`, `localhost:${appPort}`, `[::1]:${appPort}`];
}

export function isAllowedHost(hostHeader: string | undefined, allowedHosts: readonly string[]): boolean {
  return hostHeader !== undefined && allowedHosts.includes(hostHeader.toLowerCase());
}

export function createRequestGuard(config: RequestGuardConfig): MiddlewareHandler {
  const allowedHosts = allowedHostsFor(config.appPort);
  const securityHeaders = buildSecurityHeaders(config.previewPort);

  return async (c, next) => {
    const rejectionReason = findRejectionReason(c, { allowedHosts, csrfToken: config.csrfToken });
    if (rejectionReason !== null) {
      const rejection = rejectionReason === "bearer" ? c.json({ error: "Unauthorized" }, 401) : c.json({ error: `Forbidden: ${rejectionReason}` }, 403);
      applySecurityHeaders(rejection.headers, securityHeaders);
      return rejection;
    }
    await next();
    applySecurityHeaders(c.res.headers, securityHeaders);
    // Readable only by same-origin script: the server never grants CORS, so no other origin sees response headers.
    c.res.headers.set(CSRF_HEADER, config.csrfToken);
  };
}

function findRejectionReason(c: Context, guard: { allowedHosts: readonly string[]; csrfToken: string }): RejectionReason | null {
  const host = c.req.header("host")?.toLowerCase();
  if (host === undefined || !isAllowedHost(host, guard.allowedHosts)) return "host";
  if (FRAME_DESTINATIONS.has(c.req.header("sec-fetch-dest")?.toLowerCase() ?? "")) return "framed";
  if (!isFetchSiteAllowed(c)) return "fetch-site";
  if (isBearerRoute(c)) return findBearerRejection(c, host);
  if (!isStateChangingMethod(c.req.method)) return null;

  // Exact same-origin: the scheme and the Host the browser actually used.
  if (c.req.header("origin") !== `http://${host}`) return "origin";
  if (!tokensMatch(guard.csrfToken, c.req.header(CSRF_HEADER))) return "csrf";
  if (mediaTypeOf(c.req.header("content-type")) !== expectedMediaType(c)) return "content-type";
  return null;
}

function isBearerRoute(c: Context): boolean {
  return BEARER_ROUTES.some((route) => route.method === c.req.method && route.pattern.test(c.req.path));
}

/** No Origin is fine (node callers send none), but a browser's foreign one never is. */
function findBearerRejection(c: Context, host: string): RejectionReason | null {
  const origin = c.req.header("origin");
  if (origin !== undefined && origin !== `http://${host}`) return "origin";
  if (!c.req.header("authorization")?.startsWith(BEARER_PREFIX)) return "bearer";
  if (isStateChangingMethod(c.req.method) && mediaTypeOf(c.req.header("content-type")) !== "application/json") return "content-type";
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

function mediaTypeOf(contentType: string | undefined): string | undefined {
  return contentType?.split(";")[0]?.trim().toLowerCase();
}

function expectedMediaType(c: Context): string {
  const isStreamedUpload = STREAMED_UPLOAD_ROUTES.some((route) => route.method === c.req.method && route.pattern.test(c.req.path));
  return isStreamedUpload ? "application/octet-stream" : "application/json";
}
