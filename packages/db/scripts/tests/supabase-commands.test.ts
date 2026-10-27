// Created by The Angelo Umali.
// db:supabase:start | studio | stop against a recording fake of the docker CLI.
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkStack, type DockerCli, startDatabase, startStudio, stopStack } from "../supabase-commands.ts";
import type { HostNetwork } from "../supabase-exposure.ts";
import { ensureSupabaseSecrets, SUPABASE_COMPOSE_PROJECT, supabaseDatabaseUrl } from "../supabase-stack.ts";

const DB_ONLY = "db\t127.0.0.1:45322->5432/tcp\n";
const DB_AND_STUDIO = "studio-proxy\t127.0.0.1:45323->45323/tcp\nstudio\t3000/tcp\nmeta\t8080/tcp\ndb\t127.0.0.1:45322->5432/tcp\n";
// The project follows ZKS_SUPABASE_PROJECT, so a throwaway stack's shell still runs this suite green.
const PS_PORTS_COMMAND = `ps --filter label=com.docker.compose.project=${SUPABASE_COMPOSE_PROJECT} --format {{.Label "com.docker.compose.service"}}\t{{.Ports}}`;
const STUDIO_UP = "--profile studio up --detach --wait meta studio studio-proxy";
const scratchDirs: string[] = [];

afterEach(async () => {
  await Promise.all(scratchDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function scratchEnvFile(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "zks-supabase-commands-"));
  scratchDirs.push(directory);
  return join(directory, "db", "supabase.env");
}

function fakeDocker({ hasDataVolume = false, dockerPsPorts = DB_ONLY } = {}) {
  const commands: string[] = [];
  const docker: DockerCli = {
    run: (args) => void commands.push(args.join(" ")),
    read: (args) => {
      commands.push(args.join(" "));
      return dockerPsPorts;
    },
    succeeds: (args) => {
      commands.push(args.join(" "));
      return hasDataVolume;
    },
  };
  const ran = (suffix: string): boolean => commands.some((command) => command.endsWith(suffix));
  return { docker, commands, ran };
}

function fakeNetwork({ reservedPorts = [] as number[], exposedAddresses = [] as string[] } = {}): HostNetwork {
  return {
    findReservedPorts: (ports) => ports.filter((port) => reservedPorts.includes(port)),
    findExposedAddresses: () => Promise.resolve(exposedAddresses),
  };
}

// Documentation addresses (RFC 5737); a probe that found one means the port answered off loopback.
const LAN_ADDRESS = "192.0.2.10";

const isPresent = (filePath: string): Promise<boolean> =>
  access(filePath).then(
    () => true,
    () => false,
  );

describe("startDatabase", () => {
  it("refuses to start when the env file is gone but the data volume exists, and never runs up", async () => {
    const envFile = await scratchEnvFile();
    const { docker, ran } = fakeDocker({ hasDataVolume: true });

    await expect(startDatabase(docker, fakeNetwork(), envFile)).rejects.toThrow(/missing but the data volume/);
    expect(ran("up --detach --wait db")).toBe(false);
    expect(await isPresent(envFile)).toBe(false);
  });

  it.each([
    ["a first install", false, false],
    ["a restart with its data", true, true],
    ["a kept env file whose volume was removed", true, false],
  ])("starts Postgres for %s and returns its DATABASE_URL", async (_case, hasEnvFile, hasDataVolume) => {
    const envFile = await scratchEnvFile();
    if (hasEnvFile) await ensureSupabaseSecrets(envFile);
    const { docker, ran } = fakeDocker({ hasDataVolume });

    const databaseUrl = await startDatabase(docker, fakeNetwork(), envFile);

    const { postgresPassword } = await ensureSupabaseSecrets(envFile);
    expect(databaseUrl).toBe(supabaseDatabaseUrl(postgresPassword));
    expect(ran("up --detach --wait db")).toBe(true);
    expect(ran("down")).toBe(false);
  });

  it("checks every container's publishings, then takes the stack down when one is off loopback", async () => {
    const { docker, commands, ran } = fakeDocker({ dockerPsPorts: "db\t127.0.0.1:45322->5432/tcp, [::]:45322->5432/tcp\n" });

    await expect(startDatabase(docker, fakeNetwork(), await scratchEnvFile())).rejects.toThrow(/loopback/);
    expect(commands).toContainEqual(PS_PORTS_COMMAND);
    expect(ran("--profile studio down")).toBe(true);
  });

  it("refuses before compose runs when Windows reserves the Postgres port", async () => {
    const { docker, ran } = fakeDocker();

    await expect(startDatabase(docker, fakeNetwork({ reservedPorts: [45322] }), await scratchEnvFile())).rejects.toThrow(/reserves port 45322.*winnat/s);
    expect(ran("up --detach --wait db")).toBe(false);
  });

  it("takes the stack down when Postgres answers on a non-loopback address despite a loopback publishing", async () => {
    const { docker, ran } = fakeDocker();

    await expect(startDatabase(docker, fakeNetwork({ exposedAddresses: [LAN_ADDRESS] }), await scratchEnvFile())).rejects.toThrow(
      new RegExp(`45322.*${LAN_ADDRESS}`),
    );
    expect(ran("--profile studio down")).toBe(true);
  });
});

describe("startStudio", () => {
  it("refuses before Studio starts when Windows reserves its port", async () => {
    const { docker, ran } = fakeDocker({ dockerPsPorts: DB_AND_STUDIO });

    await expect(startStudio(docker, fakeNetwork({ reservedPorts: [45323] }), await scratchEnvFile())).rejects.toThrow(/reserves port 45323/);
    expect(ran(STUDIO_UP)).toBe(false);
  });

  it("starts Postgres first, then meta, Studio and its login proxy, and requires the proxy's loopback port", async () => {
    const { docker, commands } = fakeDocker({ dockerPsPorts: DB_AND_STUDIO });

    await startStudio(docker, fakeNetwork(), await scratchEnvFile());

    const dbUp = commands.findIndex((command) => command.endsWith("up --detach --wait db"));
    const studioUp = commands.findIndex((command) => command.endsWith(STUDIO_UP));
    expect(dbUp).toBeGreaterThanOrEqual(0);
    expect(studioUp).toBeGreaterThan(dbUp);
  });

  it("takes the stack down when Studio is published directly instead of through the proxy", async () => {
    const { docker, ran } = fakeDocker({ dockerPsPorts: "studio\t127.0.0.1:45323->3000/tcp\ndb\t127.0.0.1:45322->5432/tcp\n" });

    await expect(startStudio(docker, fakeNetwork(), await scratchEnvFile())).rejects.toThrow(/studio-proxy/);
    expect(ran("--profile studio down")).toBe(true);
  });

  it("takes the stack down when Studio did not publish on its loopback port", async () => {
    const { docker, ran } = fakeDocker({ dockerPsPorts: DB_ONLY });

    await expect(startStudio(docker, fakeNetwork(), await scratchEnvFile())).rejects.toThrow(/45323/);
    expect(ran("--profile studio down")).toBe(true);
  });
});

describe("stopStack", () => {
  it("brings down Postgres and Studio together", async () => {
    const envFile = await scratchEnvFile();
    await ensureSupabaseSecrets(envFile);
    const { docker, ran } = fakeDocker();

    await stopStack(docker, envFile);

    expect(ran("--profile studio down")).toBe(true);
  });

  it("adds the Studio password to a pre-Studio-login env file before compose interpolates it", async () => {
    const envFile = await scratchEnvFile();
    await ensureSupabaseSecrets(envFile);
    await writeFile(envFile, "POSTGRES_PASSWORD=kept\nPG_META_CRYPTO_KEY=kept-key\n");
    const { docker, ran } = fakeDocker();

    await stopStack(docker, envFile);

    expect(await readFile(envFile, "utf8")).toMatch(/^POSTGRES_PASSWORD=kept\nPG_META_CRYPTO_KEY=kept-key\nSTUDIO_PASSWORD=[0-9a-f]{48}\n$/);
    expect(ran("--profile studio down")).toBe(true);
  });

  it("tells the user to start the stack when it has no password yet, without calling docker", async () => {
    const { docker, commands } = fakeDocker();

    await expect(stopStack(docker, await scratchEnvFile())).rejects.toThrow(/db:supabase:start/);
    expect(commands).toEqual([]);
  });
});

describe("checkStack", () => {
  it("reports the publishings, the off-loopback probe and the reservations of a healthy stack, read-only", async () => {
    const { docker, commands } = fakeDocker();

    const evidenceLines = await checkStack(docker, fakeNetwork());

    expect(evidenceLines).toEqual([
      "published: db 127.0.0.1:45322->5432/tcp",
      "port 45322 off loopback: no answer",
      "reserved by Windows among 45322, 45323: none",
    ]);
    expect(commands).toEqual([PS_PORTS_COMMAND]);
  });

  it.each([
    ["a non-loopback publishing", { dockerPsPorts: "db\t0.0.0.0:45322->5432/tcp\n" }, {}, /loopback/],
    ["no running stack", { dockerPsPorts: "" }, {}, /nothing published/],
    ["an answer off loopback", {}, { exposedAddresses: [LAN_ADDRESS] }, new RegExp(LAN_ADDRESS)],
    ["a reserved port", {}, { reservedPorts: [45323] }, /reserves port 45323/],
  ])("fails on %s and never takes the stack down", async (_case, dockerOptions, networkOptions, expectedError) => {
    const { docker, ran } = fakeDocker(dockerOptions);

    await expect(checkStack(docker, fakeNetwork(networkOptions))).rejects.toThrow(expectedError);
    expect(ran("down")).toBe(false);
  });
});
