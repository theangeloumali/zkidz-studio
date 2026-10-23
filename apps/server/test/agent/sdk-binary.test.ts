// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { hasBundledClaudeBinary, type BinaryProbe } from "../../src/agent/sdk-binary.ts";

const SDK = "@anthropic-ai/claude-agent-sdk";

function probe(overrides: Partial<BinaryProbe> & { readonly installed?: readonly string[] }): BinaryProbe & { readonly asked: string[] } {
  const asked: string[] = [];
  const installed = new Set(overrides.installed ?? []);
  return {
    platform: "linux",
    arch: "x64",
    resolve: (specifier) => {
      asked.push(specifier);
      if (!installed.has(specifier)) throw new Error(`Cannot find module '${specifier}'`);
      return `/node_modules/${specifier}`;
    },
    exists: () => true,
    asked,
    ...overrides,
  };
}

describe("hasBundledClaudeBinary", () => {
  it("finds the binary this install ships with the SDK", () => {
    expect(hasBundledClaudeBinary()).toBe(true);
  });

  it("is false when no platform package resolves", () => {
    const linux = probe({});
    expect(hasBundledClaudeBinary(linux)).toBe(false);
    expect(linux.asked).toEqual([`${SDK}-linux-x64/claude`, `${SDK}-linux-x64-musl/claude`]);
  });

  it("is false when the package resolves but its binary is gone", () => {
    expect(hasBundledClaudeBinary(probe({ installed: [`${SDK}-linux-x64/claude`], exists: () => false }))).toBe(false);
  });

  it("accepts the musl build on linux", () => {
    expect(hasBundledClaudeBinary(probe({ installed: [`${SDK}-linux-x64-musl/claude`] }))).toBe(true);
  });

  it("looks for claude.exe in the win32 package", () => {
    const windows = probe({ platform: "win32", installed: [`${SDK}-win32-x64/claude.exe`] });
    expect(hasBundledClaudeBinary(windows)).toBe(true);
    expect(windows.asked).toEqual([`${SDK}-win32-x64/claude.exe`]);
  });
});
