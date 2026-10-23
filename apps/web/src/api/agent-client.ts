// Created by The Angelo Umali.
import { API_ROUTES } from "@zks/shared";
import { z } from "zod";
import { requestJson, routeUrl } from "./client.ts";

export type Connection = z.infer<typeof API_ROUTES.getConnection.response>;
export type CloudProvider = z.infer<typeof API_ROUTES.connectCloud.body>["provider"];
export type DoctorCheck = z.infer<typeof API_ROUTES.getDoctor.response>["checks"][number];
export type DecisionRequest = z.infer<typeof API_ROUTES.decide.body>;

export function fetchConnection() {
  return requestJson(API_ROUTES.getConnection.response, API_ROUTES.getConnection.path);
}

export function connectApiKey(apiKey: string) {
  return requestJson(API_ROUTES.connectApiKey.response, API_ROUTES.connectApiKey.path, { method: "POST", body: { apiKey } });
}

export type CloudSettings = z.infer<typeof API_ROUTES.connectCloud.body>;

export function connectCloud(settings: CloudSettings) {
  return requestJson(API_ROUTES.connectCloud.response, API_ROUTES.connectCloud.path, { method: "POST", body: settings });
}

export function connectTerminal() {
  return requestJson(API_ROUTES.connectTerminal.response, API_ROUTES.connectTerminal.path, { method: "POST", body: { hasAcceptedDisclosure: true } });
}

export async function fetchDoctorChecks() {
  const { checks } = await requestJson(API_ROUTES.getDoctor.response, API_ROUTES.getDoctor.path);
  return checks;
}

export function submitPrompt(projectId: string, text: string) {
  return requestJson(API_ROUTES.submitPrompt.response, routeUrl(API_ROUTES.submitPrompt.path, { projectId }), { method: "POST", body: { text } });
}

export function decide(projectId: string, decision: DecisionRequest) {
  return requestJson(API_ROUTES.decide.response, routeUrl(API_ROUTES.decide.path, { projectId }), { method: "POST", body: decision });
}

export function stopTurn(projectId: string) {
  return requestJson(API_ROUTES.stopTurn.response, routeUrl(API_ROUTES.stopTurn.path, { projectId }), { method: "POST" });
}

export function fetchTerminalTicket(sessionId: string) {
  return requestJson(API_ROUTES.terminalTicket.response, routeUrl(API_ROUTES.terminalTicket.path, { sessionId }), { method: "POST" });
}

/** Starts (or returns the live) Claude Code PTY for a project. */
export function openTerminal(projectId: string) {
  return requestJson(API_ROUTES.openTerminal.response, routeUrl(API_ROUTES.openTerminal.path, { projectId }), { method: "POST" });
}
