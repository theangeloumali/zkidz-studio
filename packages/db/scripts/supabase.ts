// Created by The Angelo Umali.
// db:supabase:start | stop | studio | url | check: the optional local Supabase Postgres (plan §8), run through supabase/compose.yml.
import { spawnSync } from "node:child_process";
import { LOOPBACK_HOST, SUPABASE_DB_PORT } from "@zks/shared";
import { checkStack, type DockerCli, startDatabase, startStudio, stopStack } from "./supabase-commands.ts";
import { hostNetwork } from "./supabase-exposure.ts";
import { readSupabaseSecrets, SUPABASE_STUDIO_PORT, SUPABASE_STUDIO_USERNAME, supabaseDatabaseUrl, supabaseEnvFile } from "./supabase-stack.ts";

const USAGE = "Usage: supabase.ts start | stop | studio | url | check";
const USAGE_EXIT_CODE = 2;

function runDocker(args: readonly string[], { capture }: { capture: boolean }): string {
  const result = spawnSync("docker", args, { encoding: "utf8", stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit" });
  if (result.error) throw new Error(`Docker is not available (${result.error.message}). Install Docker, or leave DATABASE_URL unset to use PGlite.`);
  if (result.status !== 0) throw new Error(`docker ${args.join(" ")} exited ${result.status ?? "on a signal"}`);
  return result.stdout ?? "";
}

const dockerCli: DockerCli = {
  run: (args) => void runDocker(args, { capture: false }),
  read: (args) => runDocker(args, { capture: true }),
  succeeds: (args) => spawnSync("docker", args, { stdio: "ignore" }).status === 0,
};

async function main(command: string | undefined): Promise<void> {
  const envFile = supabaseEnvFile();
  if (command === "start") {
    // Plan §8 prints the literal line; the inline form works without any env-file loader.
    console.log(`DATABASE_URL=${await startDatabase(dockerCli, hostNetwork, envFile)}`);
    console.log(
      `Supabase Postgres is up on ${LOOPBACK_HOST}:${SUPABASE_DB_PORT}. Run the app on it with: DATABASE_URL=$(pnpm --silent db:supabase:url) pnpm start`,
    );
  } else if (command === "studio") {
    await startStudio(dockerCli, hostNetwork, envFile);
    console.log(`Supabase Studio: http://${LOOPBACK_HOST}:${SUPABASE_STUDIO_PORT}`);
    // The password stays in the 0600 file, so a pasted log never carries it.
    console.log(`Log in as user ${SUPABASE_STUDIO_USERNAME}; the password is STUDIO_PASSWORD in ${envFile}. Run pnpm db:supabase:stop when done.`);
  } else if (command === "stop") {
    await stopStack(dockerCli, envFile);
  } else if (command === "url") {
    console.log(supabaseDatabaseUrl((await readSupabaseSecrets(envFile)).postgresPassword));
  } else if (command === "check") {
    for (const evidenceLine of await checkStack(dockerCli, hostNetwork)) console.log(evidenceLine);
  } else {
    console.error(USAGE);
    process.exitCode = USAGE_EXIT_CODE;
  }
}

try {
  await main(process.argv.slice(2).find((argument) => argument !== "--"));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
