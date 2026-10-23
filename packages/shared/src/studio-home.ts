// Created by The Angelo Umali.
import path from "node:path";
import { ENV } from "./runtime.ts";

/** The ZKS_HOME layout both `zks setup` and the server create, owner-only. */
export const ZKS_HOME_DIRS = ["db", "backups", "tools", "models", "locks", "projects"] as const;
const APP_DIR = "zkidz-studio";

interface HomeHost {
  env: Readonly<Record<string, string | undefined>>;
  platform: NodeJS.Platform;
  homeDir: string;
}

/** Plan §3.3 defaults; ZKS_HOME always wins. */
export function defaultZksHome({ env, platform, homeDir }: HomeHost): string {
  const override = env[ENV.home];
  if (override) return override;
  if (platform === "win32") return path.win32.join(env.LOCALAPPDATA ?? path.win32.join(homeDir, "AppData", "Local"), APP_DIR);
  if (platform === "darwin") return path.posix.join(homeDir, "Library", "Application Support", APP_DIR);
  return path.posix.join(env.XDG_DATA_HOME ?? path.posix.join(homeDir, ".local", "share"), APP_DIR);
}
