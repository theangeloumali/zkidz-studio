// Created by The Angelo Umali.
// Claude Code argv for mode T (plan §6.3); each flag was checked against the CLI reference on 2026-10-22.

export interface TerminalRun {
  readonly sessionId: string;
  readonly resume: boolean;
  readonly settingsPath: string;
  readonly mcpConfigPath: string;
  readonly rulesPath: string;
  readonly pluginDir: string;
  readonly studioToolNames: readonly string[];
  /** Unset: no --model, so Claude Code picks the signed-in account's default. */
  readonly model?: string;
}

const TERMINAL_TOOLS = "Read,Skill,AskUserQuestion";
const DISALLOWED_TOOLS = "Bash,Edit,Write,WebFetch,WebSearch,Agent";

export function buildTerminalArgs(run: TerminalRun): string[] {
  return [
    ...(run.resume ? ["--resume", run.sessionId] : ["--session-id", run.sessionId]),
    // Loads only managed settings and --settings; spike 07 confirmed /login still works under it.
    "--restricted",
    "--settings",
    run.settingsPath,
    "--mcp-config",
    run.mcpConfigPath,
    "--strict-mcp-config",
    "--plugin-dir",
    run.pluginDir,
    // --restricted confines file tools to working directories, so the plugin folder is added as one.
    "--add-dir",
    run.pluginDir,
    "--tools",
    TERMINAL_TOOLS,
    "--disallowedTools",
    DISALLOWED_TOOLS,
    "--allowedTools",
    ...run.studioToolNames,
    "--permission-mode",
    "default",
    "--append-system-prompt-file",
    run.rulesPath,
    ...(run.model === undefined ? [] : ["--model", run.model]),
  ];
}
