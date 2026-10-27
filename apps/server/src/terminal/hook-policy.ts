// Created by The Angelo Umali.
// The PreToolUse decision for mode T (plan §6.3, §6.10): deny by default; the hook blocks on failure, so nothing runs unchecked.
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { isWithinDir } from "../fs/path-policy.ts";
import { confinePath } from "../security/confine-path.ts";

export interface TerminalToolScope {
  readonly projectDir: string;
  readonly pluginDir: string;
  readonly studioToolNames: readonly string[];
}

export type TerminalToolDecision = { readonly isAllowed: true } | { readonly isAllowed: false; readonly reason: string };

const ALWAYS_ALLOWED_TOOLS: ReadonlySet<string> = new Set(["Skill", "AskUserQuestion"]);
const ALLOW: TerminalToolDecision = { isAllowed: true };

export async function decideTerminalTool(toolName: string, toolInput: unknown, scope: TerminalToolScope): Promise<TerminalToolDecision> {
  if (ALWAYS_ALLOWED_TOOLS.has(toolName) || scope.studioToolNames.includes(toolName)) return ALLOW;
  if (toolName !== "Read") return { isAllowed: false, reason: `${toolName} is not available in ZKidz Studio.` };

  const filePath = readFilePath(toolInput);
  if (filePath !== undefined && ((await isConfined(scope.projectDir, filePath)) || (await isConfined(scope.pluginDir, filePath)))) return ALLOW;
  return { isAllowed: false, reason: "Read is limited to the project folder and the studio plugin." };
}

function readFilePath(toolInput: unknown): string | undefined {
  if (typeof toolInput !== "object" || toolInput === null || !("file_path" in toolInput)) return undefined;
  return typeof toolInput.file_path === "string" ? toolInput.file_path : undefined;
}

async function isConfined(rootDir: string, candidatePath: string): Promise<boolean> {
  try {
    // Lexically outside both root forms is a deny before any fs call, so a Read of ~/.claude never stats it.
    const absolutePath = resolve(rootDir, candidatePath);
    if (!isWithinDir(absolutePath, rootDir) && !isWithinDir(absolutePath, await realpath(rootDir))) return false;
    await confinePath(rootDir, candidatePath);
    return true;
  } catch {
    // Any rejection (escape, missing file, odd path form) is a deny; the reason never echoes the path.
    return false;
  }
}
