<!-- Created by The Angelo Umali. -->

# v1.0 policy re-check (plan Phase 8b)

Owner: kai. Pages fetched 2026-10-24 against the plan's own quotes (§6.1, re-fetched 2026-10-22), the mode T launch flags (§6.3) and
the SDK query options (§6.6). It also records the risk row "flags re-checked against the CLI reference before each release (8b)".

## Verdict

| Item                                 | Result                                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Policy text since 2026-10-22         | Unchanged in meaning. Every quote in plan §6.1 still matches word for word. Two sentences the plan does not quote now bear on us (S6, S7).  |
| Anthropic reply                      | None recorded: `docs/legal/anthropic-reply.md` does not exist. Mode T stays opt-in and labelled pending. Nothing is removed before the tag. |
| Requirements (§3)                    | 14 PASS, 3 FIX (applied in this commit), 0 FAIL                                                                                             |
| CLI flags (§4)                       | 23 of 23 flags the code passes are documented as used; 3 deliberately unused flags still documented as the plan assumes                     |
| SDK options, env vars, hook fields   | 19 of 19 query options, 13 of 13 env vars and 4 of 4 hook checks documented                                                                 |
| FOUND, outside this file's ownership | F1 (lena), F2 (Angelo), F3 (marcus). F1 and F3 are fixed on this branch; F2 must close before the tag.                                      |
| Release gate                         | Secure enough to ship modes A and B. Mode T ships opt-in (F1 fixed). Tag v1.0.0 only after F2 is recorded.                                  |

## 1. Sources

| Id  | Page                                                                                                            | Fetched    | Change since 2026-10-22                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------ |
| P1  | Agent SDK overview, https://code.claude.com/docs/en/agent-sdk/overview                                          | 2026-10-24 | None in the login note, branding guidelines or licence section                                                     |
| P2  | Legal and compliance, https://code.claude.com/docs/en/legal-and-compliance                                      | 2026-10-24 | None in the quoted text; the plan's "…" elides an endorsement clause (S7) and the page also has S6                 |
| P3  | Help center, https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan     | 2026-10-24 | None; still headed "Update October 7, 2026"                                                                        |
| P4  | Monthly API credits, https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-and-team-plans | 2026-10-24 | Page shows "Updated this week" with no date                                                                        |
| P5  | CLI reference, https://code.claude.com/docs/en/cli-reference                                                    | 2026-10-24 | Flags used are all present (§4)                                                                                    |
| P6  | Agent SDK TypeScript reference, https://code.claude.com/docs/en/agent-sdk/typescript                            | 2026-10-24 | Options used are all present (§5)                                                                                  |
| P7  | Hooks, https://code.claude.com/docs/en/hooks                                                                    | 2026-10-24 | Fields used are all present (§6)                                                                                   |
| P8  | Environment variables, https://code.claude.com/docs/en/env-vars                                                 | 2026-10-24 | Variables used are all present except `CLOUD_ML_REGION` and `CLAUDE_AGENT_SDK_CLIENT_APP`, documented on P9 and P6 |
| P9  | Google Cloud's Agent Platform, https://code.claude.com/docs/en/google-vertex-ai                                 | 2026-10-24 | Provider renamed from "Vertex AI"; the Claude Code login prompt still says "Google Vertex AI"                      |

## 2. Quotes that bear on the app

| Id  | Page | Quote (verbatim)                                                                                                                                                                                                                                                                                                                                                                  | Bears on                      |
| --- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| S1  | P1   | "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Use the API key authentication methods described in the Quickstart instead."                                                                                                             | Mode T approval request       |
| S2  | P2   | "Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users. Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow." | All modes                     |
| S3  | P2   | "Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code as described under _Can customers offer Claude Code in their products?_ above."                                                                                                                            | Mode T carve-out              |
| S4  | P2   | "**The Claude Code binary must not be modified.** Claude Code must be installed and run as published by Anthropic, and customers may not remove, disable, or restrict any authentication method built into it (including methods that permit signing in with a Claude account or the user's own API key)."                                                                        | Mode T flags                  |
| S5  | P2   | "Unless we've mutually agreed otherwise, preinstalling or running Claude Code in your products or services (e.g. in hosted sandboxes or other agent infrastructure) requires agreeing to our Commercial Terms of Service and complying with the conditions below"                                                                                                                 | Publisher acceptance (F2)     |
| S6  | P2   | "Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the Agent SDK."                                                                                                                                                                                                                                                               | Mode T, not in plan §6.1 (F3) |
| S7  | P2   | "You can accurately say, in plain text, that your product has Claude Code preinstalled or that it runs Claude Code. But you can't use the Claude Code or Anthropic names or logos as part of your own product, feature, or company name, in your own logo, or in a way that suggests Anthropic built, endorses, or is partnered with your product."                               | Naming, endorsement           |
| S8  | P1   | Allowed: "Claude Agent", "Claude" in an "Agents" menu, "{YourAgentName} Powered by Claude". Not permitted: "Claude Code" or "Claude Code Agent"; "Claude Code-branded ASCII art or visual elements that mimic Claude Code". "Your product should maintain its own branding and not appear to be Claude Code or any Anthropic product."                                            | Naming                        |
| S9  | P1   | "Use of the Claude Agent SDK is governed by Anthropic's Commercial Terms of Service, including when you use it to power products and services that you make available to your own customers and end users"                                                                                                                                                                        | Publisher acceptance (F2)     |
| S10 | P3   | "You can still use the Claude Agent SDK, `claude -p`, and third-party apps with your subscription limits."                                                                                                                                                                                                                                                                        | Mode T (user side only)       |
| S11 | P4   | "Everyone with an API key in the linked organization draws from the same balance."                                                                                                                                                                                                                                                                                                | Mode A credits wording        |

## 3. Requirement against behaviour

| #   | Requirement                                            | Our behaviour                                                                                                    | Evidence                                                                                                              | Verdict |
| --- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------- |
| R1  | Developers use API key or cloud auth (S2)              | Mode A sets `ANTHROPIC_API_KEY` in the child env only; mode B sets the provider switch and its listed variables  | `apps/server/src/auth/agent-env.ts:58-63`, `apps/server/src/auth/cloud-config.ts:15-18`                               | PASS    |
| R2  | No Claude.ai login offered in the app (S1, S2)         | No "Sign in with Claude", OAuth, setup-token paste or credential import anywhere in server or web source         | grep of `apps/server/src`, `apps/web/src` for oauth/setup-token/auth status: no code path                             | PASS    |
| R3  | Never collect, store or intermediate credentials (S2)  | Mode T env is checked for credential variables before spawn; the app opens nothing under `~/.claude`             | `apps/server/src/terminal/terminal-env.ts:5`, `apps/server/src/auth/agent-env.ts:64-72`                               | PASS    |
| R4  | Sign-in completes through Anthropic's flow (S2, S3)    | The user types `/login` in Claude Code's own pane; the app never writes into a login prompt                      | `docs/user/claude-access.md:65`, plan §6.3 "Sign-in"                                                                  | PASS    |
| R5  | Binary unmodified, run as published (S4)               | argv-only spawn of the user's resolved `claude`, no shell, no wrapper                                            | `apps/server/src/terminal/pty-host.ts:2`, `apps/server/src/terminal/claude-binary.ts:15`                              | PASS    |
| R6  | No built-in auth method removed or restricted (S4)     | `--disable-slash-commands` and `--bare` are not passed; `--restricted` keeps `/login` (spike 07)                 | `apps/server/src/terminal/launch-args.ts:21-44`                                                                       | PASS    |
| R7  | No paying for, reselling or intermediating usage (S2)  | Each mode bills the user's own key, cloud account or plan; no hosted or shared account; loopback-only server     | `apps/server/src/main.ts:46-47`, `README.md:62-66`                                                                    | PASS    |
| R8  | Ordinary, individual usage of a plan (S6)              | Mode T runs only for the person at the keyboard, at most 2 PTYs, foreign Origin refused                          | plan §6.3 "Transport", `apps/server/src/security/ws-guard.ts`                                                         | PASS    |
| R9  | No "Claude Code" in a product or feature name (S7, S8) | Product is "ZKidz Studio"; the feature is "Terminal mode"; UI says "Use Claude Code in a terminal" in plain text | `apps/web/src/routes/setup.tsx:33`, `TRADEMARKS.md:22-23`                                                             | PASS    |
| R10 | No implied endorsement or partnership (S7, S8)         | README and TRADEMARKS disclaim affiliation; no "official" or "partner" wording about Anthropic in docs or UI     | `README.md:10`, `TRADEMARKS.md:17-18`                                                                                 | PASS    |
| R11 | No Claude or Anthropic logos or Claude Code look (S8)  | No logo or mascot assets; a test fails on `clawd`, logo or mascot files in the overlay kit                       | `packages/engine/hf/test/clean.test.js:9-10`                                                                          | PASS    |
| R12 | Mode T labelled pending while no reply is recorded     | Card badges "Opt-in" and "Pending Anthropic approval"; README and guide say the request is open                  | `apps/web/src/routes/setup.tsx:34`, `apps/web/src/copy/claude.ts:14`, `README.md:66`, `docs/user/claude-access.md:14` | PASS    |
| R13 | Disclosure: usage counts against the user's plan       | Disclosure text matches plan §6.4 word for word                                                                  | `apps/web/src/copy/claude.ts:11-12`                                                                                   | PASS    |
| R14 | Traffic identifies the app (plan §6.4 risk row)        | `CLAUDE_AGENT_SDK_CLIENT_APP=zkidz-studio/<version>`; P6 documents it for the User-Agent header                  | `apps/server/src/auth/agent-env.ts:51`                                                                                | PASS    |
| R15 | Disclosure links the three pages (plan §6.4)           | Hand-off table named the help article in prose, not by URL                                                       | `docs/user/claude-access.md:113`                                                                                      | FIX     |
| R16 | Docs describe the shipped UI accurately                | Guide named "Claude API key" and "Terminal mode" cards; the shipped cards are titled differently                 | `docs/user/claude-access.md:21,25,61,100,110`                                                                         | FIX     |
| R17 | Statements to Anthropic are true                       | Draft email said the UI shows "Powered by Claude" (it does not) and that the disclosure links three pages (F1)   | `docs/legal/drafts/anthropic-terminal-mode-request.md:38-40,54-55`                                                    | FIX     |

## 4. CLI flags (P5)

Mode T is `apps/server/src/terminal/launch-args.ts`; the `-p` fallback is `apps/server/src/agent/print-runner.ts:31-39`. Minimum Claude
Code is 2.1.295, which covers every version floor below.

| Flag                             | Used by     | CLI reference (short quote)                                                                     | Verdict |
| -------------------------------- | ----------- | ----------------------------------------------------------------------------------------------- | ------- |
| `--session-id`                   | T           | "Use a specific session ID for the conversation (must be a valid UUID)"                         | PASS    |
| `--resume`                       | T, -p       | "Resume a specific session by ID or name"                                                       | PASS    |
| `--restricted`                   | T, -p       | "loads only managed settings and `--settings`, refuses `bypassPermissions`"; needs v2.1.248+    | PASS    |
| `--settings`                     | T, -p       | "Path to a settings JSON file or an inline JSON string"; file at most 2 MiB                     | PASS    |
| `--mcp-config`                   | T, -p       | "Load MCP servers from JSON files or strings"                                                   | PASS    |
| `--strict-mcp-config`            | T, -p       | "Only use MCP servers from `--mcp-config`, ignoring all other MCP configurations"               | PASS    |
| `--plugin-dir`                   | T, -p       | "Load a plugin from a directory or `.zip` archive … for this session only"                      | PASS    |
| `--add-dir`                      | T, -p       | "Add additional working directories for Claude to read and edit files"                          | PASS    |
| `--tools`                        | T, -p       | "Restrict which built-in tools Claude can use"                                                  | PASS    |
| `--disallowedTools`              | T, -p       | "Deny rules. A bare tool name removes the matching tools from Claude's context"                 | PASS    |
| `--allowedTools`                 | T           | "Tools that execute without prompting for permission"                                           | PASS    |
| `--permission-mode`              | T, -p       | "Accepts `default`, `acceptEdits`, `plan`, `auto`, `dontAsk`, `bypassPermissions`, or `manual`" | PASS    |
| `--append-system-prompt-file`    | T, -p       | "Load additional system prompt text from a file and append to the default prompt"               | PASS    |
| `--model`                        | T, -p       | "Sets the model for the current session with a model alias … or a model's full name"            | PASS    |
| `-p` / `--print`                 | -p          | "Print response without interactive mode"                                                       | PASS    |
| `--input-format`                 | -p          | "Specify input format for print mode (options: `text`, `stream-json`)"                          | PASS    |
| `--output-format`                | -p          | "Specify output format for print mode (options: `text`, `json`, `stream-json`)"                 | PASS    |
| `--verbose`                      | -p          | "Enable verbose logging, shows full turn-by-turn output"                                        | PASS    |
| `--include-partial-messages`     | -p          | "Requires `--print` and `--output-format stream-json`"                                          | PASS    |
| `--permission-prompt-tool`       | -p          | "Specify an MCP tool to handle permission prompts in non-interactive mode"                      | PASS    |
| `--max-turns`                    | -p          | "Limit the number of agentic turns (print mode only)"                                           | PASS    |
| `--max-budget-usd`               | -p (mode A) | "Stop the run once estimated spend on API calls reaches this amount (print mode only)"          | PASS    |
| `--version`                      | doctor      | "Output the version number" (`apps/server/src/terminal/claude-binary.ts:32`)                    | PASS    |
| `--disable-slash-commands`       | not used    | "Disable all skills and commands for this session": would hide `/login` (S4)                    | PASS    |
| `--bare`                         | not used    | "Claude has access to Bash, file read, and file edit tools"                                     | PASS    |
| `--dangerously-skip-permissions` | not used    | Not passed; `--restricted` refuses `bypassPermissions` anyway                                   | PASS    |

`--max-turns` and `--max-budget-usd` are still print-mode only, so mode T keeps no turn or dollar cap (plan §6.3), as documented.

## 5. SDK query options (P6)

Every option in `apps/server/src/agent/query-options.ts:41-57`, plus `resume` and `abortController` from
`apps/server/src/agent/session.ts:59-63`, is present in the `Options` type: `cwd`, `env`, `settingSources`, `plugins` (`{ type: "local",
path }`), `tools`, `disallowedTools`, `mcpServers`, `strictMcpConfig`, `permissionMode`, `canUseTool`, `hooks`, `includePartialMessages`,
`maxTurns`, `maxBudgetUsd`, `model`, `fallbackModel` ("Accepts a comma-separated list"), `systemPrompt` (preset form with `append` and
`snapshot`, which needs TypeScript SDK v0.3.257+; the plan pins 0.3.308), `resume`, `abortController`. The init message still carries
the required `apiKeySource` field that `apps/server/src/agent/init-assertion.ts:40` checks. Verdict: PASS.

## 6. Environment variables and hook fields (P6–P9)

| Name                                                                                                    | Set at                                                  | Documented on     | Verdict |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------- | ------- |
| `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`                                                                     | `apps/server/src/auth/agent-env.ts:49`                  | P8                | PASS    |
| `ENABLE_CLAUDEAI_MCP_SERVERS=false`                                                                     | `apps/server/src/auth/agent-env.ts:50`                  | P8                | PASS    |
| `CLAUDE_AGENT_SDK_CLIENT_APP`                                                                           | `apps/server/src/auth/agent-env.ts:51`                  | P6 (`env` option) | PASS    |
| `CLAUDE_CONFIG_DIR`, `ANTHROPIC_API_KEY` (mode A)                                                       | `apps/server/src/auth/agent-env.ts:59`                  | P8                | PASS    |
| `CLAUDE_CODE_USE_BEDROCK` / `_VERTEX` / `_FOUNDRY` / `_ANTHROPIC_AWS`                                   | `apps/server/src/auth/cloud-config.ts:15-18`            | P8                | PASS    |
| `ANTHROPIC_VERTEX_PROJECT_ID`, `ANTHROPIC_FOUNDRY_RESOURCE`, `ANTHROPIC_AWS_WORKSPACE_ID`               | `apps/server/src/auth/cloud-config.ts:16-18`            | P8                | PASS    |
| `CLOUD_ML_REGION`                                                                                       | `apps/server/src/auth/cloud-config.ts:16`               | P9                | PASS    |
| Hook `type: "http"`, `url`, `headers`, `allowedEnvVars`, `timeout`                                      | `apps/server/src/terminal/session-files.ts:91`          | P7                | PASS    |
| Hook `onFailure: "block"` ("Requires Claude Code v2.1.295 or later")                                    | `apps/server/src/terminal/session-files.ts:101-102`     | P7                | PASS    |
| SessionStart as `type: "command"` ("Only `type: "command"` and `type: "mcp_tool"` hooks are supported") | `apps/server/src/terminal/session-files.ts:99`          | P7                | PASS    |
| PreToolUse `permissionDecision: "deny"`                                                                 | `apps/server/src/terminal/terminal-sessions.ts:164-165` | P7                | PASS    |

## 7. FIXes applied in this commit

| #   | File                                                               | Change                                                                                                                       |
| --- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| R15 | `docs/user/claude-access.md:113`                                   | Disclosure links name the help article by its URL                                                                            |
| R16 | `docs/user/claude-access.md:19,21,25,61,100,110`                   | Steps and hand-off titles match the shipped cards; mode A credits need a key in the plan's linked Console organization (S11) |
| R17 | `docs/legal/drafts/anthropic-terminal-mode-request.md:38-40,54-55` | Branding sentence describes the real UI text; disclosure-links claim is true now that F1 is fixed                            |

## 8. FOUND (outside this file's ownership)

| #   | Finding                                                                                                                                                                                                                                    | Evidence                                                                                                  | Owner  | Must close before                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------ |
| F1  | The mode T card links only the Consumer Terms. Plan §6.4, the hand-off table and the approval email all promise the legal page, the SDK overview and the help article. Low severity: disclosure completeness, not a security gap.          | `apps/web/src/copy/claude.ts:6`, `apps/web/src/setup/terminal-card.tsx:40`                                | lena   | Fixed on feat/p8-policy: the card links all three      |
| F2  | No record that the publisher accepted the Commercial Terms. S5 and S9 require it; plan §6.1 and §15 put the date in `docs/legal/commercial-terms.md`, which does not exist, and the email keeps its acceptance paragraph as a placeholder. | `docs/legal/` holds only `drafts/`                                                                        | Angelo | Tag v1.0.0                                             |
| F3  | The plan's record has drifted. §6.1 lacks S6 and elides the endorsement clause of S7. D9 says "UI says 'Powered by Claude'", but the UI never shows it; TRADEMARKS.md's "may say" is accurate. Saying less than allowed is compliant.      | `docs/plans/zkidz-studio-platform-plan-2026-10-22.md:132,276-331`, `docs/adr/0005-licence-apache-2.md:17` | marcus | Fixed on feat/p8-policy: D9, ADR 0005 and §6.1 updated |

## 9. Mode T decision for this release

`docs/legal/anthropic-reply.md` does not exist on 2026-10-24, so no "no" is recorded. Mode T stays in v1.0.0 as the third card:
opt-in, behind the disclosure, labelled "Pending Anthropic approval". If a "no" is recorded before the tag, Angelo decides, and ravi and
lena remove the card, PTY host, pane and hooks bridge (plan Phase 8b). Re-run this check, pages and flags both, before every release.
