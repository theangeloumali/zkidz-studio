// Created by The Angelo Umali.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readEngineProgress } from "../../src/jobs/engine-progress.ts";

const RUN_STARTED_S = 1_000_000;
let scratchDir: string;
let recordPath: string;

beforeAll(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), "zks-engine-progress-"));
  recordPath = join(scratchDir, "abcd1234-v1.json");
});
afterAll(async () => {
  await rm(scratchDir, { recursive: true, force: true });
});

async function writeRecord(record: Record<string, unknown>): Promise<void> {
  await writeFile(recordPath, JSON.stringify({ video: "v1", started: RUN_STARTED_S, updated: RUN_STARTED_S + 10, ...record }));
}

describe("readEngineProgress", () => {
  it("ignores the record a past render left, which predates this run", async () => {
    await writeRecord({ stage: "master", state: "done", done: 48, total: 48, started: RUN_STARTED_S - 100, updated: RUN_STARTED_S - 1 });
    expect(await readEngineProgress(recordPath, RUN_STARTED_S)).toBeUndefined();
  });

  it("reads a unitless stage as 0% while it runs and 100% once done, with no ETA", async () => {
    await writeRecord({ stage: "audio", state: "running", done: 0, total: null });
    expect(await readEngineProgress(recordPath, RUN_STARTED_S)).toEqual({ stage: "audio", pct: 0 });
    await writeRecord({ stage: "audio", state: "done", done: 0, total: null });
    expect(await readEngineProgress(recordPath, RUN_STARTED_S)).toEqual({ stage: "audio", pct: 100 });
  });

  // progress_eta.py is the one ETA formula: the server reports the record's etaS and derives none from its pace.
  it("reports the etaS the engine wrote, and no ETA when the record has none", async () => {
    await writeRecord({ stage: "frames", state: "running", done: 12, total: 48, updated: RUN_STARTED_S + 6, etaS: 40 });
    expect(await readEngineProgress(recordPath, RUN_STARTED_S)).toEqual({ stage: "frames", pct: 25, etaS: 40 });
    await writeRecord({ stage: "frames", state: "running", done: 12, total: 48, updated: RUN_STARTED_S + 6 });
    expect(await readEngineProgress(recordPath, RUN_STARTED_S)).toEqual({ stage: "frames", pct: 25 });
  });

  it("reports a unitless stage's etaS, which the engine times from past runs", async () => {
    await writeRecord({ stage: "join", state: "running", done: 0, total: null, etaS: 300 });
    expect(await readEngineProgress(recordPath, RUN_STARTED_S)).toEqual({ stage: "join", pct: 0, etaS: 300 });
  });

  it("gives no ETA for a stage waiting on another session's slot", async () => {
    await writeRecord({ stage: "master", state: "waiting", done: 0, total: 48 });
    expect(await readEngineProgress(recordPath, RUN_STARTED_S)).toEqual({ stage: "master", pct: 0 });
  });

  it("reads no progress from a missing or unparsable record", async () => {
    expect(await readEngineProgress(join(scratchDir, "missing.json"), RUN_STARTED_S)).toBeUndefined();
    await writeFile(recordPath, '{"stage": "mas');
    expect(await readEngineProgress(recordPath, RUN_STARTED_S)).toBeUndefined();
  });
});
