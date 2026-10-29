// Created by The Angelo Umali.
// Token totals for a Codex thread, read from the rollout file codex writes under sessions/YYYY/MM/DD.
import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { UsageFigures } from "@zks/shared";
import { z } from "zod";

const THREAD_ID = /^[0-9A-Za-z-]+$/;
const DAY_MS = 86_400_000;
const TokenTotalsSchema = z.looseObject({ input_tokens: z.int(), cached_input_tokens: z.int().default(0), output_tokens: z.int() });
const RolloutLineSchema = z.looseObject({
  type: z.literal("event_msg"),
  payload: z.looseObject({ type: z.literal("token_count"), info: z.looseObject({ total_token_usage: TokenTotalsSchema }) }),
});

/** Reads at every Stop, so each thread's rollout path is found once and kept. */
export function createRolloutUsageReader(sessionsDir: string): (threadId: string) => Promise<UsageFigures | null> {
  const rolloutPaths = new Map<string, string>();
  return async (threadId) => {
    if (!THREAD_ID.test(threadId)) return null;
    const rolloutPath = rolloutPaths.get(threadId) ?? (await findRollout(sessionsDir, threadId));
    if (rolloutPath === null) return null;
    rolloutPaths.set(threadId, rolloutPath);
    return readLatestTotals(rolloutPath);
  };
}

// Streamed, keeping the last count: the rollout grows all session and is read at every Stop.
async function readLatestTotals(rolloutPath: string): Promise<UsageFigures | null> {
  let latest: z.infer<typeof TokenTotalsSchema> | null = null;
  const lines = createInterface({ input: createReadStream(rolloutPath, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of lines) latest = parseTokenTotals(line) ?? latest;
  if (latest === null) return null;
  // OpenAI counts cached input inside input_tokens; the studio reports the two apart.
  return { inputTokens: latest.input_tokens - latest.cached_input_tokens, outputTokens: latest.output_tokens, cacheTokens: latest.cached_input_tokens };
}

/** Today's and yesterday's folders first (local and UTC, past midnight either way); the whole tree only for an older resumed thread. */
async function findRollout(sessionsDir: string, threadId: string): Promise<string | null> {
  const suffix = `-${threadId}.jsonl`;
  for (const dayDir of recentDayDirs(Date.now())) {
    const match = (await listNames(join(sessionsDir, dayDir))).find((name) => name.endsWith(suffix));
    if (match !== undefined) return join(sessionsDir, dayDir, match);
  }
  const match = (await listNames(sessionsDir, true)).find((name) => name.endsWith(suffix));
  return match === undefined ? null : join(sessionsDir, match);
}

function recentDayDirs(nowMs: number): string[] {
  const pad = (value: number) => String(value).padStart(2, "0");
  const days = [new Date(nowMs), new Date(nowMs - DAY_MS)].flatMap((day) => [
    join(String(day.getFullYear()), pad(day.getMonth() + 1), pad(day.getDate())),
    join(String(day.getUTCFullYear()), pad(day.getUTCMonth() + 1), pad(day.getUTCDate())),
  ]);
  return [...new Set(days)];
}

async function listNames(dir: string, isRecursive = false): Promise<string[]> {
  return readdir(dir, { recursive: isRecursive }).catch(() => []);
}

function parseTokenTotals(line: string): z.infer<typeof TokenTotalsSchema> | null {
  if (!line.includes('"token_count"')) return null;
  try {
    const parsed = RolloutLineSchema.safeParse(JSON.parse(line));
    return parsed.success ? parsed.data.payload.info.total_token_usage : null;
  } catch {
    return null;
  }
}
