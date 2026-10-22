// Created by The Angelo Umali.
// Server settings from the environment (plan §3.3). ZKS_HOME holds the database, keys and projects, so it is owner-only.
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, posix, win32 } from "node:path";
import { APP_PORT, ENV } from "@zks/shared";

export const STUDIO_HOME_DIRS = ["db", "backups", "tools", "models", "locks", "projects"] as const;
export const PROJECT_DIRS = ["media", "work", "progress", "deliverables"] as const;
const APP_FOLDER_NAME = "zkidz-studio";
const OWNER_ONLY_MODE = 0o700;
const MAX_PORT = 65535;

type Environment = Readonly<Record<string, string | undefined>>;

export interface ServerConfig {
  readonly studioHome: string;
  readonly port: number;
  readonly databaseUrl: string | undefined;
  readonly isContainer: boolean;
  readonly ffprobePath: string;
}

export function defaultStudioHome(host: { platform: NodeJS.Platform; homeDir: string; env: Environment }): string {
  if (host.platform === "win32") return win32.join(host.env.LOCALAPPDATA ?? win32.join(host.homeDir, "AppData", "Local"), APP_FOLDER_NAME);
  if (host.platform === "darwin") return posix.join(host.homeDir, "Library", "Application Support", APP_FOLDER_NAME);
  return posix.join(host.env.XDG_DATA_HOME ?? posix.join(host.homeDir, ".local", "share"), APP_FOLDER_NAME);
}

export function loadServerConfig(env: Environment): ServerConfig {
  const studioHome = env[ENV.home] ?? defaultStudioHome({ platform: process.platform, homeDir: homedir(), env });
  if (!isAbsolute(studioHome)) throw new Error(`${ENV.home} must be an absolute path`);
  return {
    studioHome,
    port: parsePort(env[ENV.port]),
    databaseUrl: env[ENV.databaseUrl] || undefined,
    isContainer: env[ENV.container] === "1",
    ffprobePath: ffprobeBeside(env[ENV.ffmpeg]),
  };
}

export async function ensureStudioHome(studioHome: string): Promise<void> {
  await mkdir(studioHome, { recursive: true, mode: OWNER_ONLY_MODE });
  await Promise.all(STUDIO_HOME_DIRS.map((dir) => mkdir(join(studioHome, dir), { recursive: true, mode: OWNER_ONLY_MODE })));
}

export function projectDir(studioHome: string, slug: string): string {
  return join(studioHome, "projects", slug);
}

export async function ensureProjectDirs(studioHome: string, slug: string): Promise<void> {
  const root = projectDir(studioHome, slug);
  await Promise.all(PROJECT_DIRS.map((dir) => mkdir(join(root, dir), { recursive: true, mode: OWNER_ONLY_MODE })));
}

function parsePort(rawPort: string | undefined): number {
  if (rawPort === undefined || rawPort === "") return APP_PORT;
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) throw new Error(`${ENV.port} must be a port number, got "${rawPort}"`);
  return port;
}

function ffprobeBeside(ffmpegPath: string | undefined): string {
  if (!ffmpegPath) return "ffprobe";
  const extension = basename(ffmpegPath).toLowerCase().endsWith(".exe") ? ".exe" : "";
  return join(dirname(ffmpegPath), `ffprobe${extension}`);
}
