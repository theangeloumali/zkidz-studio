// Created by The Angelo Umali.
import { queryOptions } from "@tanstack/react-query";
import { fetchConnection, fetchDoctorChecks } from "./agent-client.ts";
import { fetchMedia, fetchPlayerEdl, fetchProject, fetchProjects, fetchSpecs, fetchSpecVersion, type SpecAddress } from "./client.ts";

export const queryKeys = {
  projects: ["projects"] as const,
  project: (projectId: string) => ["projects", projectId] as const,
  media: (projectId: string) => ["projects", projectId, "media"] as const,
  terminal: (projectId: string) => ["projects", projectId, "terminal"] as const,
  specs: (projectId: string) => ["projects", projectId, "specs"] as const,
  spec: ({ projectId, videoId, kind }: SpecAddress, version?: number) => ["projects", projectId, "specs", videoId, kind, version ?? "current"] as const,
  playerEdl: (projectId: string, videoId: string, cutsVersion: number) => ["projects", projectId, "edl", videoId, cutsVersion] as const,
  connection: ["connection"] as const,
  doctor: ["doctor"] as const,
};

export const projectsQuery = () => queryOptions({ queryKey: queryKeys.projects, queryFn: fetchProjects });
export const projectQuery = (projectId: string) => queryOptions({ queryKey: queryKeys.project(projectId), queryFn: () => fetchProject(projectId) });
export const mediaQuery = (projectId: string) => queryOptions({ queryKey: queryKeys.media(projectId), queryFn: () => fetchMedia(projectId) });
export const connectionQuery = () => queryOptions({ queryKey: queryKeys.connection, queryFn: fetchConnection });
export const doctorQuery = () => queryOptions({ queryKey: queryKeys.doctor, queryFn: () => fetchDoctorChecks() });
export const specsQuery = (projectId: string) => queryOptions({ queryKey: queryKeys.specs(projectId), queryFn: () => fetchSpecs(projectId) });
// A saved version never changes, so only the current one can go stale.
export const specVersionQuery = (address: SpecAddress, version?: number) =>
  queryOptions({
    queryKey: queryKeys.spec(address, version),
    queryFn: () => fetchSpecVersion(address, version),
    staleTime: version === undefined ? 0 : Infinity,
  });
// Keyed on the cut version, so every new cut spec refetches it; one version's EDL never changes.
export const playerEdlQuery = (projectId: string, videoId: string, cutsVersion: number) =>
  queryOptions({ queryKey: queryKeys.playerEdl(projectId, videoId, cutsVersion), queryFn: () => fetchPlayerEdl(projectId, videoId), staleTime: Infinity });
