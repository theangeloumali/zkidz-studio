// Created by The Angelo Umali.
// Runs packages/db tests on both backends: PGlite (DATABASE_URL unset), then local Supabase Postgres (plan §8, §14 slice 0a).
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { LOOPBACK_HOST, SUPABASE_DB_PORT } from "@zks/shared";

/** Loopback-only dev password from the Supabase CLI; never a real credential (plan §8). */
export const DEFAULT_SUPABASE_TEST_URL = `postgresql://postgres:postgres@${LOOPBACK_HOST}:${SUPABASE_DB_PORT}/postgres`;

/**
 * @param {Record<string, string | undefined>} parentEnv
 * @returns {{ label: string, env: Record<string, string | undefined> }[]}
 */
export function buildMatrixLegs(parentEnv) {
  const { DATABASE_URL: _ignoredUrl, ...envWithoutDatabase } = parentEnv;
  return [
    { label: "pglite", env: envWithoutDatabase },
    { label: "postgres", env: { ...envWithoutDatabase, DATABASE_URL: parentEnv.ZKS_TEST_DATABASE_URL ?? DEFAULT_SUPABASE_TEST_URL } },
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
