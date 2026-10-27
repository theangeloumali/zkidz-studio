// Created by The Angelo Umali.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const COMPOSE_FILE = join(REPO_ROOT, "docker/compose.yml");
const dockerComposeInstalled = spawnSync("docker", ["compose", "version"]).status === 0;

/** The compose model after interpolation, with every profile enabled so the nvidia service is included. */
function resolvedCompose() {
  const result = spawnSync("docker", ["compose", "-f", COMPOSE_FILE, "--profile", "*", "config", "--format", "json"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout);
}

describe.skipIf(!dockerComposeInstalled)("docker/compose.yml", () => {
  it("publishes only 127.0.0.1:4317 on every service", () => {
    const services = Object.values(resolvedCompose().services);
    const publishings = services.flatMap((service) => service.ports ?? []).map((port) => `${port.host_ip}:${port.published}:${port.target}`);
    expect(publishings.length).toBeGreaterThan(0);
    expect(new Set(publishings)).toEqual(new Set(["127.0.0.1:4317:4317"]));
  });

  it("runs every service in container mode with ZKS_HOME on the zks-home volume", () => {
    const compose = resolvedCompose();
    for (const service of Object.values(compose.services)) {
      expect(service.environment.ZKS_CONTAINER).toBe("1");
      const homeMount = service.volumes.find((/** @type {{ target: string }} */ volume) => volume.target === service.environment.ZKS_HOME);
      expect(homeMount).toMatchObject({ type: "volume", source: "zks-home" });
    }
    expect(Object.keys(compose.volumes)).toContain("zks-home");
  });

  it("builds locally and never pulls the app image from a registry", () => {
    for (const service of Object.values(resolvedCompose().services)) {
      expect(service.build).toBeDefined();
      expect(service.pull_policy).toBe("build");
    }
  });

  it("starts only the default service without a profile, and the nvidia service requests the video capability", () => {
    const { services } = resolvedCompose();
    const unprofiled = Object.entries(services).filter(([, service]) => !service.profiles);
    expect(unprofiled.map(([name]) => name)).toEqual(["studio"]);
    const nvidia = services["studio-nvidia"];
    expect(nvidia.profiles).toEqual(["nvidia"]);
    const [device] = nvidia.deploy.resources.reservations.devices;
    expect(device.driver).toBe("nvidia");
    expect(device.capabilities).toEqual(expect.arrayContaining(["gpu", "video"]));
    expect(nvidia.environment.NVIDIA_DRIVER_CAPABILITIES.split(",")).toEqual(expect.arrayContaining(["compute", "utility", "video"]));
  });
});

describe("docker/Dockerfile", () => {
  const dockerfile = readFileSync(join(REPO_ROOT, "docker/Dockerfile"), "utf8");

  it("pins every base image by digest", () => {
    const fromLines = dockerfile.split("\n").filter((line) => /^FROM\s/i.test(line));
    expect(fromLines.length).toBeGreaterThan(0);
    for (const line of fromLines.filter((line) => !/^FROM\s+(builder|base)\b/i.test(line))) expect(line).toMatch(/@sha256:[0-9a-f]{64}/);
  });

  it("installs the tools through the checksummed setup script and runs as a non-root user", () => {
    expect(dockerfile).toMatch(/setup\.sh --no-start/);
    expect(dockerfile).toMatch(/^USER\s+node\s*$/m);
  });
});

describe(".dockerignore", () => {
  const dockerignore = readFileSync(join(REPO_ROOT, ".dockerignore"), "utf8");
  const ignored = dockerignore.split("\n");

  it("keeps git history, local agent state and the root env file out of the build context", () => {
    for (const pattern of [".git", ".claude", "**/.env", "**/.env.*", "!**/.env.example", "**/node_modules", "**/media"]) expect(ignored).toContain(pattern);
  });

  // Docker matches unprefixed patterns only at the context root, while .gitignore matches them at any depth.
  it("mirrors every unanchored .gitignore pattern at any depth", () => {
    const gitignorePatterns = readFileSync(join(REPO_ROOT, ".gitignore"), "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"))
      .filter((line) => !line.replace(/\/$/, "").includes("/"));
    expect(gitignorePatterns.length).toBeGreaterThan(0);
    for (const pattern of gitignorePatterns) {
      const negated = pattern.startsWith("!");
      const body = pattern.replace(/^!/, "").replace(/\/$/, "");
      expect(ignored, pattern).toContain(`${negated ? "!" : ""}**/${body}`);
    }
  });
});

describe.skipIf(!dockerComposeInstalled)(".dockerignore in a real build", () => {
  const SECRET_FIXTURES = [
    ".env",
    "apps/server/.env",
    "apps/server/.env.local",
    ".npmrc",
    "apps/server/.npmrc",
    "key.pem",
    "apps/server/certs/key.pem",
    "apps/server/signing.key",
    "apps/server/config.secrets.json",
    "apps/server/data/studio.db",
    "packages/engine/models/ggml-base.bin",
    "packages/engine/weights.gguf",
    "apps/server/media/take.mp4",
    "apps/server/raw/CLIP.MP4",
    "apps/web/dist/index.html",
  ];
  const KEPT_FIXTURES = ["apps/server/src/main.ts", "apps/server/.env.example", ".env.example"];
  let contextDir = "";

  beforeAll(() => {
    contextDir = mkdtempSync(join(tmpdir(), "zks-dockerignore-"));
    copyFileSync(join(REPO_ROOT, ".dockerignore"), join(contextDir, ".dockerignore"));
    writeFileSync(join(contextDir, "Dockerfile"), "FROM scratch\nCOPY . /ctx/\n");
    for (const fixture of [...SECRET_FIXTURES, ...KEPT_FIXTURES]) {
      mkdirSync(dirname(join(contextDir, fixture)), { recursive: true });
      writeFileSync(join(contextDir, fixture), "fixture");
    }
  });
  afterAll(() => rmSync(contextDir, { recursive: true, force: true }));

  it("copies source and env examples but no nested secret, local data, model, media or build output", () => {
    const outputDir = join(contextDir, "..", `${basename(contextDir)}-out`);
    try {
      const build = spawnSync("docker", ["build", "--quiet", "--output", `type=local,dest=${outputDir}`, contextDir], { encoding: "utf8" });
      expect(build.status, build.stderr).toBe(0);
      const copied = readdirSync(join(outputDir, "ctx"), { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => relative(join(outputDir, "ctx"), join(entry.parentPath, entry.name)).split(sep).join("/"));
      for (const fixture of KEPT_FIXTURES) expect(copied).toContain(fixture);
      expect(copied.filter((path) => SECRET_FIXTURES.includes(path))).toEqual([]);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  }, 120_000);
});

describe(".env.example", () => {
  const envExample = readFileSync(join(REPO_ROOT, ".env.example"), "utf8");

  // db:supabase:start generates the password per install (plan §8), so an example with Supabase's default would teach the hole.
  it("never shows the default postgres password and points at the generated URL", () => {
    expect(envExample).not.toMatch(/postgres(ql)?:\/\/postgres:postgres@/);
    expect(envExample).toMatch(/^DATABASE_URL=$/m);
    expect(envExample).toMatch(/pnpm (--silent )?db:supabase:url/);
  });

  it("holds no secret-looking variable", () => {
    expect(envExample).not.toMatch(/^(ANTHROPIC_API_KEY|SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY|POSTGRES_PASSWORD)=/m);
  });
});
