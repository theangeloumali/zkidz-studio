// Created by The Angelo Umali.
import { loadToolsLock, pinnedExecutablePath, platformKey } from "@zks/shared/node";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEngineProcessRunner, EngineReportedError, pinnedEngineTools } from "../../src/jobs/engine-process.ts";
import { withSpecSnapshotDir } from "../../src/jobs/spec-snapshot.ts";

const FAKE_ENGINE = fileURLToPath(new URL("./fixtures/fake-engine.mjs", import.meta.url));
const PINNED_TOOLS = { ffmpegPath: "/pinned/tools/ffmpeg", chromePath: "/pinned/tools/chrome-headless-shell" };
const KILL_DEADLINE_MS = 3000;

let scratchDir: string;
beforeAll(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), "zks-engine-process-"));
});
afterAll(async () => {
  await rm(scratchDir, { recursive: true, force: true });
});

function fakeEngineRunner(parentEnv: Record<string, string | undefined>, options: { proxyOptIn?: boolean; killGraceMs?: number } = {}) {
  return createEngineProcessRunner({
    executable: process.execPath,
    prefixArgs: [FAKE_ENGINE],
    studioHome: scratchDir,
    tools: PINNED_TOOLS,
    parentEnv,
    ...options,
  });
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(condition: () => Promise<boolean> | boolean): Promise<void> {
  const deadline = Date.now() + KILL_DEADLINE_MS;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("engine process spawn", () => {
  it("runs `<command> --json <args>` in the work dir and parses the report", async () => {
    const report = await fakeEngineRunner({ PATH: process.env.PATH }).run({ command: "env", args: ["--video", "v1"], workDir: scratchDir });
    expect(report).toMatchObject({ argv: ["env", "--json", "--video", "v1"], cwd: scratchDir });
  });

  it("registers the request's in-place files with the engine", async () => {
    const inPlacePaths = [join(scratchDir, "a.mp4"), join(scratchDir, "b.mp4")];
    const report = await fakeEngineRunner({ PATH: process.env.PATH }).run({ command: "env", args: [], workDir: scratchDir, inPlacePaths });
    expect(report).toMatchObject({ env: { ZKS_INPLACE: inPlacePaths.join(delimiter) } });
  });

  it("hands the engine an allowlisted env with its backend pin, never the server's credentials", async () => {
    const hostileParent = {
      PATH: process.env.PATH,
      LC_ALL: "C.UTF-8",
      ZKS_BACKEND: "cpu",
      HTTPS_PROXY: "http://proxy.invalid",
      ANTHROPIC_API_KEY: "sk-secret",
      ANTHROPIC_BASE_URL: "http://evil.invalid",
      CLAUDE_CODE_OAUTH_TOKEN: "oauth-secret",
      CLAUDE_CONFIG_DIR: "/home/someone/.claude",
      AWS_SECRET_ACCESS_KEY: "aws-secret",
      DATABASE_URL: "postgres://db.invalid/zks",
      ZKS_MCP_TOKEN: "session-secret",
      ZKS_INPLACE: "/home/someone/secrets.mp4",
    };
    const report = (await fakeEngineRunner(hostileParent).run({ command: "env", args: [], workDir: scratchDir })) as { env: Record<string, string> };
    expect(report.env).toMatchObject({ LC_ALL: "C.UTF-8", ZKS_BACKEND: "cpu", ZKS_INPLACE: "" });
    const leaked = Object.keys(report.env).filter((name) => /^(ANTHROPIC_|CLAUDE_|AWS_|DATABASE_URL$|ZKS_MCP_|HTTPS_PROXY$)/.test(name));
    expect(leaked).toEqual([]);
  });

  it("rejects with the engine's own error code and reason, so a tool can show the reason alone", async () => {
    const failure = fakeEngineRunner({ PATH: process.env.PATH }).run({ command: "gate", args: [], workDir: scratchDir });

    await expect(failure).rejects.toBeInstanceOf(EngineReportedError);
    await expect(failure).rejects.toMatchObject({ code: "gate_failed", reason: `${join("$ZKS_HOME", "projects", "demo")} has no QC report` });
  });

  it("passes the pinned ZKS_FFMPEG and ZKS_CHROME to every spawn, over the parent's own values", async () => {
    const runner = fakeEngineRunner({ PATH: process.env.PATH, ZKS_FFMPEG: "/usr/bin/ffmpeg", ZKS_CHROME: "/usr/bin/chromium" });
    const report = await runner.run({ command: "env", args: [], workDir: scratchDir });
    expect(report).toMatchObject({
      env: { ZKS_FFMPEG: PINNED_TOOLS.ffmpegPath, ZKS_CHROME: PINNED_TOOLS.chromePath, ZKS_HOME: scratchDir, ZKS_WORK: scratchDir },
    });
  });

  it("passes the proxy variables only when the user opted in", async () => {
    const parentEnv = { PATH: process.env.PATH, HTTPS_PROXY: "http://proxy.invalid:3128" };
    const withoutOptIn = await fakeEngineRunner(parentEnv).run({ command: "env", args: [], workDir: scratchDir });
    const withOptIn = await fakeEngineRunner(parentEnv, { proxyOptIn: true }).run({ command: "env", args: [], workDir: scratchDir });

    expect(withoutOptIn).not.toHaveProperty("env.HTTPS_PROXY");
    expect(withOptIn).toMatchObject({ env: { HTTPS_PROXY: parentEnv.HTTPS_PROXY } });
  });

  it("hands the engine its job's spec snapshot as ZKS_SPECS, and nothing outside a job", async () => {
    const runner = fakeEngineRunner({ PATH: process.env.PATH, ZKS_SPECS: "/parent/specs" });
    const snapshotDir = join(scratchDir, "work", "snapshots", "abc");
    const inJob = await withSpecSnapshotDir(snapshotDir, () => runner.run({ command: "env", args: [], workDir: scratchDir }));
    const outsideJob = await runner.run({ command: "env", args: [], workDir: scratchDir });
    expect(inJob).toMatchObject({ env: { ZKS_SPECS: snapshotDir } });
    expect(outsideJob).not.toHaveProperty("env.ZKS_SPECS");
  });

  it("keeps the server's credentials out of the engine's environment", async () => {
    const runner = fakeEngineRunner({ PATH: process.env.PATH, ANTHROPIC_API_KEY: "sk-test-not-real", DATABASE_URL: "postgres://studio@localhost/db" });
    const report = await runner.run({ command: "env", args: [], workDir: scratchDir });
    expect(report).toMatchObject({ env: { PATH: process.env.PATH } });
    expect(report).not.toHaveProperty("env.ANTHROPIC_API_KEY");
    expect(report).not.toHaveProperty("env.DATABASE_URL");
  });

  it("names the command and the stderr tail when the engine fails", async () => {
    const runner = fakeEngineRunner({ PATH: process.env.PATH });
    await expect(runner.run({ command: "explode", args: [], workDir: scratchDir, signal: new AbortController().signal })).rejects.toThrow(
      /zks-engine explode failed: unknown command explode/,
    );
  });

  it("reports the engine's own JSON error, with ZKS_HOME masked", async () => {
    const failure = fakeEngineRunner({ PATH: process.env.PATH }).run({ command: "gate", args: [], workDir: scratchDir });

    await expect(failure).rejects.toThrow(`zks-engine gate failed: ${join("$ZKS_HOME", "projects", "demo")} has no QC report`);
  });

  it("reduces a traceback to its last line and masks the host paths in it", async () => {
    const failure = fakeEngineRunner({ PATH: process.env.PATH }).run({ command: "crash", args: [], workDir: scratchDir });

    const error = await failure.then(
      () => expect.fail("the engine should fail"),
      (rejection: unknown) => String(rejection),
    );
    expect(error).toContain(`FileNotFoundError: ${join("$ZKS_HOME", "projects", "demo")}/work/edl/v1.json from <engine>`);
    expect(error).not.toContain("Traceback");
    expect(error).not.toContain(scratchDir);
  });

  it.skipIf(process.platform === "win32")("kills an engine that ignores SIGTERM once the grace period ends", async () => {
    const runner = fakeEngineRunner({ PATH: process.env.PATH }, { killGraceMs: 100 });
    const pidFile = join(scratchDir, "stubborn.pid");
    const controller = new AbortController();
    const running = runner.run({ command: "stubborn", args: [pidFile], workDir: scratchDir, signal: controller.signal });
    let enginePid = 0;
    await waitUntil(async () => {
      enginePid = Number(await readFile(pidFile, "utf8").catch(() => "0"));
      return enginePid > 0;
    });

    controller.abort();

    await expect(running).rejects.toThrow(/cancelled/);
    expect(isAlive(enginePid)).toBe(false);
  });

  it.skipIf(process.platform === "win32")("kills the engine and its children when the job is cancelled", async () => {
    const runner = fakeEngineRunner({ PATH: process.env.PATH });
    const pidFile = join(scratchDir, "grandchild.pid");
    const controller = new AbortController();
    const running = runner.run({ command: "hang", args: [pidFile], workDir: scratchDir, signal: controller.signal });
    let grandchildPid = 0;
    await waitUntil(async () => {
      grandchildPid = Number(await readFile(pidFile, "utf8").catch(() => "0"));
      return grandchildPid > 0;
    });

    controller.abort();

    await expect(running).rejects.toThrow(/cancelled/);
    await waitUntil(() => !isAlive(grandchildPid));
  });
});

describe("pinnedEngineTools", () => {
  it("prefers the ZKS_FFMPEG and ZKS_CHROME overrides", () => {
    expect(pinnedEngineTools({ ZKS_FFMPEG: "/opt/ff/ffmpeg", ZKS_CHROME: "/opt/chrome/headless" }, scratchDir)).toEqual({
      ffmpegPath: "/opt/ff/ffmpeg",
      chromePath: "/opt/chrome/headless",
    });
  });

  it("finds the Chrome that zks setup installed, with no ZKS_CHROME override", async () => {
    const studioHome = join(scratchDir, "set-up-home");
    const chromePath = pinnedExecutablePath({ toolsDir: join(studioHome, "tools"), platform: platformKey(), lock: loadToolsLock() }, "chrome-headless-shell");
    if (chromePath === undefined) throw new Error("test setup: no pinned chrome for this platform");
    await mkdir(dirname(chromePath), { recursive: true });
    await writeFile(chromePath, "");

    expect(pinnedEngineTools({ ZKS_FFMPEG: "/opt/ff/ffmpeg" }, studioHome).chromePath).toBe(chromePath);
    expect(chromePath).toContain(join("chrome-headless-shell", "chrome-headless-shell"));
  });

  it("refuses to fall back to PATH when a pinned tool is missing", () => {
    expect(() => pinnedEngineTools({ ZKS_FFMPEG: "/opt/ff/ffmpeg" }, join(scratchDir, "empty-home"))).toThrow(/chrome-headless-shell is not installed/);
  });
});
