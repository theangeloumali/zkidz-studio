// Created by The Angelo Umali.
import { API_ROUTES, ApiErrorCodeSchema, CSRF_HEADER, isStateChangingMethod, type ApiErrorCode } from "@zks/shared";
import { z } from "zod";

// The server sends its per-launch token on every response; same-origin script is the only reader (ADR 0006).
let launchCsrfToken: string | null = null;
let pendingTokenFetch: Promise<string> | null = null;

// Looser than the shared ApiErrorBodySchema on purpose: `message` bodies and codes newer than this build still parse.
const ErrorBodySchema = z.object({ error: z.string().optional(), message: z.string().optional(), code: z.string().optional() });

export class ApiError extends Error {
  readonly status: number;
  /** The server's stable reason; UI copy keys off this, never the HTTP status. */
  readonly code: ApiErrorCode | undefined;

  constructor(message: string, status: number, code?: ApiErrorCode) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "ApiError";
  }
}

function rememberCsrfToken(response: Response): void {
  launchCsrfToken = response.headers.get(CSRF_HEADER) ?? launchCsrfToken;
}

/** The launch token, read from a cheap GET first when no response has carried it yet. */
export function ensureCsrfToken(): Promise<string> {
  if (launchCsrfToken !== null) return Promise.resolve(launchCsrfToken);
  pendingTokenFetch ??= fetch(API_ROUTES.listProjects.path)
    .then((response) => {
      rememberCsrfToken(response);
      if (launchCsrfToken === null) throw new ApiError("The studio did not hand out a request token.", response.status);
      return launchCsrfToken;
    })
    .finally(() => {
      pendingTokenFetch = null;
    });
  return pendingTokenFetch;
}

export function routeUrl(path: string, params: Readonly<Record<string, string>> = {}): string {
  return path.replace(/:(\w+)/g, (_match, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`Missing route parameter "${name}" for ${path}`);
    return encodeURIComponent(value);
  });
}

export function errorMessageFrom(body: unknown, fallback: string): string {
  const parsed = ErrorBodySchema.safeParse(body);
  return (parsed.success && (parsed.data.error ?? parsed.data.message)) || fallback;
}

interface RequestOptions {
  readonly method?: string;
  readonly body?: unknown;
}

export async function requestJson<Schema extends z.ZodType>(schema: Schema, url: string, options: RequestOptions = {}): Promise<z.infer<Schema>> {
  const method = options.method ?? "GET";
  const headers = new Headers();
  // Every write carries the JSON type, bodyless ones too (Stop, the terminal ticket): the server's CSRF guard requires it.
  if (isStateChangingMethod(method)) {
    headers.set(CSRF_HEADER, await ensureCsrfToken());
    headers.set("content-type", "application/json");
  }

  const response = await fetch(url, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  rememberCsrfToken(response);
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    // A code this build does not know is dropped, not fatal: the message still shows.
    const code = ApiErrorCodeSchema.safeParse(ErrorBodySchema.safeParse(body).data?.code);
    throw new ApiError(errorMessageFrom(body, response.statusText || `Request failed (${response.status})`), response.status, code.data);
  }
  return schema.parse(body);
}

export async function fetchProjects() {
  const { projects } = await requestJson(API_ROUTES.listProjects.response, API_ROUTES.listProjects.path);
  return projects;
}

export function fetchProject(projectId: string) {
  return requestJson(API_ROUTES.getProject.response, routeUrl(API_ROUTES.getProject.path, { projectId }));
}

export async function fetchMedia(projectId: string) {
  const { assets } = await requestJson(API_ROUTES.listMedia.response, routeUrl(API_ROUTES.listMedia.path, { projectId }));
  return assets;
}

export function createProjectInPlace(path: string, title: string) {
  return requestJson(API_ROUTES.createProjectInPlace.response, API_ROUTES.createProjectInPlace.path, { method: "POST", body: { path, title } });
}

export function listFolder(path: string | undefined) {
  const query = path === undefined ? "" : `?${new URLSearchParams({ path }).toString()}`;
  return requestJson(API_ROUTES.listFolder.response, `${API_ROUTES.listFolder.path}${query}`);
}
