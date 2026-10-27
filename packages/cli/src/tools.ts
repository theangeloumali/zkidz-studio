// Created by The Angelo Umali.
import { Browser, BrowserPlatform, getDownloadUrl, install } from "@puppeteer/browsers";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { ENV } from "@zks/shared";
import { isDownload, pinnedEntry, pinnedExecutablePath, pinnedInstallDir, type PinnedDownload, type PlatformKey, type ToolName } from "@zks/shared/node";
import type { ZksContext } from "./context.ts";
import { downloadVerified } from "./download.ts";
import { runCommand } from "./exec.ts";

export type InstallStatus = "present" | "installed" | "system";

const CHROME_PLATFORMS: Partial<Record<PlatformKey, BrowserPlatform>> = {
  "linux-x64": BrowserPlatform.LINUX,
  "linux-arm64": BrowserPlatform.LINUX_ARM,
  "mac-arm64": BrowserPlatform.MAC_ARM,
  "win-x64": BrowserPlatform.WIN64,
};
function chromeOptions(context: ZksContext) {
  const platform = CHROME_PLATFORMS[context.platform];
  if (!platform) throw new Error(`chrome-headless-shell has no build for ${context.platform}`);
  const buildId = context.lock.tools["chrome-headless-shell"].version;
  return { browser: Browser.CHROMEHEADLESSSHELL, buildId, platform, cacheDir: path.join(context.toolsDir, "chrome-headless-shell") };
}

/** Where the tool's executable is, or would be once installed: an explicit ZKS_FFMPEG or ZKS_CHROME wins, as the server honours it. */
export function toolExecutablePath(context: ZksContext, name: ToolName): string | undefined {
  if (name === "ffmpeg" && process.env[ENV.ffmpeg]) return process.env[ENV.ffmpeg];
  if (name === "chrome-headless-shell" && process.env[ENV.chrome]) return process.env[ENV.chrome];
  return pinnedExecutablePath(context, name);
}

export function chromeDownloadUrl(context: ZksContext): string {
  const options = chromeOptions(context);
  return getDownloadUrl(options.browser, options.platform, options.buildId).toString();
}

async function installChrome(context: ZksContext, entry: PinnedDownload): Promise<InstallStatus> {
  const options = chromeOptions(context);
  const resolvedUrl = chromeDownloadUrl(context);
  if (resolvedUrl !== entry.url) throw new Error(`tools.lock.json chrome URL ${entry.url} differs from @puppeteer/browsers (${resolvedUrl})`);
  // The shared path, which the server also reads; the CLI tools test pins it to where install() puts Chrome.
  if (existsSync(pinnedExecutablePath(context, "chrome-headless-shell") ?? "")) return "present";
  await install({ ...options, expectedHash: entry.sha256 });
  return "installed";
}

/** Windows' bsdtar by absolute path: it reads the .zip builds, and Git Bash's GNU tar takes "D:\\..." for a remote host. */
export function tarExecutable(platform: NodeJS.Platform, env: Readonly<Record<string, string | undefined>>): string {
  return platform === "win32" ? path.win32.join(env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
}

/** Extracts beside the target and renames, so an interrupted extract never looks installed. */
function extractArchive(archivePath: string, targetDir: string): void {
  const stagingDir = `${targetDir}.staging`;
  rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(stagingDir, { recursive: true });
  const extraction = runCommand(tarExecutable(process.platform, process.env), ["-xf", archivePath, "-C", stagingDir], 600_000);
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
  extractArchive(archivePath, pinnedInstallDir(context.toolsDir, name, entry));
  rmSync(archivePath, { force: true });
  return "installed";
}
