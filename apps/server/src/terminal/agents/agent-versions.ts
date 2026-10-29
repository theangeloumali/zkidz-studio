// Created by The Angelo Umali.
// Version probes for the non-Claude terminal agents, shown on Setup and checked before a connect.
import type { AgentVersionSchema } from "@zks/shared";
import type { z } from "zod";
import type { AgentAdapter } from "./agent-adapter.ts";
import { isVersionAtLeast, readAgentVersion, resolveAgentBinary } from "./agent-binary.ts";
import { createCodexAdapter } from "./codex.ts";
import { createOpenCodeAdapter } from "./opencode.ts";

export type AgentVersion = z.infer<typeof AgentVersionSchema>;
export type TerminalAgentKind = "codex" | "opencode";
export type TerminalAgentVersions = Readonly<Record<TerminalAgentKind, AgentVersion>>;

type Environment = Readonly<Record<string, string | undefined>>;

export async function detectTerminalAgentVersions(
  env: Environment = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<TerminalAgentVersions> {
  const [codex, opencode] = await Promise.all([detectVersion(createCodexAdapter(), env, platform), detectVersion(createOpenCodeAdapter(), env, platform)]);
  return { codex, opencode };
}

/** False for a missing agent, or one older than the build its lockdown flags were proven against. */
export function isSupportedVersion({ version, minVersion }: AgentVersion): boolean {
  return version !== null && isVersionAtLeast(version, minVersion);
}

async function detectVersion(adapter: AgentAdapter, env: Environment, platform: NodeJS.Platform): Promise<AgentVersion> {
  const binary = await resolveAgentBinary(adapter.binaryNames, env, platform);
  return { version: await readAgentVersion(binary, adapter.versionArgs), minVersion: adapter.minVersion };
}
