// Created by The Angelo Umali.
import { chmodSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadToolsLock, type ToolsLock } from "./lock.ts";
import { defaultZksHome, platformKey, type PlatformKey } from "./platform.ts";

export interface ZksContext {
  home: string;
  toolsDir: string;
  modelsDir: string;
  platform: PlatformKey;
  lock: ToolsLock;
}

const HOME_SUBDIRS = ["db", "backups", "tools", "models", "locks", "projects"] as const;
const OWNER_ONLY = 0o700;

export function createContext(): ZksContext {
  const home = path.resolve(defaultZksHome({ env: process.env, nodePlatform: process.platform, homeDir: os.homedir() }));
  return { home, toolsDir: path.join(home, "tools"), modelsDir: path.join(home, "models"), platform: platformKey(), lock: loadToolsLock() };
}

export function ensureHomeLayout({ home }: ZksContext): void {
  for (const subdir of HOME_SUBDIRS) mkdirSync(path.join(home, subdir), { recursive: true, mode: OWNER_ONLY });
  // mkdir's mode does not tighten a directory that already exists.
  if (process.platform !== "win32") chmodSync(home, OWNER_ONLY);
}
