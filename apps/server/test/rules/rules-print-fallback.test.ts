// Created by The Angelo Umali.
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PromptInbox } from "../../src/agent/inbox.ts";
import { createPrintSessions } from "../../src/agent/print-sessions.ts";
import { buildRulesPromptBlock } from "../../src/rules/rules-prompt.ts";
import { createSessionToken, tokensMatch } from "../../src/security/token.ts";

const FAKE_CLAUDE = fileURLToPath(new URL("../agent/fixtures/fake-claude.mjs", import.meta.url));

describe("the claude -p fallback", () => {
  let scratchDir = "";
  beforeEach(async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "zks-print-rules-"));
    await mkdir(join(scratchDir, "project"));
  });
  afterEach(async () => {
    await rm(scratchDir, { recursive: true, force: true });
  });

  // Like mode T's rules.md: the block stays out of argv, where any local process could read it.
  it("passes the SDK path's rules block in an owner-only file with --append-system-prompt-file", async () => {
    const rulesBlock = buildRulesPromptBlock({ ruleTexts: ["Keep cuts under 60 s"] });
    const sessions = createPrintSessions({
      claudePath: "claude",
      runDir: join(scratchDir, "run"),
      appPort: 4317,
      pluginDir: scratchDir,
      createToken: createSessionToken,
      tokensMatch,
      spawn: (_command, args, options) => spawn(process.execPath, [FAKE_CLAUDE, ...args], options),
    });
    const handle = sessions.query({
      prompt: new PromptInbox(),
      projectId: "project-1",
      options: {
        maxTurns: 3,
        cwd: join(scratchDir, "project"),
        env: { PATH: process.env.PATH ?? "" },
        systemPrompt: { type: "preset", preset: "claude_code", append: rulesBlock, snapshot: false },
      },
    });
    const iterator: AsyncIterator<SDKMessage, unknown> = handle[Symbol.asyncIterator]();
    const { value } = await iterator.next();
    const argv = (value as { argv: string[] }).argv;
    const rulesPath = argv[argv.indexOf("--append-system-prompt-file") + 1] ?? "";

    expect(argv).not.toContain("--append-system-prompt");
    expect(argv.join(" ")).not.toContain("Keep cuts");
    expect(await readFile(rulesPath, "utf8")).toBe(rulesBlock);
    if (process.platform !== "win32") expect((await stat(rulesPath)).mode & 0o777).toBe(0o600);
    handle.close?.();
  });
});
