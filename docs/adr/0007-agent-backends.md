<!-- Created by The Angelo Umali. -->

# ADR 0007: Codex and OpenCode as mode T agents

- Status: Accepted
- Date: 2026-10-29
- Plan: `docs/plans/zkidz-studio-editing-ux-agents-2026-10-29.md` Phase 6 (#31); reverses platform plan §2.2

## Context

The platform plan's §2.2 listed "No agent backends other than Claude" as a non-goal. The owner reversed it on 2026-10-29: "also I
want to add a support on codex and opencode to be used". The plan of record is not rewritten; this ADR records the change.

Mode T (ADR 0002) runs the user's own signed-in CLI in a PTY. The studio sees each edit through hooks and its MCP tools, and it
never handles a credential. A new agent has to meet the same bar. It runs as installed, on its own sign-in. It uses the studio's
tools only, with no shell, no file edits, no web and no reads outside the project. Every tool call reaches the Activity tab.

## Decision

Both agents sit behind `AgentAdapter` (`apps/server/src/terminal/agents/agent-adapter.ts`). Each has its own auth mode
(`codex_terminal`, `opencode_terminal`), connect route and Setup card. Both cards are opt-in, behind a disclosure and a consent box.
The env is the mode T allowlist plus named extras, and launch fails if a provider key or token appears in it (`agent-env.ts`). Each
session's files are 0600 in a 0700 folder under the run directory and are removed on exit. Instructions come from `plugin/skills`:
the edit-director body plus an index of the other skills. The agent reads a full skill body through the read-only `read_skill`
tool.

Codex CLI, 0.164.0 or newer (`codex.ts`):

- The lockdown is all in argv: `--sandbox read-only -a never`, 19 `--disable` flags for every shell, browser, computer-use,
  image, plugin, sub-agent and worktree feature, and `web_search="disabled"`.
- The user's own MCP servers are listed with `codex mcp list --json` and each is switched off for the session. The studio MCP gets
  its tokens by env var name, never in argv.
- Hooks for `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse` and `Stop` relay to the studio. `PreToolUse` runs the
  same deny policy as Claude Code.
- Instructions go in `developer_instructions`, which adds to Codex's base prompt; `model_instructions_file` would replace it.
  Usage is read from the session's rollout file.
- `CODEX_HOME` is passed through untouched, because it also holds the sign-in.

OpenCode, 2.2.0 or newer (`opencode.ts`, `opencode-stream.ts`):

- A companion `opencode serve` on a free loopback port, behind a random per-session password. The TUI attaches with `--server` and
  `--session`.
- A studio-written config (`OPENCODE_CONFIG_DIR`) sets `"*": "deny"`, `studio_*` and `read` allowed, and
  `external_directory: "deny"`. It also turns off sharing and auto-update.
- `OPENCODE_DISABLE_PROJECT_CONFIG`, `OPENCODE_DISABLE_CLAUDE_CODE` and `OPENCODE_DISABLE_AUTOUPDATE` stop it from loading the
  project's config or `~/.claude` skills.
- Events arrive over the server's SSE stream, and the adapter reconnects after a drop. Any permission request that still comes
  through is answered with a reject.
- The studio never offers a Claude Pro or Max sign-in in OpenCode. The Setup card says so (see policy-check §12).

## What the adapters cannot enforce

- Codex: `~/.codex/config.toml` still loads, and the studio overrides only the keys it names. The update notice still shows in the
  TUI, and the studio leaves it on.
- Codex: the read-only sandbox limits writes, not reads. Reads outside the project are blocked by the `PreToolUse` policy only.
- OpenCode: global config and plugins in `~/.config/opencode` still load, because the studio never edits that folder. A plugin runs
  inside OpenCode's process, outside the permission config.
- OpenCode has no blocking pre-tool hook. The deny comes from its permission config and the reject replies, so a bug in OpenCode's
  permission engine would get past the studio.
- Neither agent's sign-in is checked before launch. A signed-out agent asks for its own login in the terminal, and the studio
  never offers one.

## Consequences

- `AUTH_MODES` gains `codex_terminal` and `opencode_terminal`. `ConnectionSchema` gains an optional `agentVersions`, so a client
  built before this change still parses the reply.
- The doctor and `zks doctor` report each agent's version, with its install link and update command.
- Wiring the adapters into the session launcher is Phase 7. Until then, Claude Code is the only agent the studio starts.

## Sources

Fetched 2026-10-29.

- Codex authentication: https://developers.openai.com/codex/auth (redirects to https://learn.chatgpt.com/docs/auth)
- Codex CLI: https://developers.openai.com/codex/cli, licence Apache-2.0 (https://github.com/openai/codex)
- OpenCode providers: https://opencode.ai/docs/providers/, licence MIT (https://github.com/sst/opencode)
- Claude Code legal and compliance: https://code.claude.com/docs/en/legal-and-compliance
- Claude Code hooks guide: https://code.claude.com/docs/en/hooks-guide
