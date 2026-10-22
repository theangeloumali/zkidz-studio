// Created by The Angelo Umali.
// Spike 2: do Glob and Grep run under the SDK on this OS, and does a PreToolUse hook see their paths?
import { fileURLToPath } from "node:url";
import { runInitProbe } from "../01-sdk-init/probe-init.mjs";
import { confineSearchInput } from "./confine.mjs";

const projectDir = fileURLToPath(new URL("./fixture/project", import.meta.url));
const scenarioName = process.argv[2] ?? "Grep";
const confined = process.argv[3] === "confined";

const confineSearch = async (hookInput) => {
  const denyReason = confineSearchInput(projectDir, hookInput.cwd, hookInput.tool_name, hookInput.tool_input);
  return denyReason
    ? {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: denyReason,
        },
      }
    : {};
};
const fixtureDir = fileURLToPath(new URL("./fixture", import.meta.url));
// Grep/Glob search `..` via path; the *-pattern scenarios try to escape through the pattern or glob field instead.
const prompts = {
  Grep: "Call the Grep tool once with pattern ZKS_SPIKE_MARKER, path set to the parent directory (..), and output_mode content. Then stop.",
  Glob: "Call the Glob tool once with pattern **/*.txt and path set to the parent directory (..). Then stop.",
  "Glob-dotdot-pattern": "Call the Glob tool once with pattern ../outside/*.txt and no path argument. Then stop.",
  "Glob-absolute-pattern": `Call the Glob tool once with pattern ${fixtureDir}/outside/*.txt and path set to . (the current directory). Then stop.`,
  "Grep-dotdot-glob":
    "Call the Grep tool once with pattern ZKS_SPIKE_MARKER, glob set to ../outside/*.txt, no path argument, and output_mode content. Then stop.",
};

const { init, messages, error } = await runInitProbe({
  prompt: prompts[scenarioName],
  cwd: projectDir,
  tools: ["Read", "Glob", "Grep"],
  maxTurns: 1,
  hooks: confined ? { PreToolUse: [{ matcher: "Glob|Grep", hooks: [confineSearch] }] } : undefined,
});

const toolUses = messages.flatMap((message) => (message.type === "assistant" ? message.message.content.filter((block) => block.type === "tool_use") : []));
const toolResults = messages.flatMap((message) =>
  message.type === "user" && Array.isArray(message.message.content) ? message.message.content.filter((block) => block.type === "tool_result") : [],
);
const redact = (text) => String(text).replaceAll(projectDir, "<project>").replaceAll(fixtureDir, "<fixture>");

console.log(
  JSON.stringify(
    {
      scenario: scenarioName,
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
