// Created by The Angelo Umali.
// pnpm verify:gpu: backend parity on the maintainer's GPU machine (plan §10.3). It runs reviewed upstream commits only, under
// a user that holds no agent config, SSH keys or gh auth, so it refuses when any is visible. The engine's parity module does the
// renders and exits 0 with a reason when no GPU backend passes the probe.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SECRET_PATHS = [".claude", ".ssh", join(".config", "gh", "hosts.yml")];
const SECRET_VARIABLES = ["SSH_AUTH_SOCK", "GH_TOKEN", "GITHUB_TOKEN", "ANTHROPIC_API_KEY"];
const ENGINE_VARIABLES = ["PATH", "HOME", "LANG", "TMPDIR", "XDG_CACHE_HOME", "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA"];
const ENGINE_PREFIXES = ["ZKS_", "UV_"];

/**
 * os.homedir() honours $HOME, so the passwd home and USERPROFILE are checked too: a scratch HOME must not hide the real one.
 * @param {Record<string, string | undefined>} env
 * @param {string} osHome
 * @param {string} passwdHome
 * @returns {string[]}
 */
export function candidateHomes(env, osHome, passwdHome) {
  return [...new Set([osHome, passwdHome, env.USERPROFILE].filter(/** @returns {home is string} */ (home) => typeof home === "string" && home !== ""))];
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {string[]} homes
 * @param {(path: string) => boolean} exists
 * @returns {string | null} why the run is refused, or null when the environment is clean
 */
export function hygieneRefusal(env, homes, exists) {
  for (const home of homes) {
    for (const secretPath of SECRET_PATHS) {
      const visible = join(home, secretPath);
      if (exists(visible)) return `refused: ${visible} is visible; run as a separate user or in the docker nvidia profile`;
    }
  }
  const exported = SECRET_VARIABLES.find((name) => env[name]);
  if (exported) return `refused: ${exported} is set; run without credentials in the environment`;
  return null;
}

/**
 * @param {string} porcelainStatus `git status --porcelain`
 * @param {string} remoteBranches `git branch -r --contains HEAD`
 * @returns {string | null}
 */
export function treeRefusal(porcelainStatus, remoteBranches) {
  if (porcelainStatus.trim()) return "refused: the checkout has uncommitted changes; run on a reviewed, pushed commit";
  if (!remoteBranches.trim()) return "refused: HEAD is not on any remote branch; push the reviewed commit upstream first";
  return null;
}

/** @returns {[string, string[]]} */
export function engineCommand() {
  return ["uv", ["run", "--project", "packages/engine", "python", "-m", "zks_engine.backends.parity"]];
}

/**
 * The repo's own code runs with only what it needs, so a token in the maintainer's shell never reaches it.
 * @param {Record<string, string | undefined>} env
 * @returns {Record<string, string>}
 */
export function engineEnv(env) {
  /** @type {Record<string, string>} */
  const allowed = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (ENGINE_VARIABLES.includes(name) || ENGINE_PREFIXES.some((prefix) => name.startsWith(prefix))) allowed[name] = value;
  }
  return allowed;
}

/** @param {string[]} args */
function git(args) {
  const run = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
  return run.status === 0 ? run.stdout : "";
}

function main() {
  const refusal =
    hygieneRefusal(process.env, candidateHomes(process.env, homedir(), userInfo().homedir), existsSync) ??
    treeRefusal(git(["status", "--porcelain"]), git(["branch", "-r", "--contains", "HEAD"]));
  if (refusal) {
    console.error(refusal);
    return 1;
  }
  const [command, args] = engineCommand();
  const run = spawnSync(command, args, { cwd: REPO_ROOT, stdio: "inherit", env: engineEnv(process.env) });
  if (run.error) {
    console.error(`verify:gpu could not start ${command}: ${run.error.message}`);
    return 1;
  }
  return run.status ?? 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main();
