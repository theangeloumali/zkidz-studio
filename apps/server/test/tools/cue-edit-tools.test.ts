// Created by The Angelo Umali.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestServer, type TestServer } from "../support/test-server.ts";
import { anchoredKeyword, callTool, createTranscribedFixture, ENGINE_TIMEOUT_MS, messageOf, readStoredSheet } from "./cue-fixtures.ts";

let server: TestServer;
beforeAll(async () => {
  server = await createTestServer();
});
afterAll(async () => {
  await server.close();
});

describe("update_cue", () => {
  it(
    "merges a patch through the engine and keeps the stored cue when the result fails",
    async () => {
      const fixture = await createTranscribedFixture(server);
      await callTool(fixture, "add_cue", { sheet: "main", cue: anchoredKeyword({ id: "kw-1" }) });

      const moved = await callTool(fixture, "update_cue", { id: "kw-1", patch: { at: 5, end: 6 } });
      expect(moved.isError).toBe(true);
      expect(messageOf(moved)).toMatch(/anchor word/);
      expect(await readStoredSheet(fixture)).toEqual([anchoredKeyword({ id: "kw-1" })]);

      const retexted = await callTool(fixture, "update_cue", { id: "kw-1", patch: { text: "hello world" } });
      expect(retexted.structuredContent).toMatchObject({ id: "kw-1", version: 2 });
      expect(await readStoredSheet(fixture)).toEqual([anchoredKeyword({ id: "kw-1", text: "hello world" })]);
    },
    ENGINE_TIMEOUT_MS,
  );

  it(
    "refuses a patch that renames the cue",
    async () => {
      const fixture = await createTranscribedFixture(server);
      await callTool(fixture, "add_cue", { sheet: "main", cue: anchoredKeyword({ id: "kw-1" }) });
      const renamed = await callTool(fixture, "update_cue", { id: "kw-1", patch: { id: "kw-9" } });
      expect(renamed.isError).toBe(true);
    },
    ENGINE_TIMEOUT_MS,
  );
});

describe("remove_cue", () => {
  it(
    "removes a cue by id and names a missing one",
    async () => {
      const fixture = await createTranscribedFixture(server);
      await callTool(fixture, "add_cue", { sheet: "main", cue: anchoredKeyword({ id: "kw-1" }) });
      const removed = await callTool(fixture, "remove_cue", { id: "kw-1" });
      expect(removed.structuredContent).toMatchObject({ id: "kw-1", version: 2 });
      expect(await readStoredSheet(fixture)).toEqual([]);
      const missing = await callTool(fixture, "remove_cue", { id: "kw-1" });
      expect(missing.isError).toBe(true);
      expect(messageOf(missing)).toMatch(/no cue kw-1/);
    },
    ENGINE_TIMEOUT_MS,
  );
});
