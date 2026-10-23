// Created by The Angelo Umali.
// examples/demo/make_demo.py as a DemoRunner: it generates its own clip, so the demo needs no footage.
import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { buildEngineEnv } from "../tools/engine-runner.ts";

const runFile = promisify(execFile);
const STDERR_TAIL_CHARS = 2000;
/** make_demo.py writes the master here (VIDEO = "v1"). */
const DEMO_MASTER_REL_PATH = "work/out/v1.mp4";

export interface DemoRunner {
  readonly run: (projectRoot: string) => Promise<{ readonly masterRelPath: string }>;
}

export interface DemoRunnerOptions {
  readonly engineDir: string;
  readonly demoScript: string;
  readonly studioHome: string;
}

export function createDemoRunner({ engineDir, demoScript, studioHome }: DemoRunnerOptions): DemoRunner {
  return {
    run: async (projectRoot) => {
      const argv = ["run", "--project", engineDir, "python", demoScript, "--project", projectRoot];
      const env = { ...buildEngineEnv({}), ZKS_HOME: studioHome };
      try {
        await runFile("uv", argv, { cwd: projectRoot, env, shell: false });
      } catch (error) {
        const stderr = typeof error === "object" && error !== null && "stderr" in error ? String(error.stderr) : "";
        throw new Error(`demo render failed: ${stderr.slice(-STDERR_TAIL_CHARS).trim() || String(error)}`, { cause: error });
      }
      await access(join(projectRoot, DEMO_MASTER_REL_PATH));
      return { masterRelPath: DEMO_MASTER_REL_PATH };
    },
  };
}
