<!-- Created by The Angelo Umali. -->

# ADR 0002: Claude access modes A, B and T

- Status: Accepted (mode T ships opt-in while Anthropic's written reply is pending)
- Date: 2026-10-22
- Plan: D5, §6.2, §6.3, §6.6

## Context

Each user brings their own Claude access. The app must never offer a login of its own, read Claude Code's credentials, or forward
tokens. Stray routing variables in the user's shell must not override the chosen mode.

## Decision

| Mode        | What runs                                              | Credential                                                                                         |
| ----------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| A (default) | Agent SDK session                                      | User's API key, kept in the OS keychain (a 0600 file where there is none); the UI shows the last 4 |
| B           | Agent SDK session                                      | The user's cloud CLI profile; the child gets only the provider switch and its non-secret variables |
| T (opt-in)  | The user's own installed, unmodified `claude` in a PTY | None in the app; the user signs in with Claude Code's own `/login`                                 |

- The child environment is built from an allowlist, never from `process.env` minus a denylist.
- Mode T spawns the resolved `claude` path with an argv array and no shell, with `--restricted`, a server-written settings file of
  HTTP hooks, and the studio MCP stdio twin. Its env carries no `ANTHROPIC_*`, `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CODE_USE_*` or
  `CLAUDE_CONFIG_DIR`.
- Per-provider region and project variables for mode B: Bedrock `CLAUDE_CODE_USE_BEDROCK`, `AWS_REGION`, `AWS_PROFILE`; Vertex
  `CLAUDE_CODE_USE_VERTEX`, `CLOUD_ML_REGION`, `ANTHROPIC_VERTEX_PROJECT_ID`; Foundry `CLAUDE_CODE_USE_FOUNDRY`,
  `ANTHROPIC_FOUNDRY_RESOURCE`; Anthropic on AWS `CLAUDE_CODE_USE_ANTHROPIC_AWS`, `ANTHROPIC_AWS_WORKSPACE_ID`, `AWS_REGION`,
  `AWS_PROFILE`.

## Consequences

- If Anthropic replies "no" to mode T, it is removed before the next release; A and B ship either way.
- The shared contracts carry `AUTH_MODES = ["api_key", "cloud", "terminal"]`; no table or event holds a credential.
