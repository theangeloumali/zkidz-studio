// Created by The Angelo Umali.
import { existsSync } from "node:fs";
import { LOOPBACK_LITERAL_HOSTS } from "@zks/shared";

/** Files the Docker and Podman runtimes create in every container; a stray ZKS_CONTAINER=1 on a host has neither. */
export const CONTAINER_MARKER_PATHS: readonly string[] = ["/.dockerenv", "/run/.containerenv"];

export class NonLoopbackBindError extends Error {
  override readonly name = "NonLoopbackBindError";

  constructor(host: string, reason = "the server binds loopback only (ZKS_CONTAINER=1 is for the Docker image alone)") {
    super(`Refusing to listen on ${JSON.stringify(host)}: ${reason}.`);
  }
}

export function assertLoopbackHost(host: string, reason?: string): void {
  if (!LOOPBACK_LITERAL_HOSTS.has(host)) throw new NonLoopbackBindError(host, reason);
}

export function hasContainerMarker(pathExists: (path: string) => boolean = existsSync): boolean {
  return CONTAINER_MARKER_PATHS.some((markerPath) => pathExists(markerPath));
}
