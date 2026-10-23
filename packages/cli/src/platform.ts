// Created by The Angelo Umali.
import path from "node:path";

/** setup.sh / setup.ps1 point uv here; every later uv call must too, or it cannot find the Python setup installed. */
export function uvEnvironment(zksHome: string, env: Record<string, string | undefined>): Record<"UV_PYTHON_INSTALL_DIR" | "UV_CACHE_DIR", string> {
  return {
    UV_PYTHON_INSTALL_DIR: env.UV_PYTHON_INSTALL_DIR ?? path.join(zksHome, "tools", "python"),
    UV_CACHE_DIR: env.UV_CACHE_DIR ?? path.join(zksHome, "cache", "uv"),
  };
}

/** Windows drives under WSL are 9P mounts: slow for renders and lossy for file modes. */
export function isWslDrvfsPath(candidate: string): boolean {
  return /^\/mnt\/[a-z](\/|$)/i.test(candidate);
}
