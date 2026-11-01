// Created by The Angelo Umali.
import { rules } from "@zks/db/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestServer, type TestServer } from "../support/test-server.ts";
import { callTool } from "./cue-fixtures.ts";
import { createToolFixture } from "./tool-fixtures.ts";

let server: TestServer;
beforeAll(async () => {
  server = await createTestServer();
});
afterAll(async () => {
  await server.close();
});

describe("suggest_lessons", () => {
  it("publishes one lessons card with a new requestId and saves no rule", async () => {
    const fixture = await createToolFixture(server);

    const result = await callTool(fixture, "suggest_lessons", { lessons: ["  Open on the payoff  ", "No music under speech"] });

    expect(result.isError).toBeUndefined();
    const cards = fixture.events.filter((event) => event.type === "lessons.suggested");
    expect(cards).toMatchObject([{ lessons: ["Open on the payoff", "No music under speech"] }]);
    expect(result.structuredContent).toEqual({ requestId: cards[0]?.type === "lessons.suggested" ? cards[0].requestId : "" });
    expect(await server.database.db.select().from(rules)).toEqual([]);
  });

  it("refuses more lessons than one card holds", async () => {
    const fixture = await createToolFixture(server);

    const result = await callTool(fixture, "suggest_lessons", { lessons: ["a", "b", "c", "d", "e", "f"] });

    expect(result.isError).toBe(true);
    expect(fixture.events.filter((event) => event.type === "lessons.suggested")).toEqual([]);
  });
});
