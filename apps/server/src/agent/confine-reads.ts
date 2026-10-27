// Created by The Angelo Umali.
// PreToolUse backstop for Read (plan §6.10). It only ever denies: a hook "allow" would skip canUseTool, and the "Read"
// matcher is a pattern that also reaches NotebookRead or an MCP tool named like mcp__x__ReadFile.
import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";
import type { HookResponse } from "@zks/shared";
import { z } from "zod";
import { confinePath, PathEscapeError } from "../security/confine-path.ts";

const ReadInputSchema = z.object({ file_path: z.string().min(1) });

export interface ReadRoots {
  readonly projectDir: string;
  readonly pluginDir: string;
}

export function createConfineReadsHook(roots: ReadRoots): HookCallback {
  return (input) => (input.hook_event_name === "PreToolUse" ? answerRead(roots, input.tool_name, input.tool_input) : Promise.resolve({}));
}

/** The SDK hook and the `-p` run's http hook share this answer. */
export async function answerRead(roots: ReadRoots, toolName: string, toolInput: unknown): Promise<HookResponse> {
  if (toolName !== "Read") return {};
  const parsed = ReadInputSchema.safeParse(toolInput);
  if (!parsed.success) return denyRead("Read needs a file_path");
  const isInside = (await isUnder(roots.projectDir, parsed.data.file_path)) || (await isUnder(roots.pluginDir, parsed.data.file_path));
  return isInside ? {} : denyRead("Reads are limited to the project folder");
}

async function isUnder(rootDir: string, candidate: string): Promise<boolean> {
  try {
    await confinePath(rootDir, candidate);
    return true;
  } catch (error) {
    if (error instanceof PathEscapeError) return false;
    throw error;
  }
}

function denyRead(reason: string): HookResponse {
  return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } };
}
