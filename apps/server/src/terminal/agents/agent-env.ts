// Created by The Angelo Umali.
// The env for a non-Claude agent's PTY: the parent allowlist plus named extras, then a credential check (plan §6.6).
import { inheritedParentEnv } from "../../security/parent-env.ts";

// The agent must run on the user's own sign-in, never on a key or a provider the server's env happens to hold.
const CREDENTIAL_VARIABLE =
  /^(?:ANTHROPIC_|CLAUDE_CODE_USE_|OPENAI_|AZURE_OPENAI_|GEMINI_|GOOGLE_GENERATIVE_|OPENROUTER_|AWS_)|_API_KEY$|^(?:CLAUDE_CODE_OAUTH_TOKEN|CLAUDE_CONFIG_DIR|GOOGLE_APPLICATION_CREDENTIALS)$/;

type AgentLaunchFailure = "credential_env" | "config_conflict" | "companion_failed";

export class AgentLaunchError extends Error {
  readonly reason: AgentLaunchFailure;

  constructor(reason: AgentLaunchFailure, message: string) {
    super(message);
    this.name = "AgentLaunchError";
    this.reason = reason;
  }
}

interface TerminalAgentEnvOptions {
  /** Where the agent keeps its own sign-in (CODEX_HOME, XDG_*); passed through, never set by the studio. */
  readonly inheritNames?: readonly string[];
  readonly extraEnv?: Readonly<Record<string, string>>;
  readonly parentEnv?: Readonly<Record<string, string | undefined>>;
}

export function buildTerminalAgentEnv(options: TerminalAgentEnvOptions): Record<string, string> {
  const env = {
    ...inheritedParentEnv({ proxyOptIn: false, extraNames: options.inheritNames, parentEnv: options.parentEnv }),
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    ...options.extraEnv,
  };
  const credentialVariable = findAgentCredentialVariable(env);
  if (credentialVariable !== undefined)
    throw new AgentLaunchError("credential_env", `Terminal agents never get a credential; ${credentialVariable} must not be set.`);
  return env;
}

export function findAgentCredentialVariable(env: Readonly<Record<string, string>>): string | undefined {
  return Object.keys(env).find((name) => CREDENTIAL_VARIABLE.test(name));
}
