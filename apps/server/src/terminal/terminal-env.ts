// Created by The Angelo Umali.
// The terminal env itself is buildAgentEnv({ kind: "terminal" }); this is the launch-time check that it carries no credential.

// The user's own claude must use its own sign-in and config directory, never one routed in by the app (§6.3 item 3).
const CREDENTIAL_VARIABLE = /^(?:ANTHROPIC_|CLAUDE_CODE_USE_)|^(?:CLAUDE_CODE_OAUTH_TOKEN|CLAUDE_CONFIG_DIR)$/;

export function findCredentialVariable(env: Readonly<Record<string, string>>): string | undefined {
  return Object.keys(env).find((name) => CREDENTIAL_VARIABLE.test(name));
}
