// Created by The Angelo Umali.
// `zks doctor --json` in a child process: its checks block on spawnSync for up to minutes, and its context rewrites process.env.
import { execFile } from "node:child_process";

/** The CLI's raw report, untrusted until the route parses it. */
export type DoctorRunner = () => Promise<unknown>;

export interface CliDoctorOptions {
  /** packages/cli/src/main.ts; Node runs the .ts directly. */
  readonly cliEntry: string;
  readonly studioHome: string;
}

// Chrome's test render alone may take 60 s, and each GPU encoder test 20 s.
const DOCTOR_TIMEOUT_MS = 300_000;
const STDERR_TAIL_CHARS = 2000;

export function createCliDoctorRunner(options: CliDoctorOptions): DoctorRunner {
  const env = { ...process.env, ZKS_HOME: options.studioHome };
  return () =>
    new Promise((resolve, reject) => {
      execFile(process.execPath, [options.cliEntry, "doctor", "--json"], { env, timeout: DOCTOR_TIMEOUT_MS, shell: false }, (error, stdout, stderr) => {
        // Exit 1 only means a required check failed; the report is still on stdout.
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error(`zks doctor failed: ${stderr.slice(-STDERR_TAIL_CHARS).trim() || (error?.message ?? "no JSON on stdout")}`, { cause: error }));
        }
      });
    });
}
