// Created by The Angelo Umali.
// Stands in for `claude -p` stream-json: echoes argv in init, answers each prompt, reports SIGINT as an interrupted result.
import { createInterface } from "node:readline";

const write = (message) => process.stdout.write(`${JSON.stringify({ session_id: "print-session", ...message })}\n`);
// Before init: the test sends SIGINT as soon as it sees init.
process.on("SIGINT", () => write({ type: "result", subtype: "error_during_execution", is_error: true, errors: ["interrupted"] }));
write({
  type: "system",
  subtype: "init",
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  marker: process.env.ZKS_FAKE_MARKER ?? null,
  studioEnv: { mcpUrl: process.env.ZKS_MCP_URL, mcpToken: process.env.ZKS_MCP_TOKEN, hookToken: process.env.ZKS_HOOK_TOKEN },
});
process.stdout.write("not json\n");

for await (const line of createInterface({ input: process.stdin })) {
  const { message } = JSON.parse(line);
  write({ type: "result", subtype: "success", is_error: false, result: `echo: ${message.content}` });
}
