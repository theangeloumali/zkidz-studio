// Created by The Angelo Umali.
// Runs the pinned Caddy image on the compose Caddyfile, with Studio swapped for a stub, to prove which requests reach Studio.
import { spawnSync } from "node:child_process";
import { request } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SUPABASE_COMPOSE_FILE, SUPABASE_STUDIO_PORT, SUPABASE_STUDIO_USERNAME } from "../supabase-stack.ts";

const PROBE_PORT = 45399;
const PROBE_PASSWORD = "probe-password";
const STUDIO_HOST = `127.0.0.1:${SUPABASE_STUDIO_PORT}`;
const CONTAINER_NAME = "zks-studio-proxy-probe";
const hasDocker = spawnSync("docker", ["compose", "version"], { stdio: "ignore" }).status === 0;

interface ComposeConfig {
  readonly services: Record<string, { readonly image?: string }>;
  readonly configs: Record<string, { readonly content?: string }>;
}

function composeConfig(): ComposeConfig {
  const secrets = { POSTGRES_PASSWORD: "unused", PG_META_CRYPTO_KEY: "unused", STUDIO_PASSWORD: "unused" };
  const config = spawnSync("docker", ["compose", "-f", SUPABASE_COMPOSE_FILE, "--profile", "studio", "config", "--format", "json"], {
    encoding: "utf8",
    env: { ...process.env, ...secrets },
  });
  expect(config.status, config.stderr).toBe(0);
  return JSON.parse(config.stdout) as ComposeConfig;
}

function statusOf(headers: Record<string, string>, method = "GET"): Promise<number> {
  const credentials = Buffer.from(`${SUPABASE_STUDIO_USERNAME}:${PROBE_PASSWORD}`).toString("base64");
  return new Promise((resolve, reject) => {
    const probe = request(
      { host: "127.0.0.1", port: PROBE_PORT, method, path: "/", headers: { Host: STUDIO_HOST, Authorization: `Basic ${credentials}`, ...headers } },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      },
    );
    probe.on("error", reject);
    probe.end();
  });
}

async function waitForProxy(): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await statusOf({}).catch(() => 0)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("the probe proxy never answered");
}

describe.skipIf(!hasDocker)("Studio proxy (real Caddy)", () => {
  let scratchDir = "";

  beforeAll(async () => {
    const config = composeConfig();
    const image = config.services["studio-proxy"]?.image ?? "";
    const caddyfile = (config.configs["studio-proxy-caddyfile"]?.content ?? "").replace("reverse_proxy studio:3000", 'respond "studio" 200');
    expect(caddyfile).toContain('respond "studio" 200');
    scratchDir = await mkdtemp(join(tmpdir(), "zks-proxy-"));
    await writeFile(join(scratchDir, "Caddyfile"), caddyfile);
    const hash = spawnSync("docker", ["run", "--rm", "-i", image, "caddy", "hash-password"], { input: `${PROBE_PASSWORD}\n`, encoding: "utf8" });
    expect(hash.status, hash.stderr).toBe(0);
    spawnSync("docker", ["rm", "-f", CONTAINER_NAME], { stdio: "ignore" });
    const run = spawnSync(
      "docker",
      [
        "run",
        "-d",
        "--name",
        CONTAINER_NAME,
        "-p",
        `127.0.0.1:${PROBE_PORT}:${SUPABASE_STUDIO_PORT}`,
        "-e",
        `STUDIO_USERNAME=${SUPABASE_STUDIO_USERNAME}`,
        "-e",
        `STUDIO_PASSWORD_HASH=${hash.stdout.trim()}`,
        "-v",
        `${join(scratchDir, "Caddyfile")}:/etc/caddy/Caddyfile:ro`,
        image,
        "caddy",
        "run",
        "--config",
        "/etc/caddy/Caddyfile",
        "--adapter",
        "caddyfile",
      ],
      { encoding: "utf8" },
    );
    expect(run.status, run.stderr).toBe(0);
    await waitForProxy();
  }, 120_000);

  afterAll(async () => {
    spawnSync("docker", ["rm", "-f", CONTAINER_NAME], { stdio: "ignore" });
    if (scratchDir) await rm(scratchDir, { recursive: true, force: true });
  });

  it("lets the user's own tab and a plain curl through", async () => {
    expect(await statusOf({ "Sec-Fetch-Site": "same-origin", Origin: `http://${STUDIO_HOST}` }, "POST")).toBe(200);
    expect(await statusOf({ "Sec-Fetch-Site": "none" })).toBe(200);
    expect(await statusOf({})).toBe(200);
  });

  // The browser attaches cached basic-auth credentials to cross-site requests, so the login alone does not stop CSRF.
  it("refuses a cross-site or same-site request even with valid credentials", async () => {
    expect(await statusOf({ "Sec-Fetch-Site": "cross-site", Origin: "https://evil.example" }, "POST")).toBe(403);
    expect(await statusOf({ "Sec-Fetch-Site": "same-site", Origin: "http://127.0.0.1:8080" }, "POST")).toBe(403);
  });

  it("refuses a foreign Origin from a browser that sends no Sec-Fetch-Site", async () => {
    expect(await statusOf({ Origin: "https://evil.example" }, "POST")).toBe(403);
    expect(await statusOf({ Origin: "null" }, "POST")).toBe(403);
  });

  it("still answers 421 to a foreign Host", async () => {
    expect(await statusOf({ Host: "evil.example" })).toBe(421);
  });
});
