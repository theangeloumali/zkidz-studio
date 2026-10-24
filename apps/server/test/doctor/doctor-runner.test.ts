// Created by The Angelo Umali.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createCliDoctorRunner } from "../../src/doctor/runner.ts";

let scratchDir = "";
beforeAll(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), "zks-doctor-"));
});
afterAll(async () => {
  await rm(scratchDir, { recursive: true, force: true });
});
afterEach(() => {
  vi.unstubAllEnvs();
});

/** A stand-in for packages/cli/src/main.ts that echoes what it was given. */
async function writeFakeCli(body: string): Promise<string> {
  const cliEntry = join(scratchDir, `cli-${crypto.randomUUID()}.mjs`);
  await writeFile(cliEntry, body);
  return cliEntry;
}

describe("createCliDoctorRunner", () => {
  it("runs `doctor --json` against the server's ZKS_HOME and keeps the report when a required check fails (exit 1)", async () => {
    const cliEntry = await writeFakeCli("console.log(JSON.stringify({ argv: process.argv.slice(2), home: process.env.ZKS_HOME })); process.exitCode = 1;");
    const runDoctor = createCliDoctorRunner({ cliEntry, studioHome: "/studio/home" });

    expect(await runDoctor()).toEqual({ argv: ["doctor", "--json"], home: "/studio/home" });
  });

  it("hands the CLI only the allowlisted env, never the server's credentials or tool overrides", async () => {
    for (const [name, value] of Object.entries({
      ANTHROPIC_API_KEY: "sk-ant-leak",
      LC_ANTHROPIC_API_KEY: "sk-ant-leak",
      DATABASE_URL: "database-url-leak",
      AWS_SECRET_ACCESS_KEY: "aws-leak",
      ZKS_FFMPEG: "/elsewhere/ffmpeg",
      ZKS_HOME: "/elsewhere/home",
      ZKS_PORT: "4111",
    }))
      vi.stubEnv(name, value);
    const cliEntry = await writeFakeCli("console.log(JSON.stringify(process.env));");

    const childEnv = await createCliDoctorRunner({ cliEntry, studioHome: "/studio/home" })();

    expect(childEnv).toMatchObject({ ZKS_HOME: "/studio/home", ZKS_PORT: "4111", PATH: process.env.PATH });
    expect(Object.keys(childEnv ?? {})).not.toEqual(expect.arrayContaining([expect.stringMatching(/ANTHROPIC|DATABASE_URL|AWS_|ZKS_FFMPEG/)]));
  });

  it("fails when the CLI prints no JSON", async () => {
    const cliEntry = await writeFakeCli("console.error('boom'); process.exit(2);");
    await expect(createCliDoctorRunner({ cliEntry, studioHome: scratchDir })()).rejects.toThrow(/boom/);
  });
});
