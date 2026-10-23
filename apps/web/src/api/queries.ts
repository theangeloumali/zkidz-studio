// Created by The Angelo Umali.
import { queryOptions } from "@tanstack/react-query";
import { fetchConnection, fetchDoctorChecks } from "./agent-client.ts";
import { fetchMedia, fetchProject, fetchProjects } from "./client.ts";

export const queryKeys = {
  projects: ["projects"] as const,
  project: (projectId: string) => ["projects", projectId] as const,
  media: (projectId: string) => ["projects", projectId, "media"] as const,
  terminal: (projectId: string) => ["projects", projectId, "terminal"] as const,
  connection: ["connection"] as const,
  doctor: ["doctor"] as const,
};

export const projectsQuery = () => queryOptions({ queryKey: queryKeys.projects, queryFn: fetchProjects });
export const projectQuery = (projectId: string) => queryOptions({ queryKey: queryKeys.project(projectId), queryFn: () => fetchProject(projectId) });
export const mediaQuery = (projectId: string) => queryOptions({ queryKey: queryKeys.media(projectId), queryFn: () => fetchMedia(projectId) });
export const connectionQuery = () => queryOptions({ queryKey: queryKeys.connection, queryFn: fetchConnection });
export const doctorQuery = () => queryOptions({ queryKey: queryKeys.doctor, queryFn: () => fetchDoctorChecks() });
