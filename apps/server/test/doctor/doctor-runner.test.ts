// Created by The Angelo Umali.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCliDoctorRunner } from "../../src/doctor/runner.ts";

let scratchDir = "";
beforeAll(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), "zks-doctor-"));
});
afterAll(async () => {
  await rm(scratchDir, { recursive: true, force: true });
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

  it("fails when the CLI prints no JSON", async () => {
    const cliEntry = await writeFakeCli("console.error('boom'); process.exit(2);");
    await expect(createCliDoctorRunner({ cliEntry, studioHome: scratchDir })()).rejects.toThrow(/boom/);
  });
});
