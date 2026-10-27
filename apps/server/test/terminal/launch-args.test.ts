// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { buildTerminalArgs, type TerminalRun } from "../../src/terminal/launch-args.ts";

const SESSION_ID = "6f1c2a52-1d0c-4c3e-9a51-2b7f0f6f9f10";
const baseRun: TerminalRun = {
  sessionId: SESSION_ID,
  resume: false,
  settingsPath: "/studio/terminal/s/settings.json",
  mcpConfigPath: "/studio/terminal/s/mcp.json",
  rulesPath: "/studio/terminal/s/rules.md",
  pluginDir: "/studio/plugin",
  studioToolNames: ["mcp__studio__read_spec", "mcp__studio__render_preview"],
  model: "haiku",
};

/** The value that follows a flag, so each assertion reads as `--flag value`. */
function valueAfter(args: readonly string[], flag: string): string | undefined {
  const flagIndex = args.indexOf(flag);
  return flagIndex === -1 ? undefined : args[flagIndex + 1];
}

describe("buildTerminalArgs", () => {
  it("starts a new session with --session-id and resumes with --resume", () => {
    const newArgs = buildTerminalArgs(baseRun);
    expect(newArgs.slice(0, 2)).toEqual(["--session-id", SESSION_ID]);
    expect(newArgs).not.toContain("--resume");

    const resumedArgs = buildTerminalArgs({ ...baseRun, resume: true });
    expect(resumedArgs.slice(0, 2)).toEqual(["--resume", SESSION_ID]);
    expect(resumedArgs).not.toContain("--session-id");
  });

  it("passes the §6.3 restriction flags with the per-session files", () => {
    const args = buildTerminalArgs(baseRun);
    expect(args).toContain("--restricted");
    expect(args).toContain("--strict-mcp-config");
    expect(valueAfter(args, "--settings")).toBe(baseRun.settingsPath);
    expect(valueAfter(args, "--mcp-config")).toBe(baseRun.mcpConfigPath);
    expect(valueAfter(args, "--append-system-prompt-file")).toBe(baseRun.rulesPath);
    expect(valueAfter(args, "--plugin-dir")).toBe(baseRun.pluginDir);
    expect(valueAfter(args, "--add-dir")).toBe(baseRun.pluginDir);
    expect(valueAfter(args, "--tools")).toBe("Read,Skill,AskUserQuestion");
    expect(valueAfter(args, "--disallowedTools")).toBe("Bash,Edit,Write,WebFetch,WebSearch,Agent");
    expect(valueAfter(args, "--permission-mode")).toBe("default");
    expect(valueAfter(args, "--model")).toBe("haiku");
  });

  it("omits --model when none is configured, so Claude Code's own default applies", () => {
    expect(buildTerminalArgs({ ...baseRun, model: undefined })).not.toContain("--model");
  });

  it("allows every catalog tool so the pane never double-prompts", () => {
    const args = buildTerminalArgs(baseRun);
    const allowedStart = args.indexOf("--allowedTools") + 1;
    expect(args.slice(allowedStart, allowedStart + baseRun.studioToolNames.length)).toEqual(baseRun.studioToolNames);
  });

  it("never passes flags the plan rules out", () => {
    const args = buildTerminalArgs(baseRun);
    for (const bannedFlag of ["--dangerously-skip-permissions", "--bare", "--disable-slash-commands", "--max-turns", "--setting-sources"]) {
      expect(args).not.toContain(bannedFlag);
    }
  });
});
