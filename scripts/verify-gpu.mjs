// Created by The Angelo Umali.
// pnpm verify:gpu: backend parity on the maintainer's GPU machine (plan §10.3). It runs reviewed upstream commits only, under
// a user that holds no agent config or SSH agent, so it refuses when either is visible. The engine's parity module does the
// renders and exits 0 with a reason when no GPU backend passes the probe.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * @param {Record<string, string | undefined>} env
 * @param {string} home
 * @param {(path: string) => boolean} exists
 * @returns {string | null} why the run is refused, or null when the environment is clean
 */
export function hygieneRefusal(env, home, exists) {
  const agentConfig = join(home, ".claude");
  if (exists(agentConfig)) return `refused: ${agentConfig} is visible; run as a separate user or in the docker nvidia profile`;
  if (env.SSH_AUTH_SOCK) return "refused: SSH_AUTH_SOCK is set; run without an SSH agent";
  return null;
}

/** @returns {[string, string[]]} */
export function engineCommand() {
  return ["uv", ["run", "--project", "packages/engine", "python", "-m", "zks_engine.backends.parity"]];
}

function main() {
  const refusal = hygieneRefusal(process.env, homedir(), existsSync);
  if (refusal) {
    console.error(refusal);
    return 1;
  }
  const [command, args] = engineCommand();
  const run = spawnSync(command, args, { cwd: REPO_ROOT, stdio: "inherit" });
  if (run.error) {
    console.error(`verify:gpu could not start ${command}: ${run.error.message}`);
    return 1;
  }
  return run.status ?? 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main();
