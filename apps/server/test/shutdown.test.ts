// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { shutDownInOrder } from "../src/shutdown.ts";

function recordingSteps(overrides: { closeServer?: () => Promise<void> } = {}) {
  const calls: string[] = [];
  const step = (name: string) => () => {
    calls.push(name);
    return Promise.resolve();
  };
  return {
    calls,
    steps: {
      stopAgents: () => new Promise<void>((resolve) => setTimeout(() => resolve(void calls.push("agents stopped")), 20)),
      closeServers: () => [overrides.closeServer?.() ?? step("servers closed")()],
      drainJobs: step("jobs drained"),
      stopEditRecorder: step("edit recorder stopped"),
      closeDatabase: step("database closed"),
    },
  };
}

describe("shutDownInOrder", () => {
  it("closes the database last, after the agents' exit work, the job drain and the edit recorder", async () => {
    const { calls, steps } = recordingSteps();

    await shutDownInOrder(steps);

    expect(calls).toEqual(["servers closed", "agents stopped", "jobs drained", "edit recorder stopped", "database closed"]);
  });

  it("still drains and closes the database when a server fails to close", async () => {
    const { calls, steps } = recordingSteps({ closeServer: () => Promise.reject(new Error("socket stuck")) });

    await shutDownInOrder(steps);

    expect(calls.slice(-3)).toEqual(["jobs drained", "edit recorder stopped", "database closed"]);
  });
});
