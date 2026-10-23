// Created by The Angelo Umali.
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agentConfigDir, buildAgentEnv, ensureAgentConfigDir, type AgentAuthMode } from "../../src/auth/agent-env.ts";

const OS_BASICS = ["PATH", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TMP", "TEMP", "TMPDIR", "SystemRoot", "ComSpec", "PATHEXT", "LANG"];
const PROXY_VARS = ["HTTPS_PROXY", "NO_PROXY", "NODE_EXTRA_CA_CERTS"];
const FIXED_VARS = ["CLAUDE_CODE_DISABLE_AUTO_MEMORY", "ENABLE_CLAUDEAI_MCP_SERVERS", "CLAUDE_AGENT_SDK_CLIENT_APP"];
const TERMINAL_VARS = ["TERM", "COLORTERM", "ZKS_HOOK_TOKEN", "ZKS_MCP_TOKEN", "ZKS_MCP_URL"];

const HOSTILE_PARENT_ENV = {
  PATH: "/usr/bin",
  HOME: "/home/someone",
  LANG: "en_US.UTF-8",
  LC_ALL: "en_US.UTF-8",
  HTTPS_PROXY: "http://proxy.invalid:3128",
  ANTHROPIC_BASE_URL: "http://evil",
  ANTHROPIC_AWS_API_KEY: "x",
  ANTHROPIC_API_KEY: "parent-key",
  CLAUDE_CODE_OAUTH_TOKEN: "parent-oauth",
  CLAUDE_CODE_USE_BEDROCK: "1",
  ZKS_HOME: "/srv/zks",
  ZKS_PORT: "4317",
  DATABASE_URL: "postgres://db.invalid/zks",
  OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector.invalid",
  BETA_TRACING_ENDPOINT: "http://tracing.invalid",
  AWS_SECRET_ACCESS_KEY: "parent-aws-secret",
};

const STUDIO_HOME = "/srv/studio-home";
const MODES: Record<AgentAuthMode["kind"], AgentAuthMode> = {
  apiKey: { kind: "apiKey", apiKey: "test-key-0000abcd" },
  cloud: { kind: "cloud", provider: "bedrock", values: { AWS_REGION: "us-east-1", AWS_PROFILE: "studio", AWS_SECRET_ACCESS_KEY: "smuggled" } },
  terminal: { kind: "terminal", tokens: { hookToken: "hook-token", mcpToken: "mcp-token", mcpUrl: "http://127.0.0.1:4317/api/mcp/s1" } },
};

function allowlistFor(mode: AgentAuthMode): Set<string> {
  const base = [...OS_BASICS, "LC_ALL", ...PROXY_VARS, ...FIXED_VARS];
  if (mode.kind === "apiKey") return new Set([...base, "CLAUDE_CONFIG_DIR", "ANTHROPIC_API_KEY"]);
  if (mode.kind === "cloud") return new Set([...base, "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_USE_BEDROCK", "AWS_REGION", "AWS_PROFILE"]);
  return new Set([...base, ...TERMINAL_VARS]);
}

describe("buildAgentEnv", () => {
  for (const mode of Object.values(MODES)) {
    it(`keeps only allowlisted keys from a hostile parent env (${mode.kind})`, () => {
      const childEnv = buildAgentEnv(mode, { studioHome: STUDIO_HOME, appVersion: "0.1.0", proxyOptIn: true, parentEnv: HOSTILE_PARENT_ENV });
      const allowlist = allowlistFor(mode);
      expect(Object.keys(childEnv).filter((name) => !allowlist.has(name))).toEqual([]);
      expect(childEnv.PATH).toBe("/usr/bin");
      expect(childEnv.LC_ALL).toBe("en_US.UTF-8");
      expect(childEnv.ENABLE_CLAUDEAI_MCP_SERVERS).toBe("false");
      expect(childEnv.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe("1");
      expect(childEnv.CLAUDE_AGENT_SDK_CLIENT_APP).toBe("zkidz-studio/0.1.0");
    });
  }

  it("never hands the terminal kind a credential, a provider switch or a config dir", () => {
    const childEnv = buildAgentEnv(MODES.terminal, { studioHome: STUDIO_HOME, appVersion: "0.1.0", proxyOptIn: false, parentEnv: HOSTILE_PARENT_ENV });
    const forbidden = Object.keys(childEnv).filter(
      (name) => name.startsWith("ANTHROPIC_") || name.startsWith("CLAUDE_CODE_USE_") || name === "CLAUDE_CODE_OAUTH_TOKEN" || name === "CLAUDE_CONFIG_DIR",
    );
    expect(forbidden).toEqual([]);
    expect(childEnv).toMatchObject({
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      ZKS_HOOK_TOKEN: "hook-token",
      ZKS_MCP_TOKEN: "mcp-token",
      ZKS_MCP_URL: "http://127.0.0.1:4317/api/mcp/s1",
    });
  });

  it("passes proxy variables only after the user opts in", () => {
    const options = { studioHome: STUDIO_HOME, appVersion: "0.1.0", parentEnv: HOSTILE_PARENT_ENV };
    expect(buildAgentEnv(MODES.apiKey, { ...options, proxyOptIn: false }).HTTPS_PROXY).toBeUndefined();
    expect(buildAgentEnv(MODES.apiKey, { ...options, proxyOptIn: true }).HTTPS_PROXY).toBe("http://proxy.invalid:3128");
  });

  it("sets the provider switch itself and drops values outside the provider's list", () => {
    const childEnv = buildAgentEnv(MODES.cloud, { studioHome: STUDIO_HOME, appVersion: "0.1.0", proxyOptIn: false, parentEnv: {} });
    expect(childEnv).toMatchObject({ CLAUDE_CODE_USE_BEDROCK: "1", AWS_REGION: "us-east-1", AWS_PROFILE: "studio" });
    expect(childEnv.AWS_SECRET_ACCESS_KEY).toBeUndefined();
  });

  it("puts the api key only in the apiKey kind", () => {
    const options = { studioHome: STUDIO_HOME, appVersion: "0.1.0", proxyOptIn: false, parentEnv: HOSTILE_PARENT_ENV };
    expect(buildAgentEnv(MODES.apiKey, options).ANTHROPIC_API_KEY).toBe("test-key-0000abcd");
    expect(buildAgentEnv(MODES.cloud, options).ANTHROPIC_API_KEY).toBeUndefined();
  });
});

describe("CLAUDE_CONFIG_DIR isolation", () => {
  let scratchDir = "";
  beforeEach(async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "zks-agent-env-"));
  });
  afterEach(async () => {
    await rm(scratchDir, { recursive: true, force: true });
  });

  it("points apiKey and cloud at the app dir even when the parent names a signed-in config dir", async () => {
    const signedInConfigDir = join(scratchDir, "user-claude");
    await ensureAgentConfigDir(signedInConfigDir);
    await writeFile(join(signedInConfigDir, ".credentials.json"), "{}");
    const studioHome = join(scratchDir, "home");
    const parentEnv = { ...HOSTILE_PARENT_ENV, CLAUDE_CONFIG_DIR: signedInConfigDir };
    for (const mode of [MODES.apiKey, MODES.cloud]) {
      const childEnv = buildAgentEnv(mode, { studioHome, appVersion: "0.1.0", proxyOptIn: false, parentEnv });
      expect(childEnv.CLAUDE_CONFIG_DIR).toBe(join(studioHome, "agent-config"));
    }
  });

  it.skipIf(process.platform === "win32")("creates the app config dir owner-only", async () => {
    const studioHome = join(scratchDir, "home");
    await ensureAgentConfigDir(agentConfigDir(studioHome));
    expect((await stat(agentConfigDir(studioHome))).mode & 0o777).toBe(0o700);
  });
});
