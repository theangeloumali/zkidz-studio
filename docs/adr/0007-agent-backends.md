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

Codex CLI, 0.164.0 or newer (`codex.ts`, `codex-lockdown.ts`, `codex-probes.ts`):

- The lockdown is all `-c` config keys and `--disable` flags: `sandbox_mode="read-only"`, `approval_policy="never"`, 19 disabled
  features (every shell, browser, computer-use, image, plugin, sub-agent and worktree feature) and `web_search="disabled"`.
- Feature flags do not remove Codex 0.164's code-mode `exec` tool or its `collaboration` sub-agent tools, and
  `agents.max_threads=0` is rejected ("must be at least 1"). So the studio writes its own model catalog (`model_catalog_json`): a
  copy of `$CODEX_HOME/models_cache.json` with every model set to direct tool mode, with no multi-agent version, no search tool,
  no experimental tools and no `apply_patch`. A launch with no model list yet is refused.
- The studio instructions are appended to each model's base prompt in that catalog file, so they never appear in argv or
  `/proc/<pid>/cmdline`.
- The user's own MCP servers are listed with `codex mcp list --json` and each is switched off for the session. The studio MCP gets
  its tokens by env var name, never in argv.
- Before the TUI starts, `codex debug prompt-input` runs with the final args. The launch is refused with `config_conflict` unless
  every tool it lists is a studio MCP tool (`mcp__studio.*`), `request_user_input` or one of the three MCP-resource tools.
- Hooks for `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse` and `Stop` relay to the studio. `PreToolUse` runs the
  same deny policy as Claude Code. The app-server's `hooks/list` reports every hook Codex would load. The studio passes a
  `hooks.state` override that trusts its own hooks by their current hash and sets `enabled=false` on every other hook (the user's
  `hooks.json`, a project `.codex/`, anything planted). A second `hooks/list` with the final args must show no other hook enabled
  and every studio hook trusted, or the launch is refused. Hook trust is never bypassed.
- Usage is read from the session's rollout file. The studio looks in today's and yesterday's date folders first and remembers the
  path per thread.
- `CODEX_HOME` is passed through untouched, because it also holds the sign-in.

OpenCode, 2.2.0 or newer (`opencode.ts`, `opencode-companion.ts`, `opencode-stream.ts`):

- A companion `opencode serve --port 0`, behind a random per-session password. The server picks its own loopback port and prints
  it, and the studio reads that line from the child's stdout. The password is only ever sent to the address the studio's own child
  printed, so no other local process can be handed it. The TUI attaches with `--server` and `--session` only after the check below.
- `OPENCODE_CONFIG_DIR` and `XDG_CONFIG_HOME` both point at the session's own folder, so `~/.config/opencode` (its MCP servers,
  plugins, agents and permissions) is never a config source. `XDG_DATA_HOME` is passed through untouched, because it holds the
  sign-in.
- The studio-written config sets `"*": "deny"`, `studio_*` allowed, `read: "ask"` and `external_directory: "deny"`. It also turns
  off sharing and auto-update.
- `OPENCODE_DISABLE_PROJECT_CONFIG`, `OPENCODE_DISABLE_CLAUDE_CODE` and `OPENCODE_DISABLE_AUTOUPDATE` stop it from loading the
  project's config or `~/.claude` skills.
- Before the TUI starts, the studio reads the resolved config from the server and refuses the launch with `config_conflict` when
  any config source is not the studio's file, an MCP server other than `studio` is configured, an agent allows anything after the
  studio's rules, a plugin is not built in, or OpenCode has saved permission answers.
- Each read is asked, and the studio answers it with the same check Claude Code's `Read` goes through (`decideTerminalTool`,
  lexical and realpath confinement to the project and the studio plugin). An allowed read is answered `once`, never `always`. A
  symlink in the project that points outside it is rejected.
- Events arrive over the server's SSE stream, and the adapter reconnects after a drop. Any other permission request is answered
  with a reject.
- The studio never offers a Claude Pro or Max sign-in in OpenCode. The Setup card says so (see policy-check §12).

## What the adapters cannot enforce

- Codex: `~/.codex/config.toml` still loads, and the studio overrides only the keys it names. The update notice still shows in the
  TUI, and the studio leaves it on.
- Codex: the read-only sandbox limits writes, not reads. Reads outside the project are blocked by the `PreToolUse` policy only.
- Codex: the user's `AGENTS.md` and skills list are still added to the prompt. The tool allowlist check means they can only
  steer the model, not give it a tool.
- Codex: the launch checks start the binary three more times, which adds about 8 to 9 seconds before the TUI appears.
- OpenCode: a managed system config (`/etc/opencode` and its macOS and Windows equivalents) still loads, and the studio cannot
  switch it off. It should show up as a source that is not the studio's and be refused, but that is untested: the test machine
  has none.
- OpenCode has no blocking pre-tool hook. The deny comes from its permission config, the launch check and the studio's replies,
  so a bug in OpenCode's permission engine would get past the studio.
- OpenCode's TUI may show a read request for a moment before the studio answers it. If the person answers it there first, the
  studio's check is skipped for that read. An "always" answer is saved, and the next launch refuses until it is removed.
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
