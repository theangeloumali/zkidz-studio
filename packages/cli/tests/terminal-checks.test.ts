// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { checkClaude, checkNodePty } from "../src/checks.ts";
import type { CommandRunner } from "../src/exec.ts";

function claudeRunner(output: { code: number | null; stdout?: string }, calls: string[][] = []): CommandRunner {
  return (command, args) => {
    calls.push([command, ...args]);
    return { code: output.code, stdout: output.stdout ?? "", stderr: "" };
  };
}

function failingLoader(message: string): () => never {
  return () => {
    throw new Error(message);
  };
}

describe("checkClaude", () => {
  it("reads only claude --version", () => {
    const calls: string[][] = [];
    checkClaude(claudeRunner({ code: 0, stdout: "2.1.309 (Claude Code)\n" }, calls));
    expect(calls).toEqual([["claude", "--version"]]);
  });

  it("passes at the 2.1.295 minimum and above", () => {
    for (const stdout of ["2.1.295 (Claude Code)", "2.1.309 (Claude Code)", "2.2.0 (Claude Code)", "3.0.0"]) {
      const check = checkClaude(claudeRunner({ code: 0, stdout }));
      expect(check).toMatchObject({ id: "claude", status: "ok", required: false, detail: stdout });
      expect(check.fix).toBeUndefined();
    }
  });

  it("warns below the minimum and says how to update", () => {
    const check = checkClaude(claudeRunner({ code: 0, stdout: "2.1.294 (Claude Code)" }));
    expect(check).toMatchObject({ id: "claude", status: "warn", required: false });
    expect(check.detail).toContain("2.1.294");
    expect(check.detail).toContain("2.1.295");
    expect(check.fix).toMatch(/claude update/);
  });

  it("compares numerically, not as text", () => {
    expect(checkClaude(claudeRunner({ code: 0, stdout: "2.1.1000" })).status).toBe("ok");
    expect(checkClaude(claudeRunner({ code: 0, stdout: "2.0.999" })).status).toBe("warn");
  });

  it("warns when claude is missing, naming terminal mode and the install page", () => {
    const check = checkClaude(claudeRunner({ code: null }));
    expect(check).toMatchObject({ id: "claude", status: "warn", required: false, detail: "claude not found" });
    expect(check.fix).toContain("terminal mode");
    expect(check.fix).toContain("https://code.claude.com/docs/en/setup");
  });

  it("warns when the version output cannot be parsed", () => {
    const check = checkClaude(claudeRunner({ code: 0, stdout: "something else" }));
    expect(check.status).toBe("warn");
    expect(check.fix).toBeDefined();
  });
});

describe("checkNodePty", () => {
  it("passes when node-pty loads and exposes spawn", () => {
    const check = checkNodePty({ loadNodePty: () => ({ spawn: () => undefined }), platform: "linux" });
    expect(check).toMatchObject({ id: "node-pty", status: "ok", required: false });
    expect(check.fix).toBeUndefined();
  });

  it("gives Linux a C++ toolchain hint when the native build is missing", () => {
    const check = checkNodePty({ loadNodePty: failingLoader("Cannot find module '../build/Release/pty.node'"), platform: "linux" });
    expect(check).toMatchObject({ id: "node-pty", status: "warn", required: false });
    expect(check.detail).toContain("pty.node");
    expect(check.fix).toMatch(/build-essential/);
    expect(check.fix).toMatch(/pnpm rebuild node-pty/);
  });

  it("points other platforms at a reinstall, since they use prebuilds", () => {
    for (const platform of ["win32", "darwin"] as const) {
      const check = checkNodePty({ loadNodePty: failingLoader("load failed"), platform });
      expect(check.status).toBe("warn");
      expect(check.fix).not.toMatch(/build-essential/);
      expect(check.fix).toMatch(/pnpm install/);
    }
  });

  it("asks for an install, not a toolchain, when node-pty itself is absent", () => {
    const check = checkNodePty({ loadNodePty: failingLoader("Cannot find module 'node-pty'\nRequire stack: x"), platform: "linux" });
    expect(check.detail).toBe("node-pty is not installed");
    expect(check.fix).not.toMatch(/build-essential/);
    expect(check.fix).toMatch(/pnpm install/);
  });

  it("warns when the module loads without a spawn function", () => {
    expect(checkNodePty({ loadNodePty: () => ({}), platform: "linux" }).status).toBe("warn");
  });
});
