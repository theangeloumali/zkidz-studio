// Created by The Angelo Umali.
// The local Supabase option (plan §8): a per-install password, and nothing published beyond loopback.
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SUPABASE_DB_PORT } from "@zks/shared";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertLoopbackPublishing,
  composeArgs,
  ensureSupabaseSecrets,
  readSupabaseSecrets,
  SUPABASE_COMPOSE_FILE,
  SUPABASE_COMPOSE_PROJECT,
  SUPABASE_STUDIO_PORT,
  SUPABASE_STUDIO_USERNAME,
  supabaseDatabaseUrl,
} from "../supabase-stack.ts";

const OWNER_ONLY_FILE_MODE = 0o600;
const isPosix = process.platform !== "win32";
const hasDockerCompose = spawnSync("docker", ["compose", "version"], { stdio: "ignore" }).status === 0;
const scratchDirs: string[] = [];

async function scratchEnvFile(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "zks-supabase-"));
  scratchDirs.push(directory);
  return join(directory, "db", "supabase.env");
}

afterEach(async () => {
  await Promise.all(scratchDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("ensureSupabaseSecrets", () => {
  it("generates a random password, never the default 'postgres', into an owner-only file", async () => {
    const envFile = await scratchEnvFile();
    const secrets = await ensureSupabaseSecrets(envFile);

    expect(secrets.postgresPassword).not.toBe("postgres");
    expect(secrets.postgresPassword).toMatch(/^[0-9a-f]{48}$/);
    expect(secrets.pgMetaCryptoKey).toMatch(/^[0-9a-f]{64}$/);
    expect(secrets.studioPassword).toMatch(/^[0-9a-f]{48}$/);
    expect(secrets.studioPassword).not.toBe(secrets.postgresPassword);
    const envText = await readFile(envFile, "utf8");
    expect(envText).toContain(`POSTGRES_PASSWORD=${secrets.postgresPassword}\n`);
    expect(envText).toContain(`STUDIO_PASSWORD=${secrets.studioPassword}\n`);
    if (isPosix) expect((await stat(envFile)).mode & 0o777).toBe(OWNER_ONLY_FILE_MODE);
  });

  it("keeps the first install's password, since the data volume was initialised with it", async () => {
    const envFile = await scratchEnvFile();
    const first = await ensureSupabaseSecrets(envFile);
    const second = await ensureSupabaseSecrets(envFile);

    expect(second).toEqual(first);
  });

  it("differs per install", async () => {
    const first = await ensureSupabaseSecrets(await scratchEnvFile());
    const second = await ensureSupabaseSecrets(await scratchEnvFile());

    expect(second.postgresPassword).not.toBe(first.postgresPassword);
  });

  it.skipIf(!isPosix)("tightens a file that was left readable by others", async () => {
    const envFile = await scratchEnvFile();
    await ensureSupabaseSecrets(envFile);
    await chmod(envFile, 0o644);

    await ensureSupabaseSecrets(envFile);

    expect((await stat(envFile)).mode & 0o777).toBe(OWNER_ONLY_FILE_MODE);
  });

  it("adds a Studio password to a file written before Studio had a login, keeping the Postgres password", async () => {
    const envFile = await scratchEnvFile();
    await ensureSupabaseSecrets(envFile);
    const preStudioText = "POSTGRES_PASSWORD=kept-postgres-password\nPG_META_CRYPTO_KEY=kept-crypto-key";
    await writeFile(envFile, preStudioText, { mode: OWNER_ONLY_FILE_MODE });

    const secrets = await ensureSupabaseSecrets(envFile);

    expect(secrets.postgresPassword).toBe("kept-postgres-password");
    expect(secrets.pgMetaCryptoKey).toBe("kept-crypto-key");
    expect(secrets.studioPassword).toMatch(/^[0-9a-f]{48}$/);
    expect(await readFile(envFile, "utf8")).toBe(`${preStudioText}\nSTUDIO_PASSWORD=${secrets.studioPassword}\n`);
    expect(await ensureSupabaseSecrets(envFile)).toEqual(secrets);
    if (isPosix) expect((await stat(envFile)).mode & 0o777).toBe(OWNER_ONLY_FILE_MODE);
  });

  it("rejects a hand-edited file that lost a value instead of guessing one", async () => {
    const envFile = await scratchEnvFile();
    await ensureSupabaseSecrets(envFile);
    await writeFile(envFile, "POSTGRES_PASSWORD=\n");

    await expect(ensureSupabaseSecrets(envFile)).rejects.toThrow(/POSTGRES_PASSWORD/);
  });
});

describe("readSupabaseSecrets", () => {
  it("tells the user to start the stack when no password exists yet", async () => {
    await expect(readSupabaseSecrets(await scratchEnvFile())).rejects.toThrow(/db:supabase:start/);
  });

  it("adds the Studio password to a pre-Studio-login file, so compose can interpolate it for `stop`", async () => {
    const envFile = await scratchEnvFile();
    await ensureSupabaseSecrets(envFile);
    await writeFile(envFile, "POSTGRES_PASSWORD=kept\nPG_META_CRYPTO_KEY=kept-key\n");

    const secrets = await readSupabaseSecrets(envFile);

    expect(secrets.postgresPassword).toBe("kept");
    expect(await readFile(envFile, "utf8")).toContain(`STUDIO_PASSWORD=${secrets.studioPassword}\n`);
  });
});

describe("supabaseDatabaseUrl", () => {
  it("points at loopback port 45322 with the generated password", () => {
    const password = "ab12";
    expect(supabaseDatabaseUrl(password)).toBe(`postgresql://postgres:${password}@127.0.0.1:45322/postgres`);
  });
});

describe("assertLoopbackPublishing", () => {
  // `docker ps --format '{{.Label "com.docker.compose.service"}}\t{{.Ports}}'`: one line per container, publishings joined by ", ".
  const STUDIO_RUNNING = "studio-proxy\t127.0.0.1:45323->45323/tcp\nstudio\t3000/tcp\nmeta\t8080/tcp\ndb\t127.0.0.1:45322->5432/tcp\n";

  it("accepts loopback-only publishings that include the required port", () => {
    expect(() => assertLoopbackPublishing("db\t127.0.0.1:45322->5432/tcp\n", SUPABASE_DB_PORT)).not.toThrow();
  });

  it("reads every container, and ignores ports that are exposed but not published", () => {
    expect(() => assertLoopbackPublishing(STUDIO_RUNNING, SUPABASE_STUDIO_PORT)).not.toThrow();
  });

  it.each([
    ["every address", "db\t0.0.0.0:45322->5432/tcp, [::]:45322->5432/tcp"],
    ["a second, wider publishing beside loopback", "db\t127.0.0.1:45322->5432/tcp, [::]:45322->5432/tcp"],
    ["a wide publishing on another container", "db\t127.0.0.1:45322->5432/tcp\nstudio-proxy\t0.0.0.0:45323->45323/tcp"],
    ["nothing running", ""],
    ["an exposed port that is not published", "db\t5432/tcp"],
  ])("refuses %s", (_case, dockerPsPorts) => {
    expect(() => assertLoopbackPublishing(dockerPsPorts, SUPABASE_DB_PORT)).toThrow(/loopback/);
  });

  it.each([
    ["Studio published directly, bypassing the proxy's login", "db\t127.0.0.1:45322->5432/tcp\nstudio\t127.0.0.1:45323->3000/tcp"],
    ["Studio published beside the proxy", `${STUDIO_RUNNING}studio\t127.0.0.1:3000->3000/tcp`],
    [
      "the proxy on a port other than 45323",
      "db\t127.0.0.1:45322->5432/tcp\nstudio-proxy\t127.0.0.1:45399->45323/tcp\nstudio-proxy\t127.0.0.1:45323->45323/tcp",
    ],
  ])("refuses %s", (_case, dockerPsPorts) => {
    expect(() => assertLoopbackPublishing(dockerPsPorts, SUPABASE_STUDIO_PORT)).toThrow(/studio-proxy/);
  });

  it("refuses when the required port is not published", () => {
    expect(() => assertLoopbackPublishing("studio-proxy\t127.0.0.1:45323->45323/tcp", SUPABASE_DB_PORT)).toThrow(/45322/);
  });
});

describe("composeArgs", () => {
  it("always names the project, the repo compose file and the per-install env file", () => {
    expect(composeArgs("/zks-home/db/supabase.env", ["up", "-d", "db"])).toEqual([
      "compose",
      "-p",
      SUPABASE_COMPOSE_PROJECT,
      "-f",
      SUPABASE_COMPOSE_FILE,
      "--env-file",
      "/zks-home/db/supabase.env",
      "up",
      "-d",
      "db",
    ]);
  });
});

interface ComposePort {
  readonly host_ip?: string;
  readonly published?: string;
  readonly target?: number;
}

interface ComposeService {
  readonly image?: string;
  readonly ports?: ComposePort[];
  readonly environment?: Record<string, string | null>;
}

const SECRETS_ENV = { POSTGRES_PASSWORD: "unused", PG_META_CRYPTO_KEY: "unused", STUDIO_PASSWORD: "unused" };

// Docker's own parser, so the check reads what `up` would publish rather than a regex of the YAML.
function composeServices(profileArgs: string[]): Record<string, ComposeService> {
  const config = spawnSync("docker", ["compose", "-f", SUPABASE_COMPOSE_FILE, ...profileArgs, "config", "--format", "json"], {
    encoding: "utf8",
    env: { ...process.env, ...SECRETS_ENV },
  });
  expect(config.status, config.stderr).toBe(0);
  return (JSON.parse(config.stdout) as { services: Record<string, ComposeService> }).services;
}

function publishedPorts(profileArgs: string[]): { service: string; port: ComposePort }[] {
  return Object.entries(composeServices(profileArgs)).flatMap(([service, definition]) => (definition.ports ?? []).map((port) => ({ service, port })));
}

describe.skipIf(!hasDockerCompose)("supabase/compose.yml", () => {
  it("publishes only Postgres on 127.0.0.1:45322 by default", () => {
    expect(publishedPorts([]).map(({ service, port }) => `${service} ${port.host_ip}:${port.published}`)).toEqual(["db 127.0.0.1:45322"]);
  });

  it("publishes only the Studio proxy on loopback 45323 with the studio profile, never Studio itself", () => {
    const ports = publishedPorts(["--profile", "studio"]);

    expect(ports.map(({ service, port }) => `${service} ${port.host_ip}:${port.published}`).sort()).toEqual([
      "db 127.0.0.1:45322",
      "studio-proxy 127.0.0.1:45323",
    ]);
  });

  it("gives Studio no ports section at all", () => {
    expect(composeServices(["--profile", "studio"]).studio?.ports).toBeUndefined();
  });

  it("pins the proxy image by tag and digest, and logs in as the user the CLI prints", () => {
    const proxy = composeServices(["--profile", "studio"])["studio-proxy"];

    expect(proxy?.image).toMatch(/\/caddy:[0-9.]+-alpine@sha256:[0-9a-f]{64}$/);
    expect(proxy?.environment?.STUDIO_USERNAME).toBe(SUPABASE_STUDIO_USERNAME);
  });

  it.each(["POSTGRES_PASSWORD", "STUDIO_PASSWORD"])("refuses to start without the generated %s", (secretKey) => {
    const config = spawnSync("docker", ["compose", "-f", SUPABASE_COMPOSE_FILE, "config"], {
      encoding: "utf8",
      env: { ...process.env, ...SECRETS_ENV, [secretKey]: "" },
    });

    expect(config.status).not.toBe(0);
    expect(config.stderr).toContain(secretKey);
  });
});
