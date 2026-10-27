// Created by The Angelo Umali.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestServer, type TestServer } from "../support/test-server.ts";
import { anchoredKeyword, callTool, createTranscribedFixture, ENGINE_TIMEOUT_MS, messageOf, readStoredSheet } from "./cue-fixtures.ts";
import { createToolFixture } from "./tool-fixtures.ts";

let server: TestServer;
beforeAll(async () => {
  server = await createTestServer();
});
afterAll(async () => {
  await server.close();
});

interface ListedKind {
  readonly kind: string;
  readonly tier: string;
  readonly jsonSchema: object;
  readonly tones?: Record<string, object>;
}

describe("list_cue_kinds", () => {
  it(
    "filters the theme's kinds by tier and lists each kind's schema and width caps",
    async () => {
      const fixture = await createToolFixture(server);
      const result = await callTool(fixture, "list_cue_kinds", { tier: "core" });
      expect(result.isError).toBeUndefined();
      const { kinds } = result.structuredContent as { kinds: ListedKind[] };
      expect(kinds.length).toBeGreaterThan(0);
      expect(kinds.every((entry) => entry.tier === "core")).toBe(true);
      const keyword = kinds.find((entry) => entry.kind === "keyword");
      expect(keyword?.tones).toMatchObject({ chip: { text: 27 } });
      expect(keyword?.jsonSchema).toMatchObject({ properties: { kind: { const: "keyword" } } });
    },
    ENGINE_TIMEOUT_MS,
  );

  it(
    "searches purposes and leaves out kinds an agent cannot add",
    async () => {
      const fixture = await createToolFixture(server);
      const subtitles = await callTool(fixture, "list_cue_kinds", { purpose: "subtitle" });
      expect((subtitles.structuredContent as { kinds: ListedKind[] }).kinds.map((entry) => entry.kind)).toEqual(["caption"]);
      const special = await callTool(fixture, "list_cue_kinds", { tier: "special" });
      const specialKinds = (special.structuredContent as { kinds: ListedKind[] }).kinds.map((entry) => entry.kind);
      expect(specialKinds).toContain("pipeline");
      expect(specialKinds).not.toContain("backdrop");
    },
    ENGINE_TIMEOUT_MS,
  );
});

describe("add_cue", () => {
  it(
    "stores an anchored cue with an id, a version and a spec.version event",
    async () => {
      const fixture = await createTranscribedFixture(server);
      const result = await callTool(fixture, "add_cue", { sheet: "main", cue: anchoredKeyword() });
      expect(result.isError).toBeUndefined();
      const { id, version } = result.structuredContent as { id: string; version: number };
      expect(version).toBe(1);
      expect(await readStoredSheet(fixture)).toEqual([{ ...anchoredKeyword(), id }]);
      expect(fixture.events).toContainEqual(expect.objectContaining({ type: "spec.version", kind: "cues", version: 1 }));
    },
    ENGINE_TIMEOUT_MS,
  );

  it(
    "fails a cue that lands outside -0.2 to +1.8 s of its anchor word",
    async () => {
      const fixture = await createTranscribedFixture(server);
      const result = await callTool(fixture, "add_cue", { sheet: "main", cue: anchoredKeyword({ at: 4.5, end: 6 }) });
      expect(result.isError).toBe(true);
      expect(messageOf(result)).toMatch(/after its anchor word; allowed 1\.8 s/);
    },
    ENGINE_TIMEOUT_MS,
  );

  it(
    "fails a chip wider than the theme's maxChars",
    async () => {
      const fixture = await createTranscribedFixture(server);
      const result = await callTool(fixture, "add_cue", { sheet: "main", cue: anchoredKeyword({ tone: "chip", text: "Enterprise clients: teams on it" }) });
      expect(result.isError).toBe(true);
      expect(messageOf(result)).toMatch(/fits 27/);
    },
    ENGINE_TIMEOUT_MS,
  );

  it("asks for a transcript before anchoring", async () => {
    const fixture = await createToolFixture(server);
    const result = await callTool(fixture, "add_cue", { sheet: "main", cue: anchoredKeyword() });
    expect(result.isError).toBe(true);
    expect(messageOf(result)).toMatch(/transcribe/);
  });

  it(
    "warns on an overlapping card and refuses a duplicate id",
    async () => {
      const fixture = await createTranscribedFixture(server);
      await callTool(fixture, "add_cue", { sheet: "main", cue: anchoredKeyword({ id: "kw-1" }) });
      const overlapping = await callTool(fixture, "add_cue", { sheet: "main", cue: anchoredKeyword({ id: "kw-2", text: "again" }) });
      expect(overlapping.structuredContent).toMatchObject({ id: "kw-2", version: 2, warnings: [expect.stringContaining("kw-1")] });
      const duplicate = await callTool(fixture, "add_cue", { sheet: "reel", cue: anchoredKeyword({ id: "kw-1" }) });
      expect(duplicate.isError).toBe(true);
      expect(messageOf(duplicate)).toMatch(/kw-1 already exists/);
    },
    ENGINE_TIMEOUT_MS,
  );

  it(
    "writes the reel sheet as its own spec",
    async () => {
      const fixture = await createTranscribedFixture(server);
      const result = await callTool(fixture, "add_cue", { sheet: "reel", cue: anchoredKeyword() });
      expect(result.isError).toBeUndefined();
      expect(fixture.events).toContainEqual(expect.objectContaining({ type: "spec.version", kind: "cues_reel", version: 1 }));
    },
    ENGINE_TIMEOUT_MS,
  );
});
