// Created by The Angelo Umali.
// Spike 2: do Glob and Grep run under the SDK on this OS, and does a PreToolUse hook see their paths?
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import { runInitProbe } from "../01-sdk-init/probe-init.mjs";

const projectDir = fileURLToPath(new URL("./fixture/project", import.meta.url));
const toolName = process.argv[2] ?? "Grep";
const confined = process.argv[3] === "confined";

// Minimal stand-in for the plan's confineReads: deny a Glob/Grep path outside the project on a separator boundary.
const confineSearch = async (hookInput) => {
  const searchPath = hookInput.tool_input.path ?? ".";
  let realSearchPath;
  try {
    realSearchPath = realpathSync(resolve(hookInput.cwd, searchPath));
  } catch {
    realSearchPath = undefined;
  }
  const inside =
    realSearchPath === projectDir ||
    realSearchPath?.startsWith(projectDir + sep);
  return inside
    ? {}
    : {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: "path outside the project",
        },
      };
};
const prompts = {
  Grep: "Call the Grep tool once with pattern ZKS_SPIKE_MARKER, path set to the parent directory (..), and output_mode content. Then stop.",
  Glob: "Call the Glob tool once with pattern **/*.txt and path set to the parent directory (..). Then stop.",
};

const { init, messages, error } = await runInitProbe({
  prompt: prompts[toolName],
  cwd: projectDir,
  tools: ["Read", "Glob", "Grep"],
  maxTurns: 1,
  hooks: confined
    ? { PreToolUse: [{ matcher: "Glob|Grep", hooks: [confineSearch] }] }
    : undefined,
});

const toolUses = messages.flatMap((message) =>
  message.type === "assistant"
    ? message.message.content.filter((block) => block.type === "tool_use")
    : [],
);
const toolResults = messages.flatMap((message) =>
  message.type === "user" && Array.isArray(message.message.content)
    ? message.message.content.filter((block) => block.type === "tool_result")
    : [],
);
const redact = (text) =>
  String(text)
    .replaceAll(projectDir, "<project>")
    .replaceAll(
      fileURLToPath(new URL("./fixture", import.meta.url)),
      "<fixture>",
    );

console.log(
  JSON.stringify(
    {
      tool: toolName,
      confined,
      initTools: init?.tools,
      toolUses: toolUses.map((use) => ({
        name: use.name,
        input: JSON.parse(redact(JSON.stringify(use.input))),
      })),
      toolResults: toolResults.map((toolResult) => ({
        is_error: toolResult.is_error ?? false,
        content: redact(JSON.stringify(toolResult.content)).slice(0, 400),
      })),
      error,
    },
    null,
    2,
  ),
);
