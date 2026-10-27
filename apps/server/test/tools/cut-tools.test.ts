// Created by The Angelo Umali.
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { findRejectedCandidates, MAX_REJECTED_SPANS, pendingCutReviewCards, recordRejectedCandidates, resolveCutReview } from "../../src/tools/cut-review.ts";
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

describe("set_cuts on hardware without animated zooms", () => {
  const capabilitiesPath = () => join(server.studioHome, "capabilities.json");
  const writeCapabilities = (zoomExpr: boolean) =>
    writeFile(
      capabilitiesPath(),
      JSON.stringify({ profile: "nvidia", features: { uhd: true, intro: true, zoomExpr, matte: false }, transcribe: "whisper.cpp" }),
    );
  afterAll(() => rm(capabilitiesPath(), { force: true }));

  // Every zoom preset is animated, so render_master would refuse it only after the overlays had rendered.
  it("refuses zooms when the probe found no animated-zoom composite", async () => {
    await writeCapabilities(false);
    const fixture = await createToolFixture(server);
    const asset = await insertCameraAsset(fixture);
    const result = await callTool(fixture, "set_cuts", { cuts: { ...cutSpecFor(asset.id), zooms: [{ at: 1, end: 2, preset: "snap" }] } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("zoomExpr");
  });

  it("keeps zooms where the probe found the composite", async () => {
    await writeCapabilities(true);
    const fixture = await createToolFixture(server);
    const asset = await insertCameraAsset(fixture);
    const result = await callTool(fixture, "set_cuts", { cuts: { ...cutSpecFor(asset.id), zooms: [{ at: 1, end: 2, preset: "snap" }] } });
    expect(result.isError).toBeUndefined();
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
    await expect.poll(() => pendingCutReviewCards([fixture.context.projectId])).toEqual([proposal]);

    const filler = proposal.candidates.find((candidate) => candidate.kind === "filler");
    if (filler === undefined) throw new Error("no filler candidate");
    const rejectedIds = proposal.candidates.filter((candidate) => candidate.id !== filler.id).map((candidate) => candidate.id);
    expect(resolveCutReview(fixture.context.projectId, proposal.requestId, { approved: [filler.id], rejected: rejectedIds })).toBe(true);

    const result = await pending;
    expect(result.structuredContent).toMatchObject({ approved: [filler.id], rejected: rejectedIds });
    expect(pendingCutReviewCards([fixture.context.projectId])).toEqual([]);

    const removal = { at: filler.at, end: filler.end, reason: filler.reason, fromCandidate: filler.id };
    const setResult = await callTool(fixture, "set_cuts", { cuts: cutSpecFor(asset.id, [removal]) });
    expect(setResult.isError).toBeUndefined();
  });

  it("keeps a rejected candidate out of the cut spec, named or copied by its span", async () => {
    const fixture = await createToolFixture(server);
    const asset = await insertCameraAsset(fixture);
    await insertTranscript(fixture, asset.id, STUTTER_WORDS);
    const pending = callTool(fixture, "propose_cuts", {});
    await expect.poll(() => fixture.events.find((event) => event.type === "cuts.proposed")).toBeDefined();
    const proposal = fixture.events.find((event) => event.type === "cuts.proposed");
    if (proposal?.type !== "cuts.proposed") throw new Error("no proposal");
    const [rejected] = proposal.candidates;
    if (rejected === undefined) throw new Error("no candidates");
    resolveCutReview(fixture.context.projectId, proposal.requestId, { approved: [], rejected: proposal.candidates.map((candidate) => candidate.id) });
    await pending;

    const named = await callTool(fixture, "set_cuts", {
      cuts: cutSpecFor(asset.id, [{ at: rejected.at, end: rejected.end, reason: "cut", fromCandidate: rejected.id }]),
    });
    expect(named.isError).toBe(true);
    const copied = await callTool(fixture, "set_cuts", { cuts: cutSpecFor(asset.id, [{ at: rejected.at, end: rejected.end, reason: "cut" }]) });
    expect(copied.isError).toBe(true);
    expect(JSON.stringify(copied.content)).toMatch(/the user rejected/);
  });

  it("refuses untagged removals that shift, swallow or split a rejected candidate", async () => {
    const fixture = await createToolFixture(server);
    const asset = await insertCameraAsset(fixture);
    const rejected = longestCandidate(await reviewEveryCandidate(fixture, asset.id, "reject"));
    const twoFrames = 2 / 30;
    const middle = (rejected.at + rejected.end) / 2;
    const attempts = {
      shifted: [{ at: rejected.at + twoFrames, end: rejected.end + twoFrames }],
      superset: [{ at: Math.max(0, rejected.at - 1), end: rejected.end + 1 }],
      split: [
        { at: rejected.at, end: middle },
        { at: middle, end: rejected.end },
      ],
    };
    for (const [attempt, removals] of Object.entries(attempts)) {
      const result = await callTool(fixture, "set_cuts", {
        cuts: cutSpecFor(
          asset.id,
          removals.map((removal) => ({ ...removal, reason: "cut" })),
        ),
      });
      expect(result.isError, attempt).toBe(true);
      expect(JSON.stringify(result.content), attempt).toContain(rejected.id);
    }
  });

  it("allows a removal that only grazes a rejected candidate's edge", async () => {
    const fixture = await createToolFixture(server);
    const asset = await insertCameraAsset(fixture);
    const rejected = longestCandidate(await reviewEveryCandidate(fixture, asset.id, "reject"));
    const oneFrame = 1 / 30;
    const result = await callTool(fixture, "set_cuts", { cuts: cutSpecFor(asset.id, [{ at: rejected.end - oneFrame, end: rejected.end, reason: "breath" }]) });
    expect(result.isError).toBeUndefined();
  });

  it("still refuses a rejected candidate after a restart", async () => {
    const fixture = await createToolFixture(server);
    const asset = await insertCameraAsset(fixture);
    const rejected = longestCandidate(await reviewEveryCandidate(fixture, asset.id, "reject"));
    vi.resetModules();
    const { STUDIO_TOOLS_BY_NAME: restartedTools } = await import("../../src/tools/catalog.ts");
    const restartedSetCuts = restartedTools.get("set_cuts");
    if (restartedSetCuts === undefined) throw new Error("no set_cuts");
    const result = await restartedSetCuts.run({ cuts: cutSpecFor(asset.id, [{ at: rejected.at, end: rejected.end, reason: "cut" }]) }, fixture.context);
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toMatch(/the user rejected/);
  });

  // Dropping the oldest rejections once the record filled let a long-rejected cut back in (security review: fail-open).
  it("never forgets a rejection: duplicates collapse, and a full record refuses new ones", async () => {
    const fixture = await createToolFixture(server);
    const spans = Array.from({ length: MAX_REJECTED_SPANS }, (_, index) => ({ id: `r${index}`, at: index, end: index + 0.5 }));
    await recordRejectedCandidates(fixture.context, spans);
    // The same span under a new id is the same rejection, so it takes no room.
    await recordRejectedCandidates(fixture.context, [{ id: "renamed", at: 0, end: 0.5 }]);

    await expect(recordRejectedCandidates(fixture.context, [{ id: "one-more", at: -2, end: -1 }])).rejects.toThrow(/record of rejected cuts is full/);
    expect(await findRejectedCandidates(fixture.context, [{ at: 0, end: 0.5 }])).toEqual(["r0"]);
  });

  // Writes run one at a time per project; one refused write must not fail the writes queued behind it.
  it("lets a write queued behind a refused one go through", async () => {
    const fixture = await createToolFixture(server);
    const spans = Array.from({ length: MAX_REJECTED_SPANS }, (_, index) => ({ id: `q${index}`, at: index, end: index + 0.5 }));
    await recordRejectedCandidates(fixture.context, spans);

    const refused = recordRejectedCandidates(fixture.context, [{ id: "over", at: -2, end: -1 }]);
    const queued = recordRejectedCandidates(fixture.context, [{ id: "same-span", at: 0, end: 0.5 }]);
    await expect(refused).rejects.toThrow(/record of rejected cuts is full/);
    await expect(queued).resolves.toBeUndefined();
  });

  // Refusing only when the rejections were written left the approvals remembered and the rejections lost.
  it("refuses a cut review before it starts when the record has no room for every candidate", async () => {
    const fixture = await createToolFixture(server);
    const asset = await insertCameraAsset(fixture);
    await insertTranscript(fixture, asset.id, STUTTER_WORDS);
    const filler = Array.from({ length: MAX_REJECTED_SPANS - 1 }, (_, index) => ({ id: `old${index}`, at: 100 + index, end: 100.5 + index }));
    await recordRejectedCandidates(fixture.context, filler);

    const result = await callTool(fixture, "propose_cuts", {});
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toMatch(/record of rejected cuts is full/);
    expect(fixture.events.some((event) => event.type === "cuts.proposed")).toBe(false);
  });

  it("refuses an approved candidate id stretched past its own span", async () => {
    const fixture = await createToolFixture(server);
    const asset = await insertCameraAsset(fixture);
    const approved = longestCandidate(await reviewEveryCandidate(fixture, asset.id, "approve"));
    const stretched = { at: approved.at, end: approved.end + 2, reason: "cut", fromCandidate: approved.id };
    const result = await callTool(fixture, "set_cuts", { cuts: cutSpecFor(asset.id, [stretched]) });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toMatch(/outside candidate/);
  });

  it("lets a later approval cut a span the user rejected before", async () => {
    const fixture = await createToolFixture(server);
    const asset = await insertCameraAsset(fixture);
    await reviewEveryCandidate(fixture, asset.id, "reject");
    fixture.events.length = 0;
    const approved = longestCandidate(await reviewEveryCandidate(fixture, asset.id, "approve"));
    const removal = { at: approved.at, end: approved.end, reason: "cut", fromCandidate: approved.id };
    const result = await callTool(fixture, "set_cuts", { cuts: cutSpecFor(asset.id, [removal]) });
    expect(result.isError).toBeUndefined();
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

/** Runs propose_cuts and answers the review with every candidate approved or rejected. */
async function reviewEveryCandidate(fixture: ToolFixture, assetId: string, verdict: "approve" | "reject") {
  await insertTranscript(fixture, assetId, STUTTER_WORDS);
  const pending = callTool(fixture, "propose_cuts", {});
  await expect.poll(() => fixture.events.find((event) => event.type === "cuts.proposed")).toBeDefined();
  const proposal = fixture.events.find((event) => event.type === "cuts.proposed");
  if (proposal?.type !== "cuts.proposed") throw new Error("no proposal");
  const candidateIds = proposal.candidates.map((candidate) => candidate.id);
  const decision = verdict === "approve" ? { approved: candidateIds, rejected: [] } : { approved: [], rejected: candidateIds };
  resolveCutReview(fixture.context.projectId, proposal.requestId, decision);
  await pending;
  return proposal.candidates;
}

function longestCandidate<Candidate extends { at: number; end: number }>(candidates: readonly Candidate[]): Candidate {
  const [longest] = [...candidates].sort((first, second) => second.end - second.at - (first.end - first.at));
  if (longest === undefined) throw new Error("no candidates");
  return longest;
}

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
