<!-- Created by The Angelo Umali. -->

# Spike 7: interactive claude under node-pty

**Status: PASS** on Linux/WSL with one change to the plan: SessionStart does not accept `http` hooks.
**NOT-RUNNABLE** here: Windows ConPTY (native Windows) and macOS. Re-run this spike on both before Phase 3.

## Goal

Plan §6.3 terminal mode: the app runs the user's own interactive `claude` in a PTY with `--restricted`, a `--settings`
file of HTTP hooks pointing at the app's hook bridge (PreToolUse with `onFailure: "block"`), and the studio MCP twin via
`--mcp-config` + `--strict-mcp-config`. Questions:

- Does the session start signed in?
- Do the hooks reach the bridge with their bearer token?
- Does a deny take effect, and does a dead bridge block tools?
- Is `/login` reachable?

## Commands

```bash
cd docs/spikes/07-terminal-mode
pnpm install                        # node-pty 1.1.0 (built by node-gyp; allowBuilds in pnpm-workspace.yaml),
                                    # @xterm/headless 6.0.0, @modelcontextprotocol/sdk 1.32.1
node harness.mjs signed-in
node harness.mjs signed-out         # CLAUDE_CONFIG_DIR = empty temp dir; observes only
```

`harness.mjs` does the following:

- starts a hook bridge stand-in on `127.0.0.1:<random>`; it checks `Authorization: Bearer $ZKS_HOOK_TOKEN` and denies `Read`;
- writes settings with `http` hooks for SessionStart, UserPromptSubmit, PreToolUse (`onFailure: "block"`), PostToolUse, Stop and Notification;
- adds a SessionStart `command` hook (`session-start-relay.mjs`) that forwards to the same bridge;
- registers `stub-mcp.mjs` as the `studio` stdio server;
- spawns `claude --restricted --settings ... --mcp-config ... --strict-mcp-config --tools Read --allowedTools mcp__studio__ping --model haiku` with an env allowlist, and renders the PTY through `@xterm/headless`.

The harness types `/login` without pressing Enter, then clears it. It never runs `/login` or `/logout`, and kills the PTY
at the end. Results: `results/signed-in.json` and `results/signed-out.json` (screens redacted).

## Output excerpts

```text
Accessing workspace: <run>/project ... ❯ No, exit / Yes, I trust this folder    # trust dialog, default "No, exit"
Claude Code v2.1.308 · Haiku 5.5 · <subscription plan>                          # signed in, no login screen
  ❯ /login     Sign in with your Anthropic account                              # "/login" typed, listed
hook events (ms after spawn, all authorized):
  SessionStart      via node relay   source=startup   3196
  UserPromptSubmit  via http                          9441
  PreToolUse Read   via http  -> deny "spike policy denies Read"  11738
  PreToolUse mcp__studio__ping  13095    PostToolUse mcp__studio__ping  13142    Stop  15389
mcp stub: started 10616 (token env present), ping 13119
bridge stopped, then "call ping":
  ⎿ UserPromptSubmit hook error  connect ECONNREFUSED          # default onFailure: continue
  "The ping was blocked before it ran: a PreToolUse hook ... failed with connect ECONNREFUSED,
   and the hook is set to block on failure."                   pings while bridge down: 0
signed-out: "Let's get started. Choose the text style ..."     # onboarding; no hooks fire, MCP never starts
```

In the first runs SessionStart never arrived, because only the `http` hook was configured. The hooks reference says
"SessionStart ... Only `type: "command"` and `type: "mcp_tool"` hooks are supported". An `http` SessionStart hook is
skipped with no error.

## Decision for the plan

1. **SessionStart (and Setup) need a `command` hook** that relays to the bridge. Use a small Node relay shipped with the
   app (as here, about 3 s after spawn). Every other event can stay `http`.
2. **`onFailure: "block"` on PreToolUse works**: with the bridge down, no tool ran. Set `onFailure: "block"` on
   UserPromptSubmit too, or a dead bridge silently loses prompt auditing.
3. **The folder-trust dialog appears on every new project directory, and its default is "No, exit".** The PTY view must
   show it to the user. The app must never auto-answer it with Enter, which exits.
4. **A signed-out user lands in Claude Code's onboarding and sign-in screens,** with no hooks and no MCP. The app
   detects "no SessionStart within N s" and hands the terminal to the user. `/login` is available from the slash menu
   once signed in.
5. The hook token reaches header interpolation via `allowedEnvVars`, and the MCP twin receives its token through env.
