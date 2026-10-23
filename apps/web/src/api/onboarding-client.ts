// Created by The Angelo Umali.
import { API_ROUTES, type StartTemplateRequest } from "@zks/shared";
import { requestJson, routeUrl } from "./client.ts";

const { listTemplates, listStylePresets, startTemplate } = API_ROUTES;

export const onboardingQueryKeys = { templates: ["templates"], stylePresets: ["style-presets"] } as const;

export async function fetchTemplates() {
  const { templates } = await requestJson(listTemplates.response, listTemplates.path);
  return templates;
}

export async function fetchStylePresets() {
  const { styles } = await requestJson(listStylePresets.response, listStylePresets.path);
  return styles;
}

export function startProjectTemplate(projectId: string, request: StartTemplateRequest) {
  return requestJson(startTemplate.response, routeUrl(startTemplate.path, { projectId }), { method: startTemplate.method, body: request });
}
