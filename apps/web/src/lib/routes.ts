// Created by The Angelo Umali.
export const ROUTE_PATHS = {
  home: "/",
  setup: "/setup",
  editor: "/p/:projectId",
  render: "/p/:projectId/render",
  rules: "/rules",
  style: "/setup/style",
} as const;

export function editorPath(projectId: string): string {
  return `/p/${encodeURIComponent(projectId)}`;
}

export function renderPath(projectId: string): string {
  return `${editorPath(projectId)}/render`;
}
