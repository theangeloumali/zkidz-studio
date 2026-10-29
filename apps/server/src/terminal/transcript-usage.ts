// Created by The Angelo Umali.
// A mode T session's token totals from Claude Code's own transcript: the status line only carries the latest call.
import { readFile } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
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

/** The path arrives in a hook payload, so only the transcript named after this very session is read. */
export function isSessionTranscript(transcriptPath: unknown, sessionId: string): transcriptPath is string {
  return typeof transcriptPath === "string" && isAbsolute(transcriptPath) && basename(transcriptPath) === `${sessionId}.jsonl`;
}

/** One assistant message spans a line per content block, each repeating its usage, so each message id counts once. */
export async function readTranscriptUsage(transcriptPath: string): Promise<UsageFigures | null> {
  const usageByMessage = new Map<string, TokenUsage>();
  for (const line of (await readFile(transcriptPath, "utf8")).split("\n")) {
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
  if (line.trim() === "") return null;
  try {
    const parsed = AssistantEntrySchema.safeParse(JSON.parse(line));
    return parsed.success ? parsed.data : null;
  } catch {
    // A line cut mid-write by Claude Code's async append is skipped; the next Stop reads it whole.
    return null;
  }
}
