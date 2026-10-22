// Created by The Angelo Umali.
// Spike 1: settingSources [] + local plugin; prints the init fields the server will assert on, per auth variant.
import { runInitProbe } from "./probe-init.mjs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Dummy values only: they prove which source init reports, and must fail at the API.
const VARIANTS = {
  login: {},
  "mode-a-dummy-key": { ANTHROPIC_API_KEY: "spike-invalid-key" },
  "mode-b-bedrock-no-creds": {
    CLAUDE_CODE_USE_BEDROCK: "1",
    AWS_REGION: "us-east-1",
  },
  "isolated-config-dir": {
    CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), "zks-spike-config-")),
  },
};

const variantName = process.argv[2] ?? "login";
const skills = process.argv[3] ? process.argv[3].split(",") : "all";
const { init, result, error } = await runInitProbe({
  prompt: "Reply with one word: ready",
  cwd: tmpdir(),
  tools: ["Read", "Skill", "AskUserQuestion"],
  envExtra: VARIANTS[variantName],
  skills,
});

const report = {
  variant: variantName,
  skillsOption: skills,
  claude_code_version: init?.claude_code_version,
  apiKeySource: init?.apiKeySource,
  model: init?.model,
  permissionMode: init?.permissionMode,
  tools: init?.tools,
  mcp_servers: init?.mcp_servers,
  plugins: init?.plugins?.map((plugin) => plugin.source),
  plugin_errors: init?.plugin_errors ?? [],
  skills: init?.skills,
  error,
  result: {
    subtype: result?.subtype,
    is_error: result?.is_error,
    num_turns: result?.num_turns,
    text: result?.result?.slice(0, 200),
  },
};
console.log(JSON.stringify(report, null, 2));
