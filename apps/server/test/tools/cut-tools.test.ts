// Created by The Angelo Umali.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveCutReview } from "../../src/tools/cut-review.ts";
import { STUDIO_TOOLS_BY_NAME } from "../../src/tools/catalog.ts";
import { createTestServer, type TestServer } from "../support/test-server.ts";
import { createToolFixture, cutSpecFor, insertCameraAsset, insertTranscript, type ToolFixture } from "./tool-fixtures.ts";

let server: TestServer;
beforeAll(async () => {
  server = await createTestServer();
});
afterAll(async () => {
  await server.close();
});

function callTool(fixture: ToolFixture, name: string, input: unknown) {
  const studioTool = STUDIO_TOOLS_BY_NAME.get(name);
  if (studioTool === undefined) throw new Error(`no tool ${name}`);
  return studioTool.run(input, fixture.context);
}

const STUTTER_WORDS = [
  { at: 0, end: 0.4, text: "So" },
  { at: 0.5, end: 0.8, text: "um" },
  { at: 1, end: 1.3, text: "today" },
  { at: 3, end: 3.3, text: "we" },
  { at: 3.4, end: 3.6, text: "we" },
  { at: 3.7, end: 4, text: "edit" },
];

describe("set_cuts", () => {
  it("rejects a spec that carries a path instead of an assetId", async () => {
    const fixture = await createToolFixture(server);
    const asset = await insertCameraAsset(fixture);
    const result = await callTool(fixture, "set_cuts", { cuts: { ...cutSpecFor(asset.id), source: "/etc/passwd" } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("source");
  });

  it("rejects an asset from another project", async () => {
    const owner = await createToolFixture(server);
    const foreignAsset = await insertCameraAsset(owner);
    const fixture = await createToolFixture(server);
    const result = await callTool(fixture, "set_cuts", { cuts: cutSpecFor(foreignAsset.id) });
    expect(result.isError).toBe(true);
  });

  it("stores a version, reports the kept length and publishes spec.version", async () => {
    const fixture = await createToolFixture(server);
    const asset = await insertCameraAsset(fixture);
    const cuts = cutSpecFor(asset.id, [{ at: 10, end: 12, reason: "retake" }]);
    const first = await callTool(fixture, "set_cuts", { cuts });
    expect(first.isError).toBeUndefined();
    expect(first.structuredContent).toMatchObject({ version: 1, segments: 2, keptS: 28 });
    expect(fixture.events).toContainEqual(expect.objectContaining({ type: "spec.version", kind: "cuts", version: 1, author: "agent" }));

    const unchanged = await callTool(fixture, "set_cuts", { cuts });
    expect(unchanged.structuredContent).toMatchObject({ version: 1 });
  });

  it("refuses a removal from a candidate the user did not approve", async () => {
    const fixture = await createToolFixture(server);
    const asset = await insertCameraAsset(fixture);
    const result = await callTool(fixture, "set_cuts", { cuts: cutSpecFor(asset.id, [{ at: 1, end: 2, reason: "filler", fromCandidate: "nope" }]) });
    expect(result.isError).toBe(true);
  });
});

describe("propose_cuts", () => {
  it("emits cuts.proposed, waits for the review, and lets set_cuts use the approved ids", async () => {
    const fixture = await createToolFixture(server);
    const asset = await insertCameraAsset(fixture);
    await insertTranscript(fixture, asset.id, STUTTER_WORDS);

    const pending = callTool(fixture, "propose_cuts", {});
    await expect.poll(() => fixture.events.find((event) => event.type === "cuts.proposed")).toBeDefined();
    const proposal = fixture.events.find((event) => event.type === "cuts.proposed");
    if (proposal?.type !== "cuts.proposed") throw new Error("no proposal");
    expect(proposal.candidates.map((candidate) => candidate.kind).sort()).toEqual(["filler", "pause", "stutter"]);

    const filler = proposal.candidates.find((candidate) => candidate.kind === "filler");
    if (filler === undefined) throw new Error("no filler candidate");
    const rejectedIds = proposal.candidates.filter((candidate) => candidate.id !== filler.id).map((candidate) => candidate.id);
    expect(resolveCutReview(fixture.context.projectId, proposal.requestId, { approved: [filler.id], rejected: rejectedIds })).toBe(true);

    const result = await pending;
    expect(result.structuredContent).toMatchObject({ approved: [filler.id], rejected: rejectedIds });

    const removal = { at: filler.at, end: filler.end, reason: filler.reason, fromCandidate: filler.id };
    const setResult = await callTool(fixture, "set_cuts", { cuts: cutSpecFor(asset.id, [removal]) });
    expect(setResult.isError).toBeUndefined();
  });

  it("does not resolve a review from another project", async () => {
    const fixture = await createToolFixture(server);
    const asset = await insertCameraAsset(fixture);
    await insertTranscript(fixture, asset.id, STUTTER_WORDS);
    void callTool(fixture, "propose_cuts", {});
    await expect.poll(() => fixture.events.find((event) => event.type === "cuts.proposed")).toBeDefined();
    const proposal = fixture.events.find((event) => event.type === "cuts.proposed");
    if (proposal?.type !== "cuts.proposed") throw new Error("no proposal");
    expect(resolveCutReview(crypto.randomUUID(), proposal.requestId, { approved: [], rejected: [] })).toBe(false);
    resolveCutReview(fixture.context.projectId, proposal.requestId, { approved: [], rejected: [] });
  });

  it("asks for a transcript first", async () => {
    const fixture = await createToolFixture(server);
    const result = await callTool(fixture, "propose_cuts", {});
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toMatch(/transcribe/i);
  });
});

describe("validate_spec", () => {
  it("reports a missing cut spec and passes a stored one", async () => {
    const fixture = await createToolFixture(server);
    const missing = await callTool(fixture, "validate_spec", { videoId: "v1" });
    expect(missing.isError).toBe(true);
    expect(missing.structuredContent).toMatchObject({ errors: [expect.stringContaining("cut spec")] });

    const asset = await insertCameraAsset(fixture);
    await callTool(fixture, "set_cuts", { cuts: cutSpecFor(asset.id) });
    const valid = await callTool(fixture, "validate_spec", { videoId: "v1" });
    expect(valid.isError).toBeUndefined();
    expect(valid.structuredContent).toEqual({ errors: [] });
  });
});
