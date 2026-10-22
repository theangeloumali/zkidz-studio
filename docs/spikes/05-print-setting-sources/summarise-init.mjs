// Created by The Angelo Umali.
// Reads claude -p stream-json on stdin; prints the init fields that reveal which settings sources loaded.
import { createInterface } from "node:readline";

const variantName = process.argv[2];
const summary = { variant: variantName };
for await (const line of createInterface({ input: process.stdin })) {
  if (!line.startsWith("{")) continue;
  const message = JSON.parse(line);
  if (message.type === "system" && message.subtype === "init") {
    Object.assign(summary, {
      claude_code_version: message.claude_code_version,
      apiKeySource: message.apiKeySource,
      output_style: message.output_style,
      // Counts only: the names would publish this machine's personal connectors and plugins.
      builtInTools: message.tools.filter((tool) => !tool.startsWith("mcp__")),
      mcpToolCount: message.tools.filter((tool) => tool.startsWith("mcp__"))
        .length,
      mcpServerCount: message.mcp_servers.length,
      claudeAiConnectorCount: message.mcp_servers.filter((server) =>
        server.name.startsWith("claude.ai "),
      ).length,
      builtinPluginCount: message.plugins.filter((plugin) =>
        plugin.source?.endsWith("@builtin"),
      ).length,
      userOrInlinePluginCount: message.plugins.filter(
        (plugin) => !plugin.source?.endsWith("@builtin"),
      ).length,
      skillCount: message.skills.length,
      agentCount: message.agents?.length ?? 0,
    });
  }
  if (message.type === "result")
    Object.assign(summary, {
      result: {
        subtype: message.subtype,
        is_error: message.is_error,
        text: String(message.result).slice(0, 120),
      },
    });
}
console.log(JSON.stringify(summary, null, 2));
