// Created by The Angelo Umali.
import { API_ROUTES, CSRF_HEADER, isStateChangingMethod } from "@zks/shared";
import { z } from "zod";

/** The server may inject the per-launch token here; the header's presence is what the Origin check pairs with (ADR 0006). */
const CSRF_META_SELECTOR = 'meta[name="zks-csrf"]';
const CSRF_FALLBACK = "1";

// No shared error DTO exists yet; accept either common shape and fall back to the status text.
const ErrorBodySchema = z.object({ error: z.string().optional(), message: z.string().optional() });

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

export function csrfToken(): string {
  return document.querySelector<HTMLMetaElement>(CSRF_META_SELECTOR)?.content || CSRF_FALLBACK;
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
  if (isStateChangingMethod(method)) headers.set(CSRF_HEADER, csrfToken());
  if (options.body !== undefined) headers.set("content-type", "application/json");

  const response = await fetch(url, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(errorMessageFrom(body, response.statusText || `Request failed (${response.status})`), response.status);
  return schema.parse(body);
}

export async function fetchProjects() {
  const { projects } = await requestJson(API_ROUTES.listProjects.response, API_ROUTES.listProjects.path);
  return projects;
}

export function fetchProject(projectId: string) {
  return requestJson(API_ROUTES.getProject.response, routeUrl(API_ROUTES.getProject.path, { projectId }));
}

export function createProject(title: string) {
  return requestJson(API_ROUTES.createProject.response, API_ROUTES.createProject.path, { method: "POST", body: { title } });
}

export async function fetchMedia(projectId: string) {
  const { assets } = await requestJson(API_ROUTES.listMedia.response, routeUrl(API_ROUTES.listMedia.path, { projectId }));
  return assets;
}

export function registerInPlace(projectId: string, path: string) {
  return requestJson(API_ROUTES.registerInPlace.response, routeUrl(API_ROUTES.registerInPlace.path, { projectId }), { method: "POST", body: { path } });
}

export function listFolder(path: string | undefined) {
  const query = path === undefined ? "" : `?${new URLSearchParams({ path }).toString()}`;
  return requestJson(API_ROUTES.listFolder.response, `${API_ROUTES.listFolder.path}${query}`);
}
