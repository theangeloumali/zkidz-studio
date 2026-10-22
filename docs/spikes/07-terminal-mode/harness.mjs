// Created by The Angelo Umali.
// Spike 7: the user's own interactive claude in a PTY with the plan §6.3 flags, HTTP hooks and a stdio MCP twin.
// Usage: node harness.mjs signed-in | signed-out   (signed-out points CLAUDE_CONFIG_DIR at an empty dir; it never logs anyone out)
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pty from "node-pty";
import xtermHeadless from "@xterm/headless";

const scenario = process.argv[2] ?? "signed-in";
const spikeDir = fileURLToPath(new URL(".", import.meta.url));
const runDir = mkdtempSync(join(tmpdir(), "zks-spike07-"));
const projectDir = join(runDir, "project");
mkdirSync(projectDir);
writeFileSync(join(projectDir, "hello.txt"), "hello from the project\n");
const mcpLogPath = join(runDir, "mcp.log");
const hookToken = randomBytes(24).toString("hex");
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

// Hook bridge stand-in: records each event, checks the bearer token, denies Read to prove the policy path.
const hookEvents = [];
const hookServer = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    const payload = JSON.parse(body || "{}");
    const authorized = request.headers.authorization === `Bearer ${hookToken}`;
    hookEvents.push({
      event: payload.hook_event_name,
      authorized,
      at: Date.now(),
      tool: payload.tool_name,
      source: payload.source,
      via: request.headers["user-agent"]?.split("/")[0],
      permission_mode: payload.permission_mode,
      model: payload.model,
      last_assistant_message: payload.last_assistant_message?.slice(0, 80),
    });
    const denyRead = payload.hook_event_name === "PreToolUse" && payload.tool_name === "Read";
    response.writeHead(authorized ? 200 : 401, {
      "content-type": "application/json",
    });
    response.end(
      denyRead
        ? JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "deny",
              permissionDecisionReason: "spike policy denies Read",
            },
          })
        : "{}",
    );
  });
});
await new Promise((resolve) => hookServer.listen(0, "127.0.0.1", resolve));
const hookUrl = `http://127.0.0.1:${hookServer.address().port}/hooks`;

const httpHook = (extra = {}) => ({
  type: "http",
  url: hookUrl,
  headers: { Authorization: "Bearer $ZKS_HOOK_TOKEN" },
  allowedEnvVars: ["ZKS_HOOK_TOKEN"],
  timeout: 30,
  ...extra,
});
const settingsPath = join(runDir, "settings.json");
writeFileSync(
  settingsPath,
  JSON.stringify({
    hooks: {
      // http here is documented as unsupported; kept to record that it is skipped, then relayed by a command hook.
      SessionStart: [
        {
          hooks: [
            httpHook(),
            {
              type: "command",
              command: `"${process.execPath}" "${join(spikeDir, "session-start-relay.mjs")}"`,
              timeout: 10,
            },
          ],
        },
      ],
      UserPromptSubmit: [{ hooks: [httpHook()] }],
      PreToolUse: [{ matcher: "*", hooks: [httpHook({ onFailure: "block" })] }],
      PostToolUse: [{ matcher: "*", hooks: [httpHook()] }],
      Stop: [{ hooks: [httpHook()] }],
      Notification: [{ hooks: [httpHook()] }],
    },
  }),
);
const mcpConfigPath = join(runDir, "mcp.json");
writeFileSync(
  mcpConfigPath,
  JSON.stringify({
    mcpServers: {
      studio: {
        command: process.execPath,
        args: [join(spikeDir, "stub-mcp.mjs")],
        env: { ZKS_SPIKE_MCP_LOG: mcpLogPath },
      },
    },
  }),
);

const claudePath = execFileSync("which", ["claude"], {
  encoding: "utf8",
}).trim();
const args = [
  "--session-id",
  randomUUID(),
  "--restricted",
  "--settings",
  settingsPath,
  "--mcp-config",
  mcpConfigPath,
  "--strict-mcp-config",
  "--tools",
  "Read",
  "--allowedTools",
  "mcp__studio__ping",
  "--permission-mode",
  "default",
  "--model",
  "haiku",
];
// Terminal-kind env: OS basics plus tokens; no ANTHROPIC_* so the binary uses its own sign-in.
const env = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  LANG: process.env.LANG ?? "C.UTF-8",
  TERM: "xterm-256color",
  COLORTERM: "truecolor",
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  ENABLE_CLAUDEAI_MCP_SERVERS: "false",
  ZKS_HOOK_TOKEN: hookToken,
  ZKS_HOOK_URL: hookUrl,
  ZKS_MCP_TOKEN: randomBytes(24).toString("hex"),
  ...(scenario === "signed-out" ? { CLAUDE_CONFIG_DIR: join(runDir, "empty-config") } : {}),
};

const columns = 120;
const rows = 40;
const terminal = new xtermHeadless.Terminal({
  cols: columns,
  rows,
  allowProposedApi: true,
});
const startedAt = Date.now();
const child = pty.spawn(claudePath, args, {
  name: "xterm-256color",
  cols: columns,
  rows,
  cwd: projectDir,
  env,
});
let exitInfo = null;
child.onData((data) => terminal.write(data));
child.onExit((info) => (exitInfo = { ...info, msAfterSpawn: Date.now() - startedAt }));

const redact = (text) =>
  text
    .replaceAll(runDir, "<run>")
    .replaceAll(homedir(), "~")
    .replace(/Claude (Max|Pro|Team|Enterprise)\b/g, "<subscription plan>");
const screen = () => {
  const buffer = terminal.buffer.active;
  const lines = [];
  for (let index = 0; index < buffer.length; index++) lines.push(buffer.getLine(index)?.translateToString(true) ?? "");
  return redact(
    lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
};
const screenTail = (lineCount = 30) => screen().split("\n").slice(-lineCount).join("\n");
const waitFor = async (predicate, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(250);
  }
  return false;
};
const hasEvent = (name, after = 0) => hookEvents.some((event) => event.event === name && event.at >= after);
const mcpLog = () =>
  existsSync(mcpLogPath)
    ? readFileSync(mcpLogPath, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
// Bracketed paste, as the plan's prompt composer writes it.
const paste = (text) => child.write(`\x1b[200~${text}\x1b[201~`);

const report = {
  scenario,
  claudeVersion: execFileSync(claudePath, ["--version"], {
    encoding: "utf8",
  }).trim(),
  args: args.map(redact),
  steps: {},
};

// Accept the folder-trust dialog if it shows: record that it did, since the app must expect it.
await waitFor(() => /trust/i.test(screen()) || hasEvent("SessionStart"), 30_000);
report.steps.trustDialog = /trust/i.test(screen()) ? screenTail(15) : "not shown";
// The dialog defaults to "No, exit": move to "Yes" before Enter.
if (/trust/i.test(screen()) && !hasEvent("SessionStart")) {
  await waitFor(() => /Enter to confirm/.test(screen()), 10_000);
  await sleep(1500);
  child.write("\x1b[B");
  report.steps.trustYesSelected = await waitFor(() => /❯ Yes/.test(screen()), 5_000);
  if (report.steps.trustYesSelected) child.write("\r");
}
report.steps.sessionStartArrived = await waitFor(() => hasEvent("SessionStart"), 30_000);
report.steps.sessionStartMs = hookEvents.find((event) => event.event === "SessionStart")?.at - startedAt;
await sleep(3000);
report.steps.mcpStartedBeforePrompt = mcpLog().some((entry) => entry.event === "started");
report.steps.startupScreen = screenTail(25);

if (scenario === "signed-out") {
  // Observe only: the sign-in flow belongs to Claude Code and the user.
  await sleep(5000);
  report.steps.signedOutScreen = screenTail(30);
} else {
  // /login must be reachable from the slash menu; typed but never submitted.
  child.write("/login");
  await sleep(2000);
  report.steps.loginMenuScreen = screenTail(12);
  report.steps.loginListed = /\/login/.test(screenTail(12));
  child.write("\x7f".repeat(6));
  await sleep(800);

  const promptAt = Date.now();
  paste("Call the mcp__studio__ping tool once. Then use the Read tool on hello.txt. Then reply with exactly one word: done.");
  await sleep(300);
  child.write("\r");
  report.steps.stopAfterPrompt = await waitFor(() => hasEvent("Stop", promptAt), 120_000);
  report.steps.promptScreen = screenTail(30);

  // onFailure: "block": with the bridge down, a tool call must not run.
  await new Promise((resolve) => hookServer.close(resolve));
  hookServer.closeAllConnections?.();
  const pingsBefore = mcpLog().filter((entry) => entry.event === "ping").length;
  const offlineAt = Date.now();
  paste("Call the mcp__studio__ping tool once more, then reply with exactly one word: done.");
  await sleep(300);
  child.write("\r");
  await sleep(45_000);
  report.steps.pingsWhileBridgeDown = mcpLog().filter((entry) => entry.event === "ping").length - pingsBefore;
  report.steps.bridgeDownScreen = screenTail(25);
  report.steps.bridgeDownElapsedMs = Date.now() - offlineAt;
}

report.hookEvents = hookEvents.map(({ at, ...event }) => ({
  ...event,
  msAfterSpawn: at - startedAt,
}));
report.mcpLog = mcpLog().map(({ at, ...entry }) => ({
  ...entry,
  msAfterSpawn: at - startedAt,
}));
child.kill();
await sleep(500);
report.exitInfo = exitInfo;
hookServer.listening && hookServer.close();
mkdirSync(join(spikeDir, "results"), { recursive: true });
writeFileSync(join(spikeDir, "results", `${scenario}.json`), JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify(
    {
      scenario,
      steps: Object.fromEntries(Object.entries(report.steps).filter(([, value]) => typeof value !== "string" || value.length < 60)),
      hookEvents: report.hookEvents,
      mcpLog: report.mcpLog,
    },
    null,
    1,
  ),
);
process.exit(0);
