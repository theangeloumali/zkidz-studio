// Created by The Angelo Umali.
import { queryOptions } from "@tanstack/react-query";
import { API_ROUTES, type ProjectStyle } from "@zks/shared";
import { requestJson, routeUrl } from "../api/client.ts";

const { getProjectStyle, setProjectStyle } = API_ROUTES;

export const styleQueryKey = (projectId: string) => ["projects", projectId, "style"] as const;

export async function fetchProjectStyle(projectId: string): Promise<ProjectStyle | null> {
  const { style } = await requestJson(getProjectStyle.response, routeUrl(getProjectStyle.path, { projectId }));
  return style;
}

export const projectStyleQuery = (projectId: string) => queryOptions({ queryKey: styleQueryKey(projectId), queryFn: () => fetchProjectStyle(projectId) });

/** `null` drops the project's look and falls back to the shipped theme. */
export async function saveProjectStyle(projectId: string, style: ProjectStyle | null): Promise<ProjectStyle | null> {
  const saved = await requestJson(setProjectStyle.response, routeUrl(setProjectStyle.path, { projectId }), { method: setProjectStyle.method, body: { style } });
  return saved.style;
}
