// Created by The Angelo Umali.
// Server settings from the environment (plan §3.3). ZKS_HOME holds the database, keys and projects, so it is owner-only.
import { constants } from "node:fs";
import { access, chmod, mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { APP_PORT, ENV, PREVIEW_PORT } from "@zks/shared";
import { defaultZksHome, loadToolsLock, pinnedExecutablePath, platformKey, ZKS_HOME_DIRS } from "@zks/shared/node";

export const PROJECT_DIRS = ["media", "work", "progress", "deliverables"] as const;
const OWNER_ONLY_MODE = 0o700;
const MAX_PORT = 65535;
const SETUP_HINT = "Run: pnpm zks setup";

type Environment = Readonly<Record<string, string | undefined>>;

export interface ServerConfig {
  readonly studioHome: string;
  readonly port: number;
  readonly previewPort: number;
  readonly databaseUrl: string | undefined;
  readonly isContainer: boolean;
  readonly ffprobePath: string;
}

export function loadServerConfig(env: Environment): ServerConfig {
  const studioHome = defaultZksHome({ platform: process.platform, homeDir: homedir(), env });
  if (!isAbsolute(studioHome)) throw new Error(`${ENV.home} must be an absolute path`);
  const port = parsePort(ENV.port, env[ENV.port], APP_PORT);
  const previewPort = parsePort(ENV.previewPort, env[ENV.previewPort], PREVIEW_PORT);
  if (previewPort === port) throw new Error(`${ENV.previewPort} must differ from ${ENV.port} (${port}): the preview is a separate origin`);
  return {
    studioHome,
    port,
    previewPort,
    databaseUrl: env[ENV.databaseUrl] || undefined,
    isContainer: env[ENV.container] === "1",
    ffprobePath: ffprobeBeside(pinnedFfmpegPath(env, studioHome)),
  };
}

/** Startup check: uploads are probed only by the checksummed tool `zks setup` installs (plan §11), never a PATH lookalike. */
export async function assertFfprobeInstalled(ffprobePath: string): Promise<void> {
  try {
    await access(ffprobePath, constants.X_OK);
  } catch {
    throw new Error(`ffprobe is not installed at ${ffprobePath}. ${SETUP_HINT}`);
  }
}

export async function ensureStudioHome(studioHome: string): Promise<void> {
  const dirs = [studioHome, ...ZKS_HOME_DIRS.map((dir) => join(studioHome, dir))];
  for (const dir of dirs) await mkdir(dir, { recursive: true, mode: OWNER_ONLY_MODE });
  // mkdir's mode only applies to new folders; a home left at 0755 by an older run is tightened here.
  await Promise.all(dirs.map((dir) => chmod(dir, OWNER_ONLY_MODE)));
}

export function projectDir(studioHome: string, slug: string): string {
  return join(studioHome, "projects", slug);
}

/** The root is made without `recursive`, so a folder already there fails with EEXIST instead of being adopted. */
export async function createProjectDirs(studioHome: string, slug: string): Promise<void> {
  const root = projectDir(studioHome, slug);
  await mkdir(root, { mode: OWNER_ONLY_MODE });
  try {
    await Promise.all(PROJECT_DIRS.map((dir) => mkdir(join(root, dir), { mode: OWNER_ONLY_MODE })));
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

function parsePort(envName: string, rawPort: string | undefined, defaultPort: number): number {
  if (rawPort === undefined || rawPort === "") return defaultPort;
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) throw new Error(`${envName} must be a port number, got "${rawPort}"`);
  return port;
}

/** ZKS_FFMPEG wins; otherwise the same lookup `zks setup` installs into (ZKS_HOME/tools, or Homebrew on macOS). */
function pinnedFfmpegPath(env: Environment, studioHome: string): string {
  const overridePath = env[ENV.ffmpeg];
  if (overridePath) return overridePath;
  const ffmpegPath = pinnedExecutablePath({ toolsDir: join(studioHome, "tools"), platform: platformKey(), lock: loadToolsLock() }, "ffmpeg");
  if (!ffmpegPath) throw new Error(`ffmpeg is not installed. ${SETUP_HINT}`);
  return ffmpegPath;
}

function ffprobeBeside(ffmpegPath: string): string {
  const extension = basename(ffmpegPath).toLowerCase().endsWith(".exe") ? ".exe" : "";
  return join(dirname(ffmpegPath), `ffprobe${extension}`);
}
