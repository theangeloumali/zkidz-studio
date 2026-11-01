// Created by The Angelo Umali.
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createCodexAdapter } from "../../../src/terminal/agents/codex.ts";

const PARENT_ENV = { PATH: "/usr/bin", HOME: "/home/user" };
const pad = (value: number) => String(value).padStart(2, "0");
const today = new Date();
const TODAY_DIR = [String(today.getFullYear()), pad(today.getMonth() + 1), pad(today.getDate())];

const tokenCount = (input: number, cached: number, output: number) =>
  JSON.stringify({
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: input,
          cached_input_tokens: cached,
          output_tokens: output,
          reasoning_output_tokens: 5,
          total_tokens: input + output,
        },
      },
    },
  });

async function codexHomeWith(dayDir: readonly string[], threadId: string, lines: readonly string[]) {
  const codexHome = await mkdtemp(join(tmpdir(), "zks-codex-home-"));
  const dir = join(codexHome, "sessions", ...dayDir);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `rollout-2026-10-29T10-00-00-${threadId}.jsonl`), [...lines, ""].join("\n"));
  // A folder nobody can list: any walk of the whole sessions tree now fails.
  const blockWalk = () => mkdir(join(codexHome, "sessions", "1999"), { mode: 0o000 });
  return { adapter: createCodexAdapter({ parentEnv: { ...PARENT_ENV, CODEX_HOME: codexHome } }), blockWalk };
}

describe("codex adapter: usage", () => {
  it("reads the thread's latest token totals from its rollout file", async () => {
    const { adapter } = await codexHomeWith(["2026", "10", "29"], "019a-thread", [
      tokenCount(100, 20, 10),
      '{"type":"event_msg","payload":{"type":"token_count","info":null}}',
      tokenCount(900, 300, 40),
    ]);
    expect(await adapter.usageSource?.("019a-thread")).toEqual({ inputTokens: 600, outputTokens: 40, cacheTokens: 300 });
    expect(await adapter.usageSource?.("019b-other")).toBeNull();
    expect(await adapter.usageSource?.("../escape")).toBeNull();
  });

  it("finds today's thread without walking every session codex ever wrote", async () => {
    const { adapter, blockWalk } = await codexHomeWith(TODAY_DIR, "019c-today", [tokenCount(50, 0, 5)]);
    await blockWalk();
    expect(await adapter.usageSource?.("019c-today")).toEqual({ inputTokens: 50, outputTokens: 5, cacheTokens: 0 });
  });

  it("looks the rollout up once per thread", async () => {
    const { adapter, blockWalk } = await codexHomeWith(["2025", "01", "02"], "019d-old", [tokenCount(70, 10, 7)]);
    expect(await adapter.usageSource?.("019d-old")).toEqual({ inputTokens: 60, outputTokens: 7, cacheTokens: 10 });
    await blockWalk();
    expect(await adapter.usageSource?.("019d-old")).toEqual({ inputTokens: 60, outputTokens: 7, cacheTokens: 10 });
  });
});
