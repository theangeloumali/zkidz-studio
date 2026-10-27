// Created by The Angelo Umali.
// The mode A key at rest (plan §6.5, §11): the OS keyring; Windows uses Credential Manager only, and the 0600 file
// fallback is refused on DrvFs, where 0600 means nothing.
import { readFile, rm, writeFile, chmod } from "node:fs/promises";
import { join, resolve } from "node:path";
import { lazyImport, ModuleLoadError } from "../lazy-import.ts";

const KEYRING_SERVICE = "zkidz-studio";
const KEYRING_ACCOUNT = "anthropic-api-key";
const SECRETS_FILE = "secrets.env";
const SECRETS_FILE_MODE = 0o600;
const API_KEY_LINE = /^ANTHROPIC_API_KEY=(.+)$/m;
// Used only when /proc/mounts is unreadable: WSL's automount root.
const WSL_DRIVE_PATH = /^\/mnt\/[a-z](?:\/|$)/i;
const loadKeyring = lazyImport("@napi-rs/keyring", () => import("@napi-rs/keyring"));

export interface KeyringEntry {
  readonly read: () => Promise<string | null>;
  readonly write: (secret: string) => Promise<void>;
  readonly remove: () => Promise<void>;
}

export interface SecretStore {
  readonly readApiKey: () => Promise<string | null>;
  readonly writeApiKey: (apiKey: string) => Promise<void>;
  readonly deleteApiKey: () => Promise<void>;
}

export interface SecretStoreOptions {
  readonly studioHome: string;
  readonly platform: NodeJS.Platform;
  readonly keyring: KeyringEntry;
  readonly readMounts?: () => Promise<string>;
}

export class SecretStorageError extends Error {
  override readonly name = "SecretStorageError";
}

export function createOsKeyringEntry(): KeyringEntry {
  const openEntry = async () => new (await loadKeyring()).Entry(KEYRING_SERVICE, KEYRING_ACCOUNT);
  return {
    read: async () => (await openEntry()).getPassword(),
    write: async (secret) => (await openEntry()).setPassword(secret),
    remove: async () => {
      (await openEntry()).deletePassword();
    },
  };
}

export function createSecretStore(options: SecretStoreOptions): SecretStore {
  const secretsPath = join(options.studioHome, SECRETS_FILE);
  const readMounts = options.readMounts ?? (() => readFile("/proc/mounts", "utf8"));
  const isFileFallbackAllowed = options.platform !== "win32";

  return {
    readApiKey: async () => {
      const keyringValue = await attempt(() => options.keyring.read());
      if (keyringValue.ok && keyringValue.value !== null) return keyringValue.value;
      return isFileFallbackAllowed ? readSecretsFile(secretsPath) : null;
    },
    writeApiKey: async (apiKey) => {
      if ((await attempt(() => options.keyring.write(apiKey))).ok) return;
      if (!isFileFallbackAllowed) throw new SecretStorageError("Windows Credential Manager is unavailable, so the key was not saved");
      if (await isOnDrvFs(options.studioHome, readMounts)) {
        throw new SecretStorageError("No OS keyring, and ZKS_HOME is on DrvFs where file permissions cannot protect the key");
      }
      await writeSecretsFile(secretsPath, apiKey);
    },
    deleteApiKey: async () => {
      await attempt(() => options.keyring.remove());
      if (isFileFallbackAllowed) await rm(secretsPath, { force: true });
    },
  };
}

/** True when `path` lives on a WSL Windows-drive mount (drvfs, or 9p with aname=drvfs). */
export async function isOnDrvFs(path: string, readMounts: () => Promise<string>): Promise<boolean> {
  const absolutePath = resolve(path);
  let mountTable: string;
  try {
    mountTable = await readMounts();
  } catch {
    return WSL_DRIVE_PATH.test(absolutePath);
  }
  const mounts = mountTable.split("\n").flatMap(parseMountLine);
  const containingMounts = mounts.filter((mount) => isPathUnder(absolutePath, mount.mountPoint));
  const nearestMount = containingMounts.sort((left, right) => right.mountPoint.length - left.mountPoint.length)[0];
  return nearestMount?.isDrvFs ?? false;
}

function parseMountLine(line: string): { mountPoint: string; isDrvFs: boolean }[] {
  const [, rawMountPoint, fsType, mountOptions = ""] = line.split(" ");
  if (rawMountPoint === undefined || fsType === undefined) return [];
  // /proc/mounts escapes space, tab, newline and backslash as octal.
  const mountPoint = rawMountPoint.replace(/\\([0-7]{3})/g, (_match, octal: string) => String.fromCharCode(parseInt(octal, 8)));
  const isDrvFs = fsType === "drvfs" || (fsType === "9p" && mountOptions.includes("aname=drvfs"));
  return [{ mountPoint, isDrvFs }];
}

function isPathUnder(path: string, mountPoint: string): boolean {
  if (mountPoint === "/") return true;
  return path === mountPoint || path.startsWith(`${mountPoint}/`);
}

async function readSecretsFile(secretsPath: string): Promise<string | null> {
  const contents = await readFile(secretsPath, "utf8").catch(() => null);
  return contents?.match(API_KEY_LINE)?.[1] ?? null;
}

async function writeSecretsFile(secretsPath: string, apiKey: string): Promise<void> {
  await writeFile(secretsPath, `ANTHROPIC_API_KEY=${apiKey}\n`, { mode: SECRETS_FILE_MODE });
  // writeFile's mode only applies to a new file.
  await chmod(secretsPath, SECRETS_FILE_MODE);
}

type Attempt<Value> = { readonly ok: true; readonly value: Value } | { readonly ok: false };

/** A missing keyring backend (no Secret Service on a headless Linux box) is a fallback; a missing keyring module is a crash. */
async function attempt<Value>(operation: () => Promise<Value>): Promise<Attempt<Value>> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    if (error instanceof ModuleLoadError) throw error;
    return { ok: false };
  }
}
