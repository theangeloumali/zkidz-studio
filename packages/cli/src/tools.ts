// Created by The Angelo Umali.
import { Browser, BrowserPlatform, computeExecutablePath, getDownloadUrl, install } from "@puppeteer/browsers";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { ENV } from "@zks/shared";
import type { ZksContext } from "./context.ts";
import { downloadVerified } from "./download.ts";
import { findOnPath, runCommand } from "./exec.ts";
import { isDownload, type PinnedDownload, type ToolName } from "./lock.ts";
import type { PlatformKey } from "./platform.ts";

export type InstallStatus = "present" | "installed" | "system";

const CHROME_PLATFORMS: Partial<Record<PlatformKey, BrowserPlatform>> = {
  "linux-x64": BrowserPlatform.LINUX,
  "linux-arm64": BrowserPlatform.LINUX_ARM,
  "mac-arm64": BrowserPlatform.MAC_ARM,
  "win-x64": BrowserPlatform.WIN64,
};
const SHORT_HASH_LENGTH = 12;

function pinnedEntry(context: ZksContext, name: ToolName) {
  const entry = context.lock.tools[name].platforms[context.platform];
  if (!entry) throw new Error(`${name} has no pinned build for ${context.platform}`);
  return entry;
}

function chromeOptions(context: ZksContext) {
  const platform = CHROME_PLATFORMS[context.platform];
  if (!platform) throw new Error(`chrome-headless-shell has no build for ${context.platform}`);
  const buildId = context.lock.tools["chrome-headless-shell"].version;
  return { browser: Browser.CHROMEHEADLESSSHELL, buildId, platform, cacheDir: path.join(context.toolsDir, "chrome-headless-shell") };
}

function extractedDir(context: ZksContext, name: ToolName, entry: PinnedDownload): string {
  return path.join(context.toolsDir, name, entry.sha256.slice(0, SHORT_HASH_LENGTH));
}

/** Where the tool's executable is, or would be once installed. */
export function toolExecutablePath(context: ZksContext, name: ToolName): string | undefined {
  if (name === "ffmpeg" && process.env[ENV.ffmpeg]) return process.env[ENV.ffmpeg];
  const entry = pinnedEntry(context, name);
  if (!isDownload(entry)) return findOnPath(entry.executable ?? entry.homebrew);
  if (name === "chrome-headless-shell") return computeExecutablePath(chromeOptions(context));
  return path.join(extractedDir(context, name, entry), entry.executable ?? name);
}

export function chromeDownloadUrl(context: ZksContext): string {
  const options = chromeOptions(context);
  return getDownloadUrl(options.browser, options.platform, options.buildId).toString();
}

async function installChrome(context: ZksContext, entry: PinnedDownload): Promise<InstallStatus> {
  const options = chromeOptions(context);
  const resolvedUrl = chromeDownloadUrl(context);
  if (resolvedUrl !== entry.url) throw new Error(`tools.lock.json chrome URL ${entry.url} differs from @puppeteer/browsers (${resolvedUrl})`);
  if (existsSync(computeExecutablePath(options))) return "present";
  await install({ ...options, expectedHash: entry.sha256 });
  return "installed";
}

/** Extracts beside the target and renames, so an interrupted extract never looks installed. */
function extractArchive(archivePath: string, targetDir: string): void {
  const stagingDir = `${targetDir}.staging`;
  rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(stagingDir, { recursive: true });
  // GNU tar reads .tar.xz/.tar.gz; Windows' bsdtar also reads the .zip builds.
  const extraction = runCommand("tar", ["-xf", archivePath, "-C", stagingDir], 600_000);
  if (extraction.code !== 0) throw new Error(`tar failed for ${archivePath}: ${extraction.stderr.trim()}`);
  renameSync(stagingDir, targetDir);
}

export async function installTool(context: ZksContext, name: ToolName): Promise<InstallStatus> {
  const entry = pinnedEntry(context, name);
  if (!isDownload(entry)) {
    if (toolExecutablePath(context, name)) return "system";
    throw new Error(`${name} is not on PATH. Fix: brew install ${entry.homebrew}`);
  }
  if (name === "chrome-headless-shell") return installChrome(context, entry);
  const executable = toolExecutablePath(context, name);
  if (executable && existsSync(executable)) return "present";
  const archivePath = path.join(context.toolsDir, ".downloads", path.basename(new URL(entry.url).pathname));
  await downloadVerified({ url: entry.url, sha256: entry.sha256, destination: archivePath });
  extractArchive(archivePath, extractedDir(context, name, entry));
  rmSync(archivePath, { force: true });
  return "installed";
}
