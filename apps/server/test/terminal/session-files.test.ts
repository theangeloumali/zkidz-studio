// Created by The Angelo Umali.
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearSessionFiles, removeSessionFiles, writeSessionFiles, type SessionFilesRequest } from "../../src/terminal/session-files.ts";

const SESSION_ID = "6f1c2a52-1d0c-4c3e-9a51-2b7f0f6f9f10";
const IS_POSIX = process.platform !== "win32";

let runDir: string;
let request: SessionFilesRequest;

beforeEach(async () => {
  runDir = await mkdtemp(join(tmpdir(), "zks-session-files-"));
  request = {
    runDir,
    sessionId: SESSION_ID,
    appPort: 4317,
    nodePath: "/opt/node/bin/node",
    hookRelayPath: "/opt/zks/bin/zks-hook.mjs",
    mcpServerPath: "/opt/zks/bin/zks-mcp.mjs",
    rulesText: "Use studio tools only.",
  };
});

afterEach(async () => {
  await rm(runDir, { recursive: true, force: true });
});

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

describe("writeSessionFiles", () => {
  it("keeps the session's files in the run dir, not the persistent studio home", async () => {
    const files = await writeSessionFiles(request);
    expect(dirname(files.dir)).toBe(runDir);
    expect(basename(files.dir).startsWith(`${SESSION_ID}.`)).toBe(true);
  });

  it("routes every hook to the session's bridge, with SessionStart through the command relay", async () => {
    const files = await writeSessionFiles(request);
    const hookUrl = `http://127.0.0.1:4317/api/terminal/${SESSION_ID}/hooks`;
    const httpHook = { type: "http", url: hookUrl, headers: { Authorization: "Bearer $ZKS_HOOK_TOKEN" }, allowedEnvVars: ["ZKS_HOOK_TOKEN"], timeout: 30 };

    expect(files.hookUrl).toBe(hookUrl);
    expect(await readJson(files.settingsPath)).toEqual({
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command: `"/opt/node/bin/node" "/opt/zks/bin/zks-hook.mjs" "${hookUrl}"`, timeout: 10 }] }],
        UserPromptSubmit: [{ hooks: [{ ...httpHook, onFailure: "block" }] }],
        PreToolUse: [{ matcher: "*", hooks: [{ ...httpHook, onFailure: "block" }] }],
        PostToolUse: [{ matcher: "*", hooks: [httpHook] }],
        Stop: [{ hooks: [httpHook] }],
        Notification: [{ hooks: [httpHook] }],
      },
    });
  });

  it("points the studio MCP server at the stdio twin and the twin at the session's loopback MCP routes", async () => {
    const files = await writeSessionFiles(request);
    expect(await readJson(files.mcpConfigPath)).toEqual({
      mcpServers: {
        studio: {
          type: "stdio",
          command: "/opt/node/bin/node",
          args: ["/opt/zks/bin/zks-mcp.mjs"],
          env: { ZKS_MCP_TOKEN: "${ZKS_MCP_TOKEN}", ZKS_MCP_URL: "${ZKS_MCP_URL}" },
        },
      },
    });
    expect(await readFile(files.rulesPath, "utf8")).toBe("Use studio tools only.");
    expect(files.mcpUrl).toBe(`http://127.0.0.1:4317/api/mcp/${SESSION_ID}`);
  });

  it.runIf(IS_POSIX)("keeps the folder 0700 and every file 0600", async () => {
    const files = await writeSessionFiles(request);
    expect((await stat(files.dir)).mode & 0o777).toBe(0o700);
    for (const path of [files.settingsPath, files.mcpConfigPath, files.rulesPath]) {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    }
  });

  // A reopen resumes the same session id while the killed launch's cleanup may still be running.
  it("gives a resumed launch its own files, which the previous launch's late cleanup cannot touch", async () => {
    const first = await writeSessionFiles(request);
    const resumed = await writeSessionFiles(request);
    expect(resumed.dir).not.toBe(first.dir);

    await removeSessionFiles(first);
    await expect(readFile(resumed.settingsPath, "utf8")).resolves.toContain("hooks");
    await expect(readFile(resumed.mcpConfigPath, "utf8")).resolves.toContain("mcpServers");
  });

  it("refuses a session id that is not a uuid, so it cannot steer the folder path", async () => {
    await expect(writeSessionFiles({ ...request, sessionId: "../escape" })).rejects.toThrow();
  });

  it("refuses a quote in a command path, which would break out of the hook command", async () => {
    await expect(writeSessionFiles({ ...request, hookRelayPath: '/opt/zks" && evil "' })).rejects.toThrow(/quote/);
  });

  it("removes the whole session folder at session end", async () => {
    const files = await writeSessionFiles(request);
    await removeSessionFiles(files);
    await expect(stat(files.dir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("clears a crashed session's leftover files at startup", async () => {
    const files = await writeSessionFiles(request);
    await clearSessionFiles(runDir);
    await expect(stat(files.dir)).rejects.toMatchObject({ code: "ENOENT" });
    const rewritten = await writeSessionFiles(request);
    await expect(readFile(rewritten.settingsPath, "utf8")).resolves.toContain("hooks");
  });
});
