<!-- Created by The Angelo Umali. -->

# Spike 1: SDK init assertion

**Status: PASS** (init assertion against the machine's own login). **NOT-RUNNABLE**: live runs of mode A (API key) and
mode B (Bedrock/Vertex) need real credentials, which this machine does not have.

## Goal

Plan §6.10 item 8: before a job runs, the server asserts the SDK `system/init` message: only the studio plugin and skills,
no user settings, the expected `apiKeySource`. This spike records what init actually reports with `settingSources: []`, a
local plugin, `maxTurns: 1`, haiku and a one-word prompt.

## Commands

```bash
cd docs/spikes/01-sdk-init
pnpm install --ignore-workspace                # @anthropic-ai/claude-agent-sdk 0.3.308
node probe.mjs login                           # machine login
node probe.mjs login zkidz-studio:spike-hello  # skills option narrowed
node probe.mjs mode-a-dummy-key                # ANTHROPIC_API_KEY=spike-invalid-key
node probe.mjs mode-b-bedrock-no-creds         # CLAUDE_CODE_USE_BEDROCK=1, no AWS creds
node probe.mjs isolated-config-dir             # CLAUDE_CONFIG_DIR = empty temp dir
```

`probe-init.mjs` holds the shared query options: an env allowlist (PATH, HOME, TMPDIR, LANG), `settingSources: []`,
`strictMcpConfig`, `canUseTool` limited to the listed tools, and a 60 s abort. Results are in `results/<variant>.json`.

## Output excerpts

| Variant                 | apiKeySource        | Result                                                                         |
| ----------------------- | ------------------- | ------------------------------------------------------------------------------ |
| login                   | `none`              | `success`, 1 turn, text `ready`                                                |
| login, skills narrowed  | `none`              | `success`; `init.skills` still lists all 20                                    |
| mode-a-dummy-key        | `ANTHROPIC_API_KEY` | `Invalid API key · Fix external API key`                                       |
| mode-b-bedrock-no-creds | `none`              | model `us.anthropic.claude-haiku-4-5-20251001-v1:0`; no reply, aborted at 60 s |
| isolated-config-dir     | `none`              | `Not logged in · Please run /login`                                            |

Login run init (Claude Code 2.1.308):

```text
tools:    [AskUserQuestion, Read, Skill]
mcp_servers: []
plugins:  zkidz-studio@inline, cc-plugin-agents-md@builtin, cc-plugin-telemetry@builtin, cc-plugin-plugin-authoring@builtin
skills:   20 entries: built-ins (deep-research, design, ...) + zkidz-studio:spike-hello
          zkidz-studio:spike-attributed is MISSING from init.skills
```

`plugin/skills/spike-attributed/SKILL.md` puts the attribution comment on line 1, before the `---` frontmatter, and it is
not loaded as a skill. `spike-hello`, with the comment after the frontmatter, loads.

## Decision for the plan

1. **The assertion must exempt `@builtin` plugins.** Three plugins bundled with the Claude Code binary show up even with
   `settingSources: []`, and the Bedrock run drops one of them. Assert "the studio plugin is present and no plugin outside
   `<studio>@inline` + `*@builtin` is present", not an exact list.
2. **Assert required skills are included rather than an exact set.** `init.skills` also lists built-in skills, and the
   `skills` option filters context only; it does not shrink the init list.
3. **`apiKeySource: "none"` cannot tell mode B from the subscription login.** A machine signed in to claude.ai would
   silently bill the subscription in mode B. Modes A and B must set `CLAUDE_CONFIG_DIR` to an app-owned empty directory;
   that run shows the login is no longer visible. Untested on macOS, where the login lives in the keychain.
4. **Mode B needs a startup timeout.** Without credentials the Bedrock run produced no error, it just hung until the abort.
5. **SKILL.md attribution goes after the frontmatter** (FOUND against plan D11 / §6.9 and `check-attribution`).
