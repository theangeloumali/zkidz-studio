// Created by The Angelo Umali.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createSecurity, NonLoopbackBindError } from "../../src/security/index.ts";
import { CONTAINER_MARKER_PATHS, hasContainerMarker } from "../../src/security/loopback-bind.ts";

const SERVER_MAIN = fileURLToPath(new URL("../../src/main.ts", import.meta.url));
const SPAWN_TIMEOUT_MS = 60_000;

function securityFor(container: boolean, containerMarkerPresent = () => true) {
  return createSecurity({ appPort: 4317, previewPort: 4318, container, containerMarkerPresent });
}

describe("assertLoopbackBind", () => {
  it.each(["127.0.0.1", "::1", "[::1]"])("allows the loopback address %s", (host) => {
    expect(() => securityFor(false).assertLoopbackBind(host)).not.toThrow();
  });

  it.each(["0.0.0.0", "::", "", "192.168.1.10", "10.0.0.5", "localhost", "127.0.0.1.evil.example", "::ffff:0.0.0.0", "example.com"])(
    "refuses to bind %j outside a container",
    (host) => {
      expect(() => securityFor(false).assertLoopbackBind(host)).toThrow(NonLoopbackBindError);
    },
  );

  it("with a container marker, allows a wildcard bind, where the port mapping provides isolation", () => {
    expect(() => securityFor(true, () => true).assertLoopbackBind("0.0.0.0")).not.toThrow();
  });

  it("without a container marker, refuses a wildcard bind even when ZKS_CONTAINER=1", () => {
    const security = securityFor(true, () => false);
    expect(() => security.assertLoopbackBind("0.0.0.0")).toThrow(NonLoopbackBindError);
    expect(() => security.assertLoopbackBind("0.0.0.0")).toThrow(/no container marker/);
  });

  it("without a container marker, still allows loopback when ZKS_CONTAINER=1", () => {
    expect(() => securityFor(true, () => false).assertLoopbackBind("127.0.0.1")).not.toThrow();
  });

  it("never probes for a marker outside container mode", () => {
    let probed = false;
    const security = securityFor(false, () => {
      probed = true;
      return true;
    });
    expect(() => security.assertLoopbackBind("0.0.0.0")).toThrow(NonLoopbackBindError);
    expect(probed).toBe(false);
  });
});

describe("hasContainerMarker", () => {
  it("checks the Docker and Podman runtime markers", () => {
    expect(CONTAINER_MARKER_PATHS).toEqual(["/.dockerenv", "/run/.containerenv"]);
  });

  it.each(CONTAINER_MARKER_PATHS)("is true when %s exists", (markerPath) => {
    expect(hasContainerMarker((candidatePath) => candidatePath === markerPath)).toBe(true);
  });

  it("is false when no marker exists", () => {
    expect(hasContainerMarker(() => false)).toBe(false);
  });
});

const hostHasContainerMarker = CONTAINER_MARKER_PATHS.some((markerPath) => existsSync(markerPath));

describe.skipIf(hostHasContainerMarker)("server start with ZKS_CONTAINER=1 on a host without a marker", () => {
  it(
    "refuses to start",
    () => {
      const studioHome = mkdtempSync(join(tmpdir(), "zks-bind-"));
      try {
        const result = spawnSync(process.execPath, [SERVER_MAIN], {
          // ZKS_FFMPEG skips the tool lookup; the bind check runs before ffprobe is needed.
          env: { PATH: process.env.PATH, ZKS_HOME: studioHome, ZKS_CONTAINER: "1", ZKS_FFMPEG: join(studioHome, "ffmpeg") },
          encoding: "utf8",
          timeout: SPAWN_TIMEOUT_MS,
        });
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("NonLoopbackBindError");
        expect(result.stderr).toContain("no container marker");
      } finally {
        rmSync(studioHome, { recursive: true, force: true });
      }
    },
    SPAWN_TIMEOUT_MS,
  );
});
