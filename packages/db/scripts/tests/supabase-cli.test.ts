// Created by The Angelo Umali.
// The db:supabase:* entry point's wiring and output; supabase-commands.test.ts covers the start/studio/stop decisions.
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ensureSupabaseSecrets, supabaseDatabaseUrl } from "../supabase-stack.ts";

const SUPABASE_CLI = fileURLToPath(new URL("../supabase.ts", import.meta.url));
// Each run is a fresh node process; cold module loads take seconds on a slow filesystem.
const CLI_TIMEOUT_MS = 60_000;
const scratchDirs: string[] = [];

afterEach(async () => {
  await Promise.all(scratchDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function scratchHome(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "zks-supabase-cli-"));
  scratchDirs.push(directory);
  return directory;
}

function runSupabaseCli(zksHome: string, args: string[], extraEnv: Record<string, string> = {}) {
  return spawnSync(process.execPath, [SUPABASE_CLI, ...args], { encoding: "utf8", env: { ...process.env, ZKS_HOME: zksHome, ...extraEnv } });
}

// A `docker` first on PATH that logs its argv, has no data volume, and reports loopback-only db and Studio-proxy publishings.
const FAKE_DOCKER = `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_DOCKER_LOG"
case "$1" in
  volume) exit 1 ;;
  ps) printf 'studio-proxy\\t127.0.0.1:45323->45323/tcp\\nstudio\\t3000/tcp\\ndb\\t127.0.0.1:45322->5432/tcp\\n' ;;
esac
`;

async function withFakeDocker(zksHome: string): Promise<Record<string, string>> {
  await writeFile(join(zksHome, "docker"), FAKE_DOCKER);
  await chmod(join(zksHome, "docker"), 0o755);
  return { PATH: `${zksHome}${delimiter}${process.env.PATH ?? ""}`, FAKE_DOCKER_LOG: join(zksHome, "docker.log") };
}

describe("supabase.ts", { timeout: CLI_TIMEOUT_MS }, () => {
  it("prints only the DATABASE_URL for `url`, so $(...) can capture it", async () => {
    const zksHome = await scratchHome();
    const { postgresPassword } = await ensureSupabaseSecrets(join(zksHome, "db", "supabase.env"));

    const result = runSupabaseCli(zksHome, ["url"]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(`${supabaseDatabaseUrl(postgresPassword)}\n`);
  });

  it("tells the user to start the stack when `url` has no password yet", async () => {
    const result = runSupabaseCli(await scratchHome(), ["url"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("db:supabase:start");
  });

  it.skipIf(process.platform === "win32")("prints the literal DATABASE_URL line on `start`, as plan §8 documents", async () => {
    const zksHome = await scratchHome();
    const fakeDockerEnv = await withFakeDocker(zksHome);

    const result = runSupabaseCli(zksHome, ["start"], fakeDockerEnv);

    expect(result.status, result.stderr).toBe(0);
    const { postgresPassword } = await ensureSupabaseSecrets(join(zksHome, "db", "supabase.env"));
    expect(result.stdout.split("\n")[0]).toBe(`DATABASE_URL=${supabaseDatabaseUrl(postgresPassword)}`);
    expect(await readFile(fakeDockerEnv.FAKE_DOCKER_LOG ?? "", "utf8")).toMatch(/up --detach --wait db\nps --filter/);
  });

  it.skipIf(process.platform === "win32")("prints the evidence lines on `check` and exits 0 for a loopback-only stack", async () => {
    const zksHome = await scratchHome();

    const result = runSupabaseCli(zksHome, ["check"], await withFakeDocker(zksHome));

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("published: studio-proxy 127.0.0.1:45323->45323/tcp, studio 3000/tcp, db 127.0.0.1:45322->5432/tcp");
    expect(result.stdout).toContain("port 45322 off loopback: no answer");
  });

  it.skipIf(process.platform === "win32")("prints Studio's URL, user and password file on `studio`, never the password itself", async () => {
    const zksHome = await scratchHome();
    const envFile = join(zksHome, "db", "supabase.env");

    const result = runSupabaseCli(zksHome, ["studio"], await withFakeDocker(zksHome));

    expect(result.status, result.stderr).toBe(0);
    const { studioPassword, postgresPassword } = await ensureSupabaseSecrets(envFile);
    const output = `${result.stdout}${result.stderr}`;
    expect(output).toContain("Supabase Studio: http://127.0.0.1:45323");
    expect(output).toContain("user zks");
    expect(output).toContain(`STUDIO_PASSWORD in ${envFile}`);
    expect(output).not.toContain(studioPassword);
    expect(output).not.toContain(postgresPassword);
  });

  it("exits 2 with the usage line on an unknown command", async () => {
    const result = runSupabaseCli(await scratchHome(), ["publish"]);

    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/usage/i);
  });
});
