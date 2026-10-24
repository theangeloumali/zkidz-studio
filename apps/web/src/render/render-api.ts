// Created by The Angelo Umali.
import { queryOptions } from "@tanstack/react-query";
import { API_ROUTES, type DeliverableSchema } from "@zks/shared";
import type { z } from "zod";
import { requestJson, routeUrl } from "../api/client.ts";
import { queryKeys } from "../api/queries.ts";
import { isJobActive } from "./job-display.ts";

export type Deliverable = z.infer<typeof DeliverableSchema>;

/** Polls only while something renders; SSE resync already refetches everything under the project key. */
const ACTIVE_POLL_MS = 2000;

export const renderQueryKeys = {
  jobs: (projectId: string) => [...queryKeys.project(projectId), "jobs"] as const,
  deliverables: (projectId: string) => [...queryKeys.project(projectId), "deliverables"] as const,
  qc: (projectId: string) => [...queryKeys.project(projectId), "qc"] as const,
  hardware: ["hardware"] as const,
};

function pollWhile(isRendering: boolean): number | false {
  return isRendering ? ACTIVE_POLL_MS : false;
}

async function fetchJobs(projectId: string) {
  const { jobs } = await requestJson(API_ROUTES.listJobs.response, routeUrl(API_ROUTES.listJobs.path, { projectId }));
  return jobs;
}

async function fetchDeliverables(projectId: string) {
  const { deliverables } = await requestJson(API_ROUTES.listDeliverables.response, routeUrl(API_ROUTES.listDeliverables.path, { projectId }));
  return deliverables;
}

async function fetchQcChecks(projectId: string) {
  const { checks } = await requestJson(API_ROUTES.listQcChecks.response, routeUrl(API_ROUTES.listQcChecks.path, { projectId }));
  return checks;
}

function fetchHardware() {
  return requestJson(API_ROUTES.getHardware.response, API_ROUTES.getHardware.path);
}

/** Opens the deliverables folder on the studio machine; the server picks the path (plan §9.1). */
export function revealDeliverables(projectId: string) {
  return requestJson(API_ROUTES.revealDeliverables.response, routeUrl(API_ROUTES.revealDeliverables.path, { projectId }), { method: "POST" });
}

export const jobsQuery = (projectId: string) =>
  queryOptions({
    queryKey: renderQueryKeys.jobs(projectId),
    queryFn: () => fetchJobs(projectId),
    refetchInterval: (query) => pollWhile(query.state.data?.some(isJobActive) ?? false),
  });

export const deliverablesQuery = (projectId: string, isRendering: boolean) =>
  queryOptions({ queryKey: renderQueryKeys.deliverables(projectId), queryFn: () => fetchDeliverables(projectId), refetchInterval: pollWhile(isRendering) });

export const qcChecksQuery = (projectId: string, isRendering: boolean) =>
  queryOptions({ queryKey: renderQueryKeys.qc(projectId), queryFn: () => fetchQcChecks(projectId), refetchInterval: pollWhile(isRendering) });

export const hardwareQuery = (isRendering: boolean) =>
  queryOptions({ queryKey: renderQueryKeys.hardware, queryFn: fetchHardware, refetchInterval: pollWhile(isRendering) });
