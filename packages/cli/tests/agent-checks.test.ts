// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { checkCodex, checkOpenCode } from "../src/checks.ts";
import type { CommandRunner } from "../src/exec.ts";

function runnerReturning(output: { code: number | null; stdout?: string }, calls: string[][] = []): CommandRunner {
  return (command, args) => {
    calls.push([command, ...args]);
    return { code: output.code, stdout: output.stdout ?? "", stderr: "" };
  };
}

const AGENTS = [
  {
    check: checkCodex,
    id: "codex",
    command: "codex",
    minimum: "0.164.0",
    current: "codex-cli 0.164.0",
    old: "codex-cli 0.163.9",
    update: /codex update/,
    install: /developers\.openai\.com\/codex/,
  },
  {
    check: checkOpenCode,
    id: "opencode",
    command: "opencode",
    minimum: "2.2.0",
    current: "2.2.0",
    old: "2.1.9",
    update: /opencode upgrade/,
    install: /opencode\.ai/,
  },
] as const;

describe.each(AGENTS)("the $id check", ({ check, id, command, minimum, current, old, update, install }) => {
  it("reads only --version, never the sign-in", () => {
    const calls: string[][] = [];
    check(runnerReturning({ code: 0, stdout: `${current}\n` }, calls));
    expect(calls).toEqual([[command, "--version"]]);
  });

  it("passes at the minimum the lockdown was checked on", () => {
    expect(check(runnerReturning({ code: 0, stdout: current }))).toEqual({ id, status: "ok", required: false, detail: current });
  });

  it("warns below the minimum and names the update command", () => {
    const result = check(runnerReturning({ code: 0, stdout: old }));
    expect(result).toMatchObject({ id, status: "warn", required: false });
    expect(result.detail).toContain(minimum);
    expect(result.fix).toMatch(update);
  });

  it("warns, never fails, when the agent is not installed", () => {
    const result = check(runnerReturning({ code: null }));
    expect(result).toMatchObject({ id, status: "warn", required: false, detail: `${command} not found` });
    expect(result.fix).toMatch(install);
  });

  it("warns on output with no version in it", () => {
    expect(check(runnerReturning({ code: 0, stdout: "garbage" }))).toMatchObject({ id, status: "warn", detail: "unrecognised version: garbage" });
  });
});
