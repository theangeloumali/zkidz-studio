// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { engineCommand, hygieneRefusal } from "../verify-gpu.mjs";

describe("verify:gpu hygiene (§10.3)", () => {
  const absent = () => false;

  it("refuses while the agent's config directory is visible", () => {
    const refusal = hygieneRefusal({}, "/home/maintainer", (path) => path === "/home/maintainer/.claude");
    expect(refusal).toMatch(/\.claude is visible/);
  });

  it("refuses while an SSH agent socket is exported", () => {
    expect(hygieneRefusal({ SSH_AUTH_SOCK: "/run/agent.sock" }, "/home/gpu", absent)).toMatch(/SSH_AUTH_SOCK/);
  });

  it("runs under a clean user", () => {
    expect(hygieneRefusal({}, "/home/gpu", absent)).toBeNull();
  });
});

describe("engine command", () => {
  it("runs the parity module through the engine's own project", () => {
    expect(engineCommand()).toEqual(["uv", ["run", "--project", "packages/engine", "python", "-m", "zks_engine.backends.parity"]]);
  });
});
