// Created by The Angelo Umali.
// The server's security boundary (plan §11). Mount `middleware` before every route.
import { randomBytes } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { confinePath, openConfined, type ConfinedFile } from "./confine-path.ts";
import { assertLoopbackHost, CONTAINER_MARKER_PATHS, hasContainerMarker } from "./loopback-bind.ts";
import { createRequestGuard } from "./request-guards.ts";

export { PathEscapeError, type PathEscapeReason } from "./confine-path.ts";
export { NonLoopbackBindError } from "./loopback-bind.ts";

export interface SecurityConfig {
  readonly appPort: number;
  readonly previewPort: number;
  /** True only inside the Docker image (ZKS_CONTAINER=1), where the port mapping stands in for the loopback bind. */
  readonly container: boolean;
  /** Injectable for tests; defaults to checking CONTAINER_MARKER_PATHS on disk. */
  readonly containerMarkerPresent?: () => boolean;
}

export interface Security {
  readonly middleware: MiddlewareHandler;
  /** Per-launch value of CSRF_HEADER; also sent on every guarded response for same-origin script to read. */
  readonly csrfToken: string;
  readonly assertLoopbackBind: (host: string) => void;
  /** Resolves `candidatePath` against `rootDir` to a realpath inside it, or throws PathEscapeError. */
  readonly confinePath: (rootDir: string, candidatePath: string) => Promise<string>;
  /** confinePath plus a race-free open: serve bytes from `handle`, never by reopening `realPath`. Caller closes it. */
  readonly openConfined: (rootDir: string, candidatePath: string) => Promise<ConfinedFile>;
}

const CSRF_TOKEN_BYTES = 32;
const MISSING_MARKER_REASON = `ZKS_CONTAINER=1 is set but no container marker (${CONTAINER_MARKER_PATHS.join(", ")}) exists`;

export function createSecurity(config: SecurityConfig): Security {
  const csrfToken = randomBytes(CSRF_TOKEN_BYTES).toString("base64url");
  const containerMarkerPresent = config.containerMarkerPresent ?? (() => hasContainerMarker());
  return {
    middleware: createRequestGuard({ appPort: config.appPort, previewPort: config.previewPort, csrfToken }),
    csrfToken,
    // The env var alone never opens a wildcard bind: a runtime marker must confirm we are in a container.
    assertLoopbackBind: (host) => {
      if (!config.container) assertLoopbackHost(host);
      else if (!containerMarkerPresent()) assertLoopbackHost(host, MISSING_MARKER_REASON);
    },
    confinePath,
    openConfined,
  };
}
