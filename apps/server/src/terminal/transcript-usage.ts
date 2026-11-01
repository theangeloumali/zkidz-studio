// Created by The Angelo Umali.
// A mode T session's token totals from Claude Code's own transcript: the status line only carries the latest call.
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import { createInterface } from "node:readline";
import type { UsageFigures } from "@zks/shared";
import { z } from "zod";

const TokenCountSchema = z.int().nonnegative().optional();
// Loose: only the assistant entries' usage is read, and no text from the transcript ever leaves this file.
const AssistantEntrySchema = z.looseObject({
  type: z.literal("assistant"),
  message: z.looseObject({
    id: z.string().min(1),
    usage: z.looseObject({
      input_tokens: TokenCountSchema,
      output_tokens: TokenCountSchema,
      cache_creation_input_tokens: TokenCountSchema,
      cache_read_input_tokens: TokenCountSchema,
    }),
  }),
});
type TokenUsage = z.infer<typeof AssistantEntrySchema>["message"]["usage"];

/** The PTY's claude runs without CLAUDE_CONFIG_DIR (terminal-env.ts), so its transcripts live under ~/.claude/projects. */
export function defaultTranscriptRoot(): string {
  return join(homedir(), ".claude", "projects");
}

/** The path arrives in a hook payload, so only the transcript named after this very session is read. */
export function isSessionTranscript(transcriptPath: unknown, sessionId: string): transcriptPath is string {
  return typeof transcriptPath === "string" && isAbsolute(transcriptPath) && basename(transcriptPath) === `${sessionId}.jsonl`;
}

/** The resolved file to read, or null: a link cannot point outside the root, and a FIFO or folder would hang the read. */
export async function resolveTranscriptFile(transcriptPath: string, root: string): Promise<string | null> {
  try {
    const [realFile, realRoot] = await Promise.all([realpath(transcriptPath), realpath(root)]);
    const isUnderRoot = realFile.startsWith(`${realRoot}/`) || realFile.startsWith(`${realRoot}\\`);
    return isUnderRoot && (await stat(realFile)).isFile() ? realFile : null;
  } catch {
    return null;
  }
}

/** One assistant message spans a line per content block, each repeating its usage, so each message id counts once. */
export async function readTranscriptUsage(transcriptPath: string): Promise<UsageFigures | null> {
  const usageByMessage = new Map<string, TokenUsage>();
  // Streamed: a long session's transcript runs to tens of megabytes and is read again at every Stop.
  const lines = createInterface({ input: createReadStream(transcriptPath, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of lines) {
    const entry = parseAssistantEntry(line);
    if (entry !== null) usageByMessage.set(entry.message.id, entry.message.usage);
  }
  if (usageByMessage.size === 0) return null;
  const totals = { inputTokens: 0, outputTokens: 0, cacheTokens: 0 };
  for (const usage of usageByMessage.values()) {
    totals.inputTokens += usage.input_tokens ?? 0;
    totals.outputTokens += usage.output_tokens ?? 0;
    totals.cacheTokens += (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
  }
  return totals;
}

function parseAssistantEntry(line: string): z.infer<typeof AssistantEntrySchema> | null {
  // Tool results make most lines large and usage-free; skipping them before JSON.parse keeps a long session cheap.
  if (!line.includes('"usage"')) return null;
  try {
    const parsed = AssistantEntrySchema.safeParse(JSON.parse(line));
    return parsed.success ? parsed.data : null;
  } catch {
    // A line cut mid-write by Claude Code's async append is skipped; the next Stop reads it whole.
    return null;
  }
}
