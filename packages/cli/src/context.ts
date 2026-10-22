// Created by The Angelo Umali.
import { chmodSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultZksHome, loadToolsLock, platformKey, ZKS_HOME_DIRS, type PlatformKey, type ToolsLock } from "@zks/shared/node";
import { uvEnvironment } from "./platform.ts";

export interface ZksContext {
  home: string;
  toolsDir: string;
  modelsDir: string;
  platform: PlatformKey;
  lock: ToolsLock;
}

const OWNER_ONLY = 0o700;

export function resolveZksHome(): string {
  return path.resolve(defaultZksHome({ env: process.env, platform: process.platform, homeDir: os.homedir() }));
}

export function createContext(): ZksContext {
  const home = resolveZksHome();
  // Children (uv python find, setup) inherit these, matching what the setup scripts exported.
  Object.assign(process.env, uvEnvironment(home, process.env));
  return { home, toolsDir: path.join(home, "tools"), modelsDir: path.join(home, "models"), platform: platformKey(), lock: loadToolsLock() };
}

export function ensureHomeLayout({ home }: ZksContext): void {
  for (const subdir of ZKS_HOME_DIRS) mkdirSync(path.join(home, subdir), { recursive: true, mode: OWNER_ONLY });
  // mkdir's mode does not tighten a directory that already exists.
  if (process.platform !== "win32") chmodSync(home, OWNER_ONLY);
}
