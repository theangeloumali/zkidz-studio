// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { engineParentEnv } from "../../src/jobs/engine-process.ts";
import { inheritedParentEnv } from "../../src/security/parent-env.ts";

const PARENT_ENV = { PATH: "/usr/bin", LC_ALL: "C.UTF-8", LC_CTYPE: "en_US.UTF-8", LC_ANTHROPIC_API_KEY: "sk-ant-leak", LC_SECRET: "x" };

describe("inherited parent env", () => {
  it("passes the real locale variables and nothing else that merely starts with LC_", () => {
    const env = inheritedParentEnv({ proxyOptIn: false, parentEnv: PARENT_ENV });

    expect(env).toEqual({ PATH: "/usr/bin", LC_ALL: "C.UTF-8", LC_CTYPE: "en_US.UTF-8" });
  });

  it("keeps an LC_-prefixed secret out of the engine's env", () => {
    const env = engineParentEnv({ parentEnv: PARENT_ENV });

    expect(Object.keys(env)).not.toContain("LC_ANTHROPIC_API_KEY");
    expect(Object.keys(env)).not.toContain("LC_SECRET");
  });
});
