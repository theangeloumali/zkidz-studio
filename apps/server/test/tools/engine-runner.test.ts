// Created by The Angelo Umali.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCliEngineRunner, EngineReportedError } from "../../src/tools/engine-runner.ts";

let scratchDir = "";
let fakeEnginePath = "";
beforeAll(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), "zks-engine-"));
  fakeEnginePath = join(scratchDir, "fake-engine.mjs");
  const fakeEngine = [
    "if (process.argv.includes('--fail')) { process.stderr.write('whisper model missing'); process.exit(3); }",
    "if (process.argv.includes('--reject')) { process.stdout.write(JSON.stringify({ error: { code: 'spec_invalid', message: 'keyword text is 40 chars' } })); process.exit(6); }",
    "if (process.argv.includes('--report-error')) { process.stderr.write('joining 2 clips'); process.stdout.write(JSON.stringify({ error: { code: 'engine_failed', message: 'clips at different rates' } })); process.exit(1); }",
    "process.stdout.write(JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), work: process.env.ZKS_WORK, home: process.env.ZKS_HOME, inPlace: process.env.ZKS_INPLACE, envNames: Object.keys(process.env) }));",
  ].join("\n");
  await writeFile(fakeEnginePath, fakeEngine);
});
afterAll(async () => {
  await rm(scratchDir, { recursive: true, force: true });
});

describe("createCliEngineRunner", () => {
  it("runs `<command> --json <args>` in the work dir and parses the report", async () => {
    const engine = createCliEngineRunner({ executable: process.execPath, prefixArgs: [fakeEnginePath], studioHome: "/studio-home" });
    const report = await engine.run({ command: "transcribe", args: ["--video", "v1"], workDir: scratchDir });
    expect(report).toMatchObject({ argv: ["transcribe", "--json", "--video", "v1"], work: scratchDir, home: "/studio-home" });
  });

  it("fails with the engine's stderr when it exits non-zero", async () => {
    const engine = createCliEngineRunner({ executable: process.execPath, prefixArgs: [fakeEnginePath], studioHome: "/studio-home" });
    await expect(engine.run({ command: "ingest", args: ["--fail"], workDir: scratchDir })).rejects.toThrow(/whisper model missing/);
  });

  it("fails with the error the engine reported on stdout, not its progress lines", async () => {
    const engine = createCliEngineRunner({ executable: process.execPath, prefixArgs: [fakeEnginePath], studioHome: "/studio-home" });
    await expect(engine.run({ command: "ingest", args: ["--report-error"], workDir: scratchDir })).rejects.toThrow("clips at different rates");
  });

  it("registers the request's in-place files with the engine", async () => {
    const engine = createCliEngineRunner({ executable: process.execPath, prefixArgs: [fakeEnginePath], studioHome: "/studio-home" });
    const inPlacePaths = [join(scratchDir, "a.mp4"), join(scratchDir, "b.mp4")];
    const report = await engine.run({ command: "ingest", args: [], workDir: scratchDir, inPlacePaths });
    expect(report).toMatchObject({ inPlace: inPlacePaths.join(delimiter) });
  });

  it("fails with the engine's own error report when it prints one", async () => {
    const engine = createCliEngineRunner({ executable: process.execPath, prefixArgs: [fakeEnginePath], studioHome: "/studio-home" });
    const failure = engine.run({ command: "validate-cue", args: ["--reject"], workDir: scratchDir });
    await expect(failure).rejects.toBeInstanceOf(EngineReportedError);
    await expect(failure).rejects.toMatchObject({ code: "spec_invalid", message: "keyword text is 40 chars" });
  });

  it("hands the engine an allowlisted env, never the server's credentials", async () => {
    const hostileParent = {
      PATH: process.env.PATH,
      LC_ALL: "C.UTF-8",
      ZKS_FFMPEG: "/tools/ffmpeg",
      ZKS_BACKEND: "cpu",
      HTTPS_PROXY: "http://proxy.invalid",
      ANTHROPIC_API_KEY: "sk-secret",
      ANTHROPIC_BASE_URL: "http://evil.invalid",
      CLAUDE_CODE_OAUTH_TOKEN: "oauth-secret",
      CLAUDE_CONFIG_DIR: "/home/someone/.claude",
      AWS_SECRET_ACCESS_KEY: "aws-secret",
      DATABASE_URL: "postgres://db.invalid/zks",
      ZKS_MCP_TOKEN: "session-secret",
    };
    const engine = createCliEngineRunner({ executable: process.execPath, prefixArgs: [fakeEnginePath], studioHome: "/studio-home", parentEnv: hostileParent });
    const report = (await engine.run({ command: "ingest", args: [], workDir: scratchDir })) as { envNames: string[] };
    expect(report.envNames).toEqual(expect.arrayContaining(["PATH", "LC_ALL", "ZKS_FFMPEG", "ZKS_BACKEND", "ZKS_HOME", "ZKS_WORK"]));
    const leaked = report.envNames.filter((name) => /^(ANTHROPIC_|CLAUDE_|AWS_|DATABASE_URL$|ZKS_MCP_|HTTPS_PROXY$)/.test(name));
    expect(leaked).toEqual([]);
  });

  it("passes the proxy variables only when the user opted in", async () => {
    const parentEnv = { PATH: process.env.PATH, HTTPS_PROXY: "http://proxy.invalid", NO_PROXY: "localhost" };
    const engine = createCliEngineRunner({
      executable: process.execPath,
      prefixArgs: [fakeEnginePath],
      studioHome: "/studio-home",
      parentEnv,
      proxyOptIn: true,
    });
    const report = (await engine.run({ command: "ingest", args: [], workDir: scratchDir })) as { envNames: string[] };
    expect(report.envNames).toEqual(expect.arrayContaining(["HTTPS_PROXY", "NO_PROXY"]));
  });
});
