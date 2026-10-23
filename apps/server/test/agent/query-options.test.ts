// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { DecisionBroker } from "../../src/agent/decisions.ts";
import { buildQueryOptions, type QueryOptionsInput } from "../../src/agent/query-options.ts";

const input: QueryOptionsInput = {
  projectId: "p1",
  projectDir: "/projects/p1",
  pluginDir: "/plugin",
  credential: { kind: "apiKey", apiKey: "test-key" },
  env: {},
  broker: new DecisionBroker({ publish: (event) => Promise.resolve({ ...event, id: 1, at: "2026-10-23T00:00:00Z" }) }),
  limits: { maxTurns: 40, maxBudgetUsd: 2 },
  studioMcpServer: null,
};

describe("buildQueryOptions", () => {
  // Plan §6.6: an overloaded or unavailable primary model falls back in order instead of failing the turn.
  it("falls back to sonnet, then haiku", () => {
    expect(buildQueryOptions(input).fallbackModel).toBe("sonnet,haiku");
  });
});
