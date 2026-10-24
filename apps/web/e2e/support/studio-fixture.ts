// Created by The Angelo Umali.
// One real studio server per worker: a free port, a scratch ZKS_HOME, FakeAgent as the agent.
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { test as base, expect } from "@playwright/test";
import { ProjectSchema } from "@zks/shared";
import { z } from "zod";
import { SERVER_READY_PREFIX } from "./ready-line.ts";

export { expect };

export const FIXTURE_CLIP = fileURLToPath(new URL("../../../../fixtures/parity/clip-2997.mp4", import.meta.url));
const SERVER_ENTRY = fileURLToPath(new URL("../harness/studio-server.ts", import.meta.url));
// Cold TS imports of the full server graph take minutes on a 9p (WSL /mnt/c) checkout.
const SERVER_START_TIMEOUT_MS = 240_000;
const ReadyLineSchema = z.object({ studioHome: z.string() });

export interface StudioServer {
  readonly baseURL: string;
  readonly studioHome: string;
  readonly projectSlug: (projectId: string) => Promise<string>;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => (typeof address === "object" && address !== null ? resolve(address.port) : reject(new Error("no port assigned"))));
    });
  });
}

function waitForReadyLine(child: ChildProcess): Promise<z.infer<typeof ReadyLineSchema>> {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`studio server not ready in ${SERVER_START_TIMEOUT_MS} ms:\n${output}`)), SERVER_START_TIMEOUT_MS);
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      const readyLine = output.split("\n").find((line) => line.startsWith(SERVER_READY_PREFIX));
      if (readyLine === undefined) return;
      clearTimeout(timer);
      resolve(ReadyLineSchema.parse(JSON.parse(readyLine.slice(SERVER_READY_PREFIX.length))));
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`studio server exited (${code}) before it was ready:\n${output}`));
    });
  });
}

export const test = base.extend<object, { studio: StudioServer; frozenMaster: boolean }>({
  // true swaps every rendered master for a frozen copy and replays render-frozen; a worker option, so it gets its own server.
  frozenMaster: [false, { scope: "worker", option: true }],
  studio: [
    async ({ frozenMaster }, provide) => {
      const port = await freePort();
      let previewPort = await freePort();
      while (previewPort === port) previewPort = await freePort();
      const env = { ...process.env, ZKS_E2E_PORT: String(port), ZKS_E2E_PREVIEW_PORT: String(previewPort), ZKS_E2E_FROZEN_MASTER: frozenMaster ? "1" : "0" };
      const child = spawn(process.execPath, [SERVER_ENTRY], { env, stdio: ["ignore", "pipe", "pipe"] });
      const exited = new Promise((resolve) => child.once("exit", resolve));
      try {
        const { studioHome } = await waitForReadyLine(child);
        const baseURL = `http://127.0.0.1:${port}`;
        const projectSlug = async (projectId: string) => {
          const response = await fetch(`${baseURL}/api/projects/${projectId}`);
          return ProjectSchema.parse(await response.json()).slug;
        };
        await provide({ baseURL, studioHome, projectSlug });
      } finally {
        child.kill("SIGTERM");
        await exited;
      }
    },
    { scope: "worker", timeout: SERVER_START_TIMEOUT_MS * 2 },
  ],
  baseURL: async ({ studio }, provide) => {
    await provide(studio.baseURL);
  },
});
