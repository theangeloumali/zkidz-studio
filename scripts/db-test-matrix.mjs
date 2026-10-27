// Created by The Angelo Umali.
// Runs packages/db tests on both backends: PGlite (DATABASE_URL unset), then local Supabase Postgres (plan §8, §14 slices 0a and 7a).
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const SUPABASE_CLI = fileURLToPath(new URL("../packages/db/scripts/supabase.ts", import.meta.url));

/** The stack's password is generated per install, so the URL comes from its env file, never a default. */
function localSupabaseUrl() {
  const urlRun = spawnSync(process.execPath, [SUPABASE_CLI, "url"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  if (urlRun.status !== 0) throw new Error("No local Supabase stack: run pnpm db:supabase:start first, or set ZKS_TEST_DATABASE_URL.");
  return urlRun.stdout.trim();
}

/**
 * @param {Record<string, string | undefined>} parentEnv
 * @param {() => string} resolveSupabaseUrl called only when ZKS_TEST_DATABASE_URL is unset
 * @returns {{ label: string, env: Record<string, string | undefined> }[]}
 */
export function buildMatrixLegs(parentEnv, resolveSupabaseUrl = localSupabaseUrl) {
  const { DATABASE_URL: _ignoredUrl, ...envWithoutDatabase } = parentEnv;
  return [
    { label: "pglite", env: envWithoutDatabase },
    { label: "postgres", env: { ...envWithoutDatabase, DATABASE_URL: parentEnv.ZKS_TEST_DATABASE_URL ?? resolveSupabaseUrl() } },
  ];
}

function runMatrix() {
  for (const leg of buildMatrixLegs(process.env)) {
    console.log(`db:test:matrix: ${leg.label}`);
    // Fixed argv; the shell is only there so Windows resolves pnpm.cmd.
    const testRun = spawnSync("pnpm", ["-F", "@zks/db", "test"], { env: leg.env, stdio: "inherit", shell: process.platform === "win32" });
    if (testRun.status !== 0) {
      process.exitCode = testRun.status ?? 1;
      return;
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) runMatrix();
