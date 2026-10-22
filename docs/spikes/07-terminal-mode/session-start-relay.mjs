// Created by The Angelo Umali.
// SessionStart accepts only command and mcp_tool hooks, so this forwards stdin to the HTTP bridge.
let body = "";
for await (const chunk of process.stdin) body += chunk;
const response = await fetch(process.env.ZKS_HOOK_URL, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${process.env.ZKS_HOOK_TOKEN}`,
  },
  body,
});
// Non-zero exit makes the failure visible in the session instead of silent.
process.exit(response.ok ? 0 : 1);
