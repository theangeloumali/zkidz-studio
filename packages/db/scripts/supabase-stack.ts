// Created by The Angelo Umali.
// The local Supabase option's moving parts (plan §8): compose paths, per-install secrets, and the loopback assertion.
import { randomBytes } from "node:crypto";
import { appendFile, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LOOPBACK_HOST, SUPABASE_DB_PORT } from "@zks/shared";
import { defaultZksHome } from "@zks/shared/node";
import { hasErrorCode } from "../src/index.ts";

export const SUPABASE_COMPOSE_FILE = fileURLToPath(new URL("../../../supabase/compose.yml", import.meta.url));
export const SUPABASE_STUDIO_PORT = 45323;
/** The Caddy login in front of Studio; Studio itself publishes nothing. */
export const SUPABASE_STUDIO_PROXY_SERVICE = "studio-proxy";
export const SUPABASE_STUDIO_USERNAME = "zks";
/** compose.yml's `name:`; ZKS_SUPABASE_PROJECT runs a second, throwaway stack beside it. */
export const SUPABASE_COMPOSE_PROJECT = process.env.ZKS_SUPABASE_PROJECT || "zks-studio-supabase";
/** Holds the data the password was initialised with. */
export const SUPABASE_DATA_VOLUME = `${SUPABASE_COMPOSE_PROJECT}_db-data`;
/** Every container's service and publishings, one line each; `docker compose port` would print only the first binding. */
export const DOCKER_PS_PORTS_ARGS: readonly string[] = [
  "ps",
  "--filter",
  `label=com.docker.compose.project=${SUPABASE_COMPOSE_PROJECT}`,
  "--format",
  '{{.Label "com.docker.compose.service"}}\t{{.Ports}}',
];
/** The one host publishing each service may have; any other is a hole (Studio published directly skips the login). */
const PUBLISHED_PORT_BY_SERVICE: ReadonlyMap<string, number> = new Map([
  ["db", SUPABASE_DB_PORT],
  [SUPABASE_STUDIO_PROXY_SERVICE, SUPABASE_STUDIO_PORT],
]);

const ENV_FILE_NAME = "supabase.env";
const OWNER_ONLY_FILE_MODE = 0o600;
const OWNER_ONLY_DIR_MODE = 0o700;
const PASSWORD_BYTES = 24;
const CRYPTO_KEY_BYTES = 32;
const PASSWORD_KEY = "POSTGRES_PASSWORD";
const CRYPTO_KEY_KEY = "PG_META_CRYPTO_KEY";
const STUDIO_PASSWORD_KEY = "STUDIO_PASSWORD";

export interface SupabaseSecrets {
  readonly postgresPassword: string;
  readonly pgMetaCryptoKey: string;
  readonly studioPassword: string;
}

export function supabaseEnvFile(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return join(defaultZksHome({ env, platform: process.platform, homeDir: homedir() }), "db", ENV_FILE_NAME);
}

/** Reuses the file when present: Postgres keeps the password it was first initialised with. */
export async function ensureSupabaseSecrets(envFile: string): Promise<SupabaseSecrets> {
  const existingText = await readOptionalFile(envFile);
  if (existingText !== null) return loadExistingSecrets(envFile, existingText);
  const secrets: SupabaseSecrets = {
    postgresPassword: generatePassword(),
    pgMetaCryptoKey: randomBytes(CRYPTO_KEY_BYTES).toString("hex"),
    studioPassword: generatePassword(),
  };
  await mkdir(dirname(envFile), { recursive: true, mode: OWNER_ONLY_DIR_MODE });
  // "wx": a concurrent first start fails loudly instead of overwriting the other's password.
  await writeFile(
    envFile,
    `${PASSWORD_KEY}=${secrets.postgresPassword}\n${CRYPTO_KEY_KEY}=${secrets.pgMetaCryptoKey}\n${STUDIO_PASSWORD_KEY}=${secrets.studioPassword}\n`,
    { flag: "wx", mode: OWNER_ONLY_FILE_MODE },
  );
  return secrets;
}

/** Also adds a missing Studio password, since compose interpolates it for every command. */
export async function readSupabaseSecrets(envFile: string): Promise<SupabaseSecrets> {
  const text = await readOptionalFile(envFile);
  if (text === null) throw new Error(`No local Supabase password yet (${envFile}). Run: pnpm db:supabase:start`);
  return loadExistingSecrets(envFile, text);
}

function generatePassword(): string {
  return randomBytes(PASSWORD_BYTES).toString("hex");
}

/** A file from before Studio had a login gains its key; the Postgres password is never rewritten. */
async function loadExistingSecrets(envFile: string, text: string): Promise<SupabaseSecrets> {
  await chmod(envFile, OWNER_ONLY_FILE_MODE);
  const values = parseEnvText(text);
  let studioPassword = values.get(STUDIO_PASSWORD_KEY);
  if (studioPassword === undefined) {
    studioPassword = generatePassword();
    await appendFile(envFile, `${text === "" || text.endsWith("\n") ? "" : "\n"}${STUDIO_PASSWORD_KEY}=${studioPassword}\n`);
    values.set(STUDIO_PASSWORD_KEY, studioPassword);
  }
  return parseSecrets(values, envFile);
}

async function readOptionalFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return null;
    throw error;
  }
}

function parseEnvText(text: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const separatorIndex = line.indexOf("=");
    if (separatorIndex > 0) values.set(line.slice(0, separatorIndex).trim(), line.slice(separatorIndex + 1).trim());
  }
  return values;
}

function parseSecrets(values: ReadonlyMap<string, string>, envFile: string): SupabaseSecrets {
  const requireValue = (key: string): string => {
    const value = values.get(key);
    if (!value) throw new Error(`${envFile} has no ${key}. Restore the file, or remove the data volume and start again.`);
    return value;
  };
  return {
    postgresPassword: requireValue(PASSWORD_KEY),
    pgMetaCryptoKey: requireValue(CRYPTO_KEY_KEY),
    studioPassword: requireValue(STUDIO_PASSWORD_KEY),
  };
}

export function supabaseDatabaseUrl(postgresPassword: string): string {
  return `postgresql://postgres:${encodeURIComponent(postgresPassword)}@${LOOPBACK_HOST}:${SUPABASE_DB_PORT}/postgres`;
}

export function composeArgs(envFile: string, composeCommand: readonly string[]): string[] {
  return ["compose", "-p", SUPABASE_COMPOSE_PROJECT, "-f", SUPABASE_COMPOSE_FILE, "--env-file", envFile, ...composeCommand];
}

const PUBLISHING_ARROW = "->";

/** Second layer behind the compose file: each service publishes only its own 127.0.0.1 port, and `requiredHostPort` is up. */
export function assertLoopbackPublishing(dockerPsPorts: string, requiredHostPort: number): void {
  // Entries without an arrow ("8080/tcp") are exposed inside the network, not published on the host.
  const hostBindings = dockerPsPorts
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .flatMap((line) => {
      const [service = "", ports = ""] = line.split("\t");
      return ports
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.includes(PUBLISHING_ARROW))
        .map((entry) => ({ service: service.trim(), binding: entry.slice(0, entry.indexOf(PUBLISHING_ARROW)) }));
    });
  const isAllowed = ({ service, binding }: { service: string; binding: string }): boolean =>
    binding === `${LOOPBACK_HOST}:${PUBLISHED_PORT_BY_SERVICE.get(service) ?? "none"}`;
  const hasRequiredPort = hostBindings.some(({ binding }) => binding === `${LOOPBACK_HOST}:${requiredHostPort}`);
  if (!hostBindings.every(isAllowed) || !hasRequiredPort) {
    const allowed = [...PUBLISHED_PORT_BY_SERVICE].map(([service, port]) => `${service} on ${LOOPBACK_HOST}:${port}`).join(", ");
    const found = hostBindings.map(({ service, binding }) => `${service} ${binding}`).join(", ") || "nothing published";
    throw new Error(`Supabase must publish ${LOOPBACK_HOST}:${requiredHostPort}, and only on loopback as ${allowed} (found: ${found}).`);
  }
}

/** `docker ps` lines as "service ports", for evidence output. */
export function formatDockerPsPorts(dockerPsPorts: string): string {
  return dockerPsPorts
    .trim()
    .split(/\r?\n/)
    .map((line) => line.replace("\t", " "))
    .join(", ");
}
