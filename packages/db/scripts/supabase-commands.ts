// Created by The Angelo Umali.
// db:supabase:start | studio | stop | check (plan §8), with docker and the host network injected so the guards test without either.
import { access } from "node:fs/promises";
import { SUPABASE_DB_PORT } from "@zks/shared";
import {
  assertLoopbackPublishing,
  composeArgs,
  DOCKER_PS_PORTS_ARGS,
  ensureSupabaseSecrets,
  formatDockerPsPorts,
  readSupabaseSecrets,
  SUPABASE_DATA_VOLUME,
  SUPABASE_STUDIO_PORT,
  SUPABASE_STUDIO_PROXY_SERVICE,
  supabaseDatabaseUrl,
} from "./supabase-stack.ts";
import type { HostNetwork } from "./supabase-exposure.ts";

export interface DockerCli {
  /** Runs docker with its output shown to the user; throws on a non-zero exit. */
  run(args: readonly string[]): void;
  /** Runs docker and returns its stdout; throws on a non-zero exit. */
  read(args: readonly string[]): string;
  /** Whether docker exits 0; output discarded. */
  succeeds(args: readonly string[]): boolean;
}

const STACK_DOWN = ["--profile", "studio", "down"];
const STACK_PORTS = [SUPABASE_DB_PORT, SUPABASE_STUDIO_PORT];

/** Starts Postgres only and returns the DATABASE_URL for it. */
export async function startDatabase(docker: DockerCli, network: HostNetwork, envFile: string): Promise<string> {
  // A new password cannot open a volume initialised with the old one, so refuse instead of starting a stack that rejects every login.
  if (!(await isPresent(envFile)) && docker.succeeds(["volume", "inspect", SUPABASE_DATA_VOLUME])) {
    throw new Error(
      `${envFile} is missing but the data volume ${SUPABASE_DATA_VOLUME} exists. Restore the file, or delete the data with: docker volume rm ${SUPABASE_DATA_VOLUME}`,
    );
  }
  assertNotReserved(network, [SUPABASE_DB_PORT]);
  const { postgresPassword } = await ensureSupabaseSecrets(envFile);
  docker.run(composeArgs(envFile, ["up", "--detach", "--wait", "db"]));
  await assertLocalOnlyOrStop({ docker, network, envFile }, SUPABASE_DB_PORT);
  return supabaseDatabaseUrl(postgresPassword);
}

export async function startStudio(docker: DockerCli, network: HostNetwork, envFile: string): Promise<void> {
  await startDatabase(docker, network, envFile);
  assertNotReserved(network, [SUPABASE_STUDIO_PORT]);
  docker.run(composeArgs(envFile, ["--profile", "studio", "up", "--detach", "--wait", "meta", "studio", SUPABASE_STUDIO_PROXY_SERVICE]));
  await assertLocalOnlyOrStop({ docker, network, envFile }, SUPABASE_STUDIO_PORT);
}

/** db:supabase:check: the running stack's evidence lines for doctor and the per-OS port check; read-only, throws on any failure. */
export async function checkStack(docker: DockerCli, network: HostNetwork): Promise<string[]> {
  const dockerPsPorts = docker.read(DOCKER_PS_PORTS_ARGS);
  assertLoopbackPublishing(dockerPsPorts, SUPABASE_DB_PORT);
  await assertNotExposed(network, SUPABASE_DB_PORT);
  assertNotReserved(network, STACK_PORTS);
  return [
    `published: ${formatDockerPsPorts(dockerPsPorts)}`,
    `port ${SUPABASE_DB_PORT} off loopback: no answer`,
    `reserved by Windows among ${STACK_PORTS.join(", ")}: none`,
  ];
}

export async function stopStack(docker: DockerCli, envFile: string): Promise<void> {
  // compose interpolates the passwords even for `down`: a missing file fails here with the start hint, an old one gains its Studio key.
  await readSupabaseSecrets(envFile);
  // `down` keeps the named volume; the data survives until someone removes it by hand.
  docker.run(composeArgs(envFile, STACK_DOWN));
}

/** An exposed stack is never left running: take it all down, then report. */
async function assertLocalOnlyOrStop(
  { docker, network, envFile }: { docker: DockerCli; network: HostNetwork; envFile: string },
  requiredHostPort: number,
): Promise<void> {
  try {
    assertLoopbackPublishing(docker.read(DOCKER_PS_PORTS_ARGS), requiredHostPort);
    // The publishing can say 127.0.0.1 while a runtime's port forwarder still listens wider; only a connection proves it.
    await assertNotExposed(network, requiredHostPort);
  } catch (error) {
    docker.run(composeArgs(envFile, STACK_DOWN));
    throw error;
  }
}

async function assertNotExposed(network: HostNetwork, port: number): Promise<void> {
  const exposedAddresses = await network.findExposedAddresses(port);
  if (exposedAddresses.length > 0) {
    throw new Error(`Port ${port} answers on non-loopback addresses (${exposedAddresses.join(", ")}); other machines could reach the database.`);
  }
}

// Hyper-V reserves moving ranges (spike 03 lost 55322 to one); restarting winnat releases the dynamic ones.
function assertNotReserved(network: HostNetwork, ports: readonly number[]): void {
  const reservedPorts = network.findReservedPorts(ports);
  if (reservedPorts.length > 0) {
    throw new Error(
      `Windows reserves port ${reservedPorts.join(", ")} (netsh interface ipv4 show excludedportrange protocol=tcp). From an administrator prompt run: net stop winnat && net start winnat`,
    );
  }
}

function isPresent(filePath: string): Promise<boolean> {
  return access(filePath).then(
    () => true,
    () => false,
  );
}
