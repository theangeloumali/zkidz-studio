// Created by The Angelo Umali.
// The production BuildComposition: one long-lived `node hf/preview/worker.js`, forked with argv only and a minimal env,
// that keeps the composition modules loaded between builds. A fresh node per build spent ~1.9 s loading them.
import { fork, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { BuildComposition, PreviewBuildRequest } from "./preview-service.ts";

// dry-new: tools/engine-runner.ts keeps its env allowlist private and its command union closed. A preview build runs
// plain node with no Chrome or ffmpeg, so it needs even less of the server's env, which carries credentials (plan §11).
const INHERITED_ENV_NAMES = ["PATH", "SystemRoot", "TMP", "TEMP", "TMPDIR"];

export interface CompositionBuilderOptions {
  /** packages/engine/hf/preview/worker.js in production. */
  readonly workerScriptPath: string;
  readonly studioHome: string;
  /** Extra variables to pass through, for tests. */
  readonly inheritEnv?: readonly string[];
}

export type CompositionBuilder = BuildComposition & { readonly close: () => void };

interface WorkerReply {
  readonly id: number;
  readonly ok: boolean;
  readonly error?: string;
}

interface PendingBuild {
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
}

export function createCompositionBuilder(options: CompositionBuilderOptions): CompositionBuilder {
  const pending = new Map<number, PendingBuild>();
  let worker: ChildProcess | undefined;
  let nextId = 1;

  const startWorker = (): ChildProcess => {
    const names = [...INHERITED_ENV_NAMES, ...(options.inheritEnv ?? [])];
    const env = { ...Object.fromEntries(names.flatMap((name) => (process.env[name] ? [[name, process.env[name]]] : []))), ZKS_HOME: options.studioHome };
    const child = fork(options.workerScriptPath, [], { env, stdio: ["ignore", "ignore", "pipe", "ipc"], serialization: "json" });
    child.stderr?.resume();
    // The worker never keeps the server (or a test run) alive on its own.
    child.unref();
    child.channel?.unref();
    child.on("message", (reply: WorkerReply) => {
      const build = pending.get(reply.id);
      pending.delete(reply.id);
      if (reply.ok) build?.resolve();
      else build?.reject(new Error(`preview build failed: ${reply.error ?? "unknown error"}`));
    });
    // Every build in flight dies with the worker; the next build forks a new one.
    child.on("exit", (code, signal) => {
      if (worker === child) worker = undefined;
      for (const build of pending.values()) build.reject(new Error(`preview build failed: preview worker exited (${signal ?? code})`));
      pending.clear();
    });
    return child;
  };

  const build = async ({ projectRoot, videoId }: PreviewBuildRequest): Promise<void> => {
    const workDir = join(projectRoot, "work");
    await mkdir(workDir, { recursive: true });
    worker ??= startWorker();
    const id = nextId++;
    const done = new Promise<void>((resolve, reject) => pending.set(id, { resolve, reject }));
    worker.send({ id, work: workDir, video: videoId });
    return done;
  };

  return Object.assign(build, {
    close: () => {
      worker?.kill();
      worker = undefined;
    },
  });
}
