// Created by The Angelo Umali.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { describeJobOutputFacts } from "../../src/jobs/approval-facts.ts";
import { describeStudioGate } from "../../src/tools/gate-facts.ts";
import { loadProject } from "../../src/tools/project-files.ts";
import { writeAgentSpec } from "../../src/tools/spec-store.ts";
import { createTestServer, type TestServer } from "../support/test-server.ts";
import { createToolFixture, cutSpecFor } from "../tools/tool-fixtures.ts";

let server: TestServer;
beforeAll(async () => {
  server = await createTestServer();
});
afterAll(async () => {
  await server.close();
});

const SOURCE_ASSET_ID = "00000000-0000-4000-8000-000000000001";
const reason = "filler";

/** The hardware probe's file; the engine names a 4K master by the backend it renders on. */
async function probeAs(profile: "nvidia" | "cpu") {
  const capabilities = { profile, features: { uhd: profile === "nvidia", intro: true, zoomExpr: true, matte: true }, transcribe: "whisper.cpp" };
  await writeFile(join(server.studioHome, "capabilities.json"), JSON.stringify(capabilities));
}

beforeEach(async () => {
  await rm(join(server.studioHome, "capabilities.json"), { force: true });
});

describe("approval facts for render and export", () => {
  it("estimates GPU minutes from the seconds the cut keeps and names the master it writes", async () => {
    const { context } = await createToolFixture(server);
    await probeAs("nvidia");
    // 30 s with overlapping removals 5–10 and 8–12 keeps 23 s: 23 × 29.97 fps ÷ 66 fps ÷ 60 ≈ 0.17 min.
    await writeAgentSpec(
      context,
      { videoId: "v1", kind: "cuts" },
      cutSpecFor(SOURCE_ASSET_ID, [
        { at: 5, end: 10, reason },
        { at: 8, end: 12, reason },
      ]),
    );

    const facts = await describeJobOutputFacts(context, "render_master", { target: "full", quality: "4k" });

    expect(facts).toEqual({ action: "Render the 4K master", estimatedGpuMinutes: 0.2, outputPaths: ["work/out/v1-4k.mp4"] });
  });

  it("estimates a Reels render from its keep spans", async () => {
    const { context } = await createToolFixture(server);
    await probeAs("nvidia");
    await writeAgentSpec(context, { videoId: "v1", kind: "cuts" }, cutSpecFor(SOURCE_ASSET_ID));
    await writeAgentSpec(
      context,
      { videoId: "v1", kind: "reels" },
      {
        schemaVersion: 1,
        baseVideoId: "v1",
        keep: [
          { at: 0, end: 60 },
          { at: 100, end: 160 },
        ],
      },
    );

    const facts = await describeJobOutputFacts(context, "render_master", { target: "reel", quality: "draft" });

    // 120 s kept: 120 × 29.97 ÷ 66 ÷ 60 ≈ 0.91 min, rounded up to a tenth.
    expect(facts).toEqual({ action: "Render the draft master", estimatedGpuMinutes: 1, outputPaths: ["work/out/v1r-draft.mp4"] });
  });

  it("leaves the estimate out when there is no spec to measure", async () => {
    const { context } = await createToolFixture(server);

    expect(await describeJobOutputFacts(context, "render_master", { target: "full", quality: "final" })).toEqual({
      action: "Render the 1080p master",
      outputPaths: ["work/out/v1.mp4"],
    });
  });

  it("names the master the engine writes for each quality and backend", async () => {
    const { context } = await createToolFixture(server);
    const outputOf = async (quality: "draft" | "final" | "4k") =>
      (await describeJobOutputFacts(context, "render_master", { target: "full", quality }))?.outputPaths;

    await probeAs("cpu");
    expect(await outputOf("4k")).toEqual(["work/out/v1.mp4"]);
    expect(await outputOf("draft")).toEqual(["work/out/v1-draft.mp4"]);
    await probeAs("nvidia");
    expect(await outputOf("4k")).toEqual(["work/out/v1-4k.mp4"]);
    expect(await outputOf("final")).toEqual(["work/out/v1.mp4"]);
  });

  it("names both possible 4K outputs before the hardware is probed", async () => {
    const { context } = await createToolFixture(server);

    expect(await describeJobOutputFacts(context, "render_master", { target: "full", quality: "4k" })).toEqual({
      action: "Render the 4K master",
      outputPaths: ["work/out/v1-4k.mp4", "work/out/v1.mp4"],
    });
  });

  it("names every deliverable file an export writes, by the resolution of the latest master", async () => {
    const { context, projectRoot } = await createToolFixture(server);
    const { slug } = await loadProject(context);
    await mkdir(join(projectRoot, "work", "out"), { recursive: true });
    await writeFile(join(projectRoot, "work", "out", "v1.mp4"), "1080 master");
    await mkdir(join(projectRoot, "work", "covers"), { recursive: true });
    await writeFile(join(projectRoot, "work", "covers", "v1-cover-a.png"), "cover");

    expect(await describeJobOutputFacts(context, "export_deliverable", { kinds: ["full", "cover_a"] })).toEqual({
      outputPaths: [`deliverables/${slug}-1080.mp4`, "deliverables/cover-A.png"],
    });
  });

  it("returns nothing for other tools or input outside the contract", async () => {
    const { context } = await createToolFixture(server);
    expect(await describeJobOutputFacts(context, "delete_asset", { assetId: SOURCE_ASSET_ID })).toBeNull();
    expect(await describeJobOutputFacts(context, "render_master", { target: "poster" })).toBeNull();
  });
});

describe("the approval card a render or export gate shows", () => {
  it("carries the master path and GPU estimate, labelled by the resolution the backend renders", async () => {
    const { context } = await createToolFixture(server);
    await writeAgentSpec(context, { videoId: "v1", kind: "cuts" }, cutSpecFor(SOURCE_ASSET_ID));
    const cardFor = (quality: "draft" | "final" | "4k") => describeStudioGate(context, "render_master", { target: "full", quality });

    await probeAs("nvidia");
    expect(await cardFor("4k")).toMatchObject({ action: "Render the 4K master", quality: "4k", outputPaths: ["work/out/v1-4k.mp4"] });
    expect((await cardFor("4k"))?.estimatedGpuMinutes).toBeGreaterThan(0);
    expect(await cardFor("draft")).toMatchObject({ action: "Render the draft master", outputPaths: ["work/out/v1-draft.mp4"] });
    await probeAs("cpu");
    expect(await cardFor("4k")).toMatchObject({ action: "Render the 1080p master", outputPaths: ["work/out/v1.mp4"] });
    expect(await cardFor("final")).toMatchObject({ action: "Render the 1080p master", outputPaths: ["work/out/v1.mp4"] });
  });

  it("lists the files an export writes", async () => {
    const { context, projectRoot } = await createToolFixture(server);
    const { slug } = await loadProject(context);
    await mkdir(join(projectRoot, "work", "out"), { recursive: true });
    await writeFile(join(projectRoot, "work", "out", "v1-4k.mp4"), "4k master");

    expect(await describeStudioGate(context, "export_deliverable", { kinds: ["full"] })).toEqual({
      action: "Export deliverables",
      target: "full",
      outputPaths: [`deliverables/${slug}-4k.mp4`],
      filesToDelete: [],
    });
  });
});
