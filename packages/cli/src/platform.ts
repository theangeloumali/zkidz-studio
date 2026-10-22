// Created by The Angelo Umali.
import path from "node:path";
import { ENV } from "@zks/shared";

export const PLATFORM_KEYS = ["linux-x64", "linux-arm64", "win-x64", "win-arm64", "mac-arm64"] as const;
export type PlatformKey = (typeof PLATFORM_KEYS)[number];

const OS_PREFIX: Partial<Record<NodeJS.Platform, string>> = { linux: "linux", win32: "win", darwin: "mac" };
const APP_DIR = "zkidz-studio";

export function platformKey(nodePlatform: NodeJS.Platform = process.platform, arch: string = process.arch): PlatformKey {
  const candidate = `${OS_PREFIX[nodePlatform] ?? nodePlatform}-${arch}`;
  const supported = PLATFORM_KEYS.find((key) => key === candidate);
  if (!supported) throw new Error(`Unsupported platform ${candidate}; supported: ${PLATFORM_KEYS.join(", ")}`);
  return supported;
}

interface HomeContext {
  env: Record<string, string | undefined>;
  nodePlatform: NodeJS.Platform;
  homeDir: string;
}

/** Plan §3.3 defaults; ZKS_HOME always wins. */
export function defaultZksHome({ env, nodePlatform, homeDir }: HomeContext): string {
  const override = env[ENV.home];
  if (override) return override;
  if (nodePlatform === "win32") return path.win32.join(env.LOCALAPPDATA ?? path.win32.join(homeDir, "AppData", "Local"), APP_DIR);
  if (nodePlatform === "darwin") return path.posix.join(homeDir, "Library", "Application Support", APP_DIR);
  return path.posix.join(env.XDG_DATA_HOME ?? path.posix.join(homeDir, ".local", "share"), APP_DIR);
}

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
