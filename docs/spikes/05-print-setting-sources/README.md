<!-- Created by The Angelo Umali. -->

# Spike 5: `claude -p` with `--setting-sources ""` vs `--restricted`

**Status: PASS.** Both flags stop user and project settings and user plugins from loading. Neither one alone reliably
keeps claude.ai connectors out; adding `--strict-mcp-config` or `ENABLE_CLAUDEAI_MCP_SERVERS=false` does.

## Goal

Plan §6.3: print-mode jobs must not pick up the user's settings, plugins, hooks or MCP servers. Which flag does that,
and does `--restricted` still honour an explicit `--settings` file?

## Commands

```bash
bash docs/spikes/05-print-setting-sources/run.sh
```

Each variant runs `claude -p "Reply with one word: ready" --model haiku --max-turns 1 --output-format stream-json
--verbose --tools Read <flags>` from `fixture/project`, twice. The fixture project sets `outputStyle: Explanatory` and
`fixture/flag-settings.json` sets `Learning`, so `init.output_style` shows which settings loaded.
`summarise-init.mjs` keeps only counts, so the user's connector and plugin names stay out of the results.

## Output excerpts (Claude Code 2.1.308, run 1 / run 2)

| Variant                                              | output_style | MCP servers | claude.ai connectors | user plugins | skills |
| ---------------------------------------------------- | ------------ | ----------- | -------------------- | ------------ | ------ |
| default                                              | Explanatory  | 38          | 4                    | 44           | 366    |
| `--setting-sources ""`                               | default      | 4 / 0       | 4 / 0                | 0            | 18     |
| `--restricted`                                       | default      | 0 / 4       | 0 / 4                | 0            | 19     |
| `--restricted --settings flag-settings.json`         | Learning     | 4           | 4                    | 0            | 19     |
| `--restricted --strict-mcp-config --mcp-config {}`   | default      | 0 / 0       | 0 / 0                | 0            | 19     |
| `ENABLE_CLAUDEAI_MCP_SERVERS=false` + `--restricted` | default      | 0 / 0       | 0 / 0                | 0            | 19     |

Every run returned `ready` with `apiKeySource: "none"`. The empty value of `--setting-sources ""` is accepted.

## Decision for the plan

Use `--restricted --strict-mcp-config --mcp-config <studio twin only>` together with
`ENABLE_CLAUDEAI_MCP_SERVERS=false`. Without the last two, the account's claude.ai connectors attach to a job at random
(they appeared in one run and not the next under the same flags). `--restricted` still loads the app's own `--settings`
file, so hooks can be delivered that way (spike 7).
