// Created by The Angelo Umali.
// Resolves the user's `claude` once at startup (plan §6.3): an absolute path, so pty-host can pin every spawn to it.
import { readAgentVersion, resolveAgentBinary } from "./agents/agent-binary.ts";

const CLAUDE_BINARY_NAMES = ["claude", "claude.exe", "claude.cmd"] as const;

type Environment = Readonly<Record<string, string | undefined>>;

/** Null when no executable claude is on PATH; relative PATH entries are skipped so cwd can never pick the binary. */
export function resolveClaudePath(env: Environment, platform: NodeJS.Platform = process.platform): Promise<string | null> {
  return resolveAgentBinary(CLAUDE_BINARY_NAMES, env, platform);
}

/** The connect screen's version; null when claude is missing or does not answer. */
export function readClaudeVersion(claudePath: string | null): Promise<string | null> {
  return readAgentVersion(claudePath, ["--version"]);
}
