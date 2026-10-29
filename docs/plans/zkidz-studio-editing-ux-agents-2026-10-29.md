<!-- Created by The Angelo Umali. -->

# ZKidz Studio: non-technical editing UX, edit knowledge, reference styles, Codex and OpenCode

Saved to the project as `docs/plans/zkidz-studio-editing-ux-agents-2026-10-29.md` at Phase 0 (with its `.mmd` sidecar; the HTML
twin is git-ignored).

## Goal (locked)

A non-technical user can edit a video in ZKidz Studio without touching the terminal, on their choice of Claude Code, Codex or
OpenCode, and every finished edit reports its cost, time and tokens and teaches the next one.

The run is done when every item below holds on `main`, with `ci:local` 9/9 and the narrated demo MP4 showing each one:

- the original video plays in the editor before the first edit;
- Claude's questions are answered from Activity (cards, Other, Use Claude's picks), and Claude's text shows there as it writes;
- Claude starts in auto mode, and the terminal expands;
- ingest progress moves (#24);
- a reference video restyles the edit;
- an exported edit shows cost, time and tokens, and its facts reach the next edit's prompt;
- a lesson is saved with one click;
- a Codex edit and an OpenCode edit both run with studio tools only.

Ready to paste (the model cannot type slash commands):

```
/goal All tickets in docs/plans/zkidz-studio-editing-ux-agents-2026-10-29.md are merged to main with ci:local 9/9, and the narrated demo MP4 shows: original video before editing, questions answered in Activity, auto mode, expandable terminal, moving ingest progress, a reference style applied, per-edit cost/time/tokens, a one-click lesson, and a Codex and an OpenCode edit using studio tools only.
```

Validated (2026-10-29, on Angelo's project `vid-20261022-194111-00-006`, server on 127.0.0.1:4317):

- Empty preview: `GET /api/projects/4a98…/specs` → `{"specs":[]}` while `GET …/videos/v1/proxy` → `206 video/mp4`, 977 MB, and the
  media list has `v1 source` (467.968 s). Root cause: `apps/web/src/editor/editor-panel.tsx:53` sets `footageUrl` only when a cuts spec
  exists, and `apps/web/src/editor/preview-player.tsx:160,198` shows "Add a clip" until one does.
- Questions only in the terminal: `apps/server/src/terminal/terminal-sessions.ts:88-100` answers AskUserQuestion's PreToolUse with a
  plain allow (`hook-policy.ts:16`), so the question broker (`apps/server/src/agent/decisions.ts:66`) is never called in mode T and
  Activity shows "AskUserQuestion · Running". The http hooks time out at 30 s (`session-files.ts:15`).
- Spike on the real `claude` 2.1.312 (interactive PTY, `--restricted`, haiku, no keys pressed): a PreToolUse hook held
  AskUserQuestion 40 s (`timeout: 600`), returned `allow` + `updatedInput.answers`, and Claude went on with `ANSWER=Blue`. The
  dialog never showed. Matcher `^(?!AskUserQuestion$)` skipped AskUserQuestion and caught Read. `MessageDisplay` delivered the
  sentence written before the question (`final: true`).
- Manual mode: `launch-args.ts:40-41` passes `--permission-mode default`, which the status bar shows as "⏸ manual mode on".
- #24: `packages/engine/zks_engine/cli.py:84-97` writes no progress record, and `apps/server/src/tools/engine-jobs.ts:121-124` follows none.

## Context

Angelo dogfooded the studio with a 6 GB 4K vertical clip and found it too technical:

- Claude's questions only appear in the terminal.
- The Activity tab shows nothing useful.
- The editor is empty until Claude writes cuts.
- Claude starts in manual mode.
- The terminal can't be enlarged.

He also asked for:

- the cost, time and tokens of every edit, plus a knowledge base that grows with each edit;
- restyling an edit from a reference video;
- Codex and OpenCode as agents.

Two of these reverse earlier decisions in the platform plan:

- §2.2 "No agent backends other than Claude";
- §6.13 "no dollar figure in mode T".

The decisions are recorded in ADR 0007 and `docs/release/policy-check.md` §12. The plan of record itself is not rewritten.

| Ticket   | Status                 | Source link                                              | Conversation                                                                                                                                                                                                         |
| -------- | ---------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #27      | planned, slice A       | https://github.com/theangeloumali/zkidz-studio/issues/27 | "why do we have questions here? also on activity it doesnt show anything here which it should also show the questions and can be answerable in the tab"                                                              |
| #27, #28 | planned, slices A + B  | https://github.com/theangeloumali/zkidz-studio/issues/27 | "Regarding the default mode of Claude on terminal, it should be auto not manual, We should be able to allow the terminal to be expandable"                                                                           |
| #28      | planned, slice B       | https://github.com/theangeloumali/zkidz-studio/issues/28 | "also when starting editing this is too empty shouldn't we load the unedited video here? mostly the users who might be using this are non technical so as much as possible we have a UI if its feasible let me know" |
| #24      | open, planned, slice C | https://github.com/theangeloumali/zkidz-studio/issues/24 | "hey im getting this error right now"                                                                                                                                                                                |
| #29      | planned, slice D       | https://github.com/theangeloumali/zkidz-studio/issues/29 | "also do we already allow changing our theming of editing if the user send a video reference? also I want to add a support on codex and opencode to be used"                                                         |
| #30      | planned, slice E       | https://github.com/theangeloumali/zkidz-studio/issues/30 | "also I want you to make sure we add the total cost, duration for each video editing as much as possible we stretch the knowledge base on each edit"                                                                 |
| #31      | planned, slice F       | https://github.com/theangeloumali/zkidz-studio/issues/31 | "also do we already allow changing our theming of editing if the user send a video reference? also I want to add a support on codex and opencode to be used"                                                         |

Grill answers (binding):

- Questions: cards plus one-click picks.
- #24: include it.
- Mock-up: none.
- Demo video narration: Voice + captions.
- Codex and OpenCode: both, in this plan.
- Reference style: in this plan.
- Cost: both a dollar estimate and time + tokens.
- Learning: edit log plus one-click lessons.
- Local database: local first, as recorded in `~/.claude/state/zkidz-local-db.json`.
- Run by a team in parallel.
- UI: shadcn components (Base UI) for every surface this run builds or touches, themed by the ZKidz tokens
  (Angelo, 2026-10-29: "can you use shadcn for the UI but our branding will still be there").

ASSUMPTIONS (not asked):

- "Auto" is Claude Code's `--permission-mode auto`. When an account can't use it, Claude Code starts in Manual without an error (permission-modes docs). The guard accepts both modes.
- "Expandable" means an Expand button that fills the window with the terminal, plus a Collapse button. Esc stays Claude's key.
- Codex and OpenCode run the user's own installed, signed-in binary, the same model as mode T. The studio never offers a Claude Pro/Max sign-in through OpenCode, which Anthropic prohibits (OpenCode providers docs).
- Codex and OpenCode have no question tool the studio can answer. Their questions arrive as text, and the user replies in the Prompt box.
- One PR: the WHOLE-PR hook holds `gh pr create` until every phase is ticked. Slices merge locally into the integration branch, and that branch goes to `develop` as one PR.

## Changes made during Phase 0

- shadcn 4.22.1 is set up in `apps/web`: `components.json`, `@/` alias, `src/lib/utils.ts` (`cn`, aware of the brand type scale),
  `src/components/ui/*`. Its semantic names are aliases of the brand tokens in `app.css`, and `dark:` follows the studio's
  `data-theme`. The brand `Button` (primary, steel, secondary, quiet) is the one source: `buttonClass()` and `ICON_BUTTON_CLASS`
  derive from it. New UI uses these components.
- The status line has no hook event name. `zks-hook.mjs` wraps it as a `StatusLine` payload on the existing bearer hooks route,
  so no new bearer route is needed. Its cost and duration are session totals, but its tokens cover only the latest call: slice A
  sums tokens from the session transcript at Stop (`source: "claude_transcript"`).
- `set_project_style` runs without a card: the Style panel's Reset undoes it in one click.
- Phase 0 also did the feed mapping for the new events: `usage.reported` is silent, `edit.closed` is a note, `lessons.suggested`
  is the lessons card (`apps/web/src/agent/lessons-card.tsx`, Save → rules route with `sourceQuote`). Slice E no longer owns
  `feed-items.ts`, `activity-feed.tsx` or the lessons card. `formatUsage` is in `apps/web/src/lib/format.ts`.

## How the team runs

BUDGET: T3, at most 5 active agents and 12 dispatches. Risk 3 (permission mode, agent lockdown), so Maya and Kai review.

```ascii
 Phase 0  primary: integration branch feat/editing-ux-agents + contracts commit
          (shared schemas, events, tool contracts, DB schema + migrations, adapter interface)
                                   │  every slice branches from this commit
   ┌──────────┬──────────┬─────────┼──────────┬──────────┬──────────────┐   Wave 1, in parallel
   ▼          ▼          ▼         ▼          ▼          ▼              │   (own worktrees)
 A primary  B @lena    C @ravi   D @ravi    E @ravi    F @ravi          │
 questions  original   ingest    reference  edits,     Codex +          │
 in Activity video,    progress  style      cost/time, OpenCode         │
 auto mode, expand     (#24)     (engine,   tokens,    spikes +         │
 Claude's   terminal             tools,     edit log,  adapters,        │
 text,                           skill)     lessons    setup cards      │
 statusLine                        │                                    │
   │          │          │         ▼ D-UI @lena (after B)               │
   └──────────┴──────────┴─────────┴──────────┴──────────┴──────────────┘
                                   ▼
 Phase 7  primary: merge A→C→B→E→D→F into the integration branch, extract the Claude adapter onto the
          seam, wire Codex + OpenCode into launch, catalog registrations, cross-slice tests, ci:local
                                   ▼
 Phase 8  @maya + @kai review the whole diff → one PR → develop (squash) → main (--merge)
          → narrated demo MP4 → checklists, vault, HANDOFF
```

File ownership in Wave 1 (one owner per file; nobody edits a file outside their slice):

- **Phase 0 (primary):**
  - `packages/shared/src/{events.ts, enums.ts, api/terminal.ts, api/dto.ts, api/routes.ts, tools/*}`
  - `packages/db/schema.ts` and its migrations
  - `apps/server/src/terminal/agents/agent-adapter.ts` (types only)
- **A (primary):**
  - `apps/server/src/terminal/{session-files,terminal-sessions,launch-args,hook-events,hook-policy,routes}.ts`
  - `apps/server/src/agent-services.ts`
  - `apps/server/src/agent/tool-names.ts`
  - `apps/web/src/agent/question-card.tsx`
  - `docs/user/claude-access.md`
- **B (@lena):**
  - `apps/web/src/editor/*`
  - `apps/web/src/terminal/TerminalPane.tsx`
- **C (@ravi):**
  - `packages/engine/zks_engine/{cli,prepare,join_sources}.py` and the engine tests
  - `apps/server/src/tools/engine-jobs.ts`
- **D (@ravi, then @lena for the UI):**
  - `apps/server/src/tools/handlers/{reference-tools,style-tools}.ts` (new)
  - `apps/server/src/tools/project-files.ts`
  - `apps/server/src/tools/handlers/project-tools.ts`
  - `packages/engine/hf/theme.js`
  - `packages/engine/zks_engine/render/*`
  - `plugin/skills/style-rules/*`
  - D-UI: `apps/web/src/routes/editor.tsx`, `apps/web/src/style/*` (new), `apps/web/src/components/drop-zone.tsx`
- **E (@ravi):**
  - `apps/server/src/edits/*` (new)
  - `apps/server/src/jobs/{job-runner,deliverables}.ts`
  - `apps/server/src/rules/rules-prompt.ts`
  - `apps/server/src/tools/handlers/lesson-tools.ts` (new)
  - `apps/server/src/main.ts`
  - `plugin/skills/edit-director/SKILL.md`
  - `apps/web/src/agent/{usage-meter,agent-pane}.tsx`, `apps/web/src/agent/lessons-card.tsx` (new), `apps/web/src/agent/feed-items.ts`
  - `apps/web/src/render/render-finished-banner.tsx`
  - `apps/web/src/components/recent-projects.tsx`
- **F (@ravi):**
  - `apps/server/src/terminal/agents/{codex,opencode}.ts` (new)
  - `apps/server/src/auth/{connection-store,routes}.ts`
  - `apps/web/src/routes/setup.tsx`, `apps/web/src/setup/*`, `apps/web/src/copy/agents.ts` (new)
  - `apps/server/src/doctor/routes.ts`, `packages/cli/src/checks.ts`
  - `docs/adr/0007-agent-backends.md`, `docs/release/policy-check.md`
- **Phase 7 (primary):**
  - `apps/server/src/terminal/{session-launch,pty-host,project-routes,claude-binary}.ts`
  - `apps/server/src/terminal/agents/claude.ts`
  - `apps/server/src/agent/routes.ts`, `apps/web/src/agent/project-agent.tsx`
  - `apps/server/src/tools/catalog.ts` (registers D, E and F's handlers)

Each slice:

- starts with `pnpm install --frozen-lockfile` in its worktree;
- writes its tests first (RED, then GREEN);
- runs its own package tests;
- commits in its worktree.

`ci:local` runs only in Phase 7 and Phase 8, one run at a time on a quiet machine (`/proc/loadavg`), with no commits during the run,
tailed with a Monitor. Verification servers run on `ZKS_PORT=4327 ZKS_PREVIEW_PORT=4328` with a scratch `ZKS_HOME`, so Angelo's 4317
session stays untouched.

## Phase ledger

- [x] Phase 0: plan in repo, tickets, integration branch, contracts commit, slice worktrees
- [x] Phase 1: slice A: Claude's questions answered in Activity, Claude's text in Activity, auto mode, statusLine usage
- [x] Phase 2: slice B: original video in the editor before the first edit, expandable terminal
- [x] Phase 3: slice C: ingest progress (#24)
- [x] Phase 4: slice D: restyle from a reference video
- [x] Phase 5: slice E: per-edit cost, time and tokens, edit log, one-click lessons
- [x] Phase 6: slice F: Codex and OpenCode adapters, lockdown spikes, setup cards
- [x] Phase 7: integration: merge the slices, adapter seam, wiring, ci:local
- [ ] Phase 8: review, one PR to develop, release to main, demo MP4, close

### Phase 0: contracts (primary, before any dispatch)

- Copy this plan into `docs/plans/` with the `.mmd` sidecar and run `plan-to-html.sh`. File one issue per ticket row; #24 exists.
- Create `.claude/.worktree/editing-ux-agents` on `feat/editing-ux-agents` from `origin/develop`.
- Commit the contracts every slice builds against:
  - `packages/shared/src/api/terminal.ts`: the `MessageDisplay` payload (`delta`, `final`, `index`, `message_id`, `turn_id`) and a
    `StatusLine` relay payload; `HookResponseSchema` with optional `updatedInput`.
  - `packages/shared/src/events.ts`: `usage.reported` (`sessionId`, `source`, `costUsd?`, `inputTokens?`, `outputTokens?`,
    `cacheTokens?`, `durationMs?`), `lessons.suggested` (`requestId`, `lessons[]`), `edit.closed` (the totals).
  - `packages/shared/src/enums.ts`: asset kind `reference`; auth modes `codex_terminal` and `opencode_terminal`.
  - `packages/shared/src/api/dto.ts`: `EditSummarySchema`; `ProjectStyleSchema` (theme `zkidz` | `minimal`; token overrides limited to
    the theme's token names, as hex; type roles limited to bundled fonts; caption plate variant; `boil`; SFX level; cut-pace target);
    a per-agent version in `ConnectionSchema`.
  - `packages/shared/src/tools/`: contracts for `sample_reference` (auto), `set_project_style` (review), `suggest_lessons` (auto),
    `read_skill` (auto).
  - `packages/db/schema.ts`:
    - an `edits` table (`id`, `projectId`, `videoId`, `agentKind`, `startedAt`, `finishedAt`, `exportJobId`, `status`, `costUsd`,
      `costSource`, `inputTokens`, `outputTokens`, `cacheTokens`, `turns`, `summary`);
    - `projects.style` (JSON);
    - the `reference` asset kind.
    - The migration runs forward, rollback, forward on the local pglite stack (`pnpm db:test:matrix`).
  - `apps/server/src/terminal/agents/agent-adapter.ts`: the `AgentAdapter` interface (`kind`, `fileNames`, `versionArgs`,
    `minVersion`, `buildArgs`, `writeSessionFiles`, `env`, `eventSource: "hooks" | "sse"`, `mapEvent`, `readiness`, `policy`).
- Create the six slice worktrees from that commit. Write the dispatch state (T3, risk 3). Dispatch B, C, D, E and F in one message.

Verify: `pnpm -r typecheck` and `pnpm db:test:matrix` pass on the contracts commit.

### Phase 1: slice A (primary, inline; TDD)

- `session-files.ts`:
  - Split PreToolUse into two entries:
    - `matcher: "AskUserQuestion"`, timeout `QUESTION_HOOK_TIMEOUT_S = 3600`;
    - `matcher: "^(?!AskUserQuestion$)"`, still 30 s.
  - Both keep `onFailure: "block"`.
  - Add a `MessageDisplay` http hook, timeout 5 s, no block. If the live run shows Claude skips `http` for it, fall back to the
    `zks-hook.mjs` command relay, as SessionStart does.
  - Add a `statusLine` command that relays Claude Code's status JSON (fields checked against the statusline docs first) to the
    bridge and prints "ZKidz Studio · <time> · ≈$<cost>".
- `terminal-sessions.ts`:
  - New dep `askQuestions`, wired to `broker.askQuestions` in `agent-services.ts:113`.
  - For AskUserQuestion, after the policy allows it: wait until the open MessageDisplay batch closes (at most 1 s), so Claude's text
    lands first. Then raise the card and hold the hook.
  - On answers: return `allow` + `updatedInput: { ...tool_input, answers }`.
  - On stop, kill, exit, or the request's abort signal (`c.req.raw.signal`, `routes.ts:61`): cancel the card and return a deny.
  - At timeout − 60 s: cancel the card and return a plain allow, so the terminal dialog appears instead.
  - MessageDisplay: buffer deltas per `message_id`. On `final`, publish one persisted `narration` event. Stop publishes
    `last_assistant_message` only when no MessageDisplay narration came that turn.
  - The statusLine relay publishes `usage.reported` (`source: "claude_statusline"`).
  - The `permission_mode` guard (`:166`) accepts `default` or `auto` and still kills every other mode.
- `launch-args.ts`: `--permission-mode auto`.
- `tool-names.ts`: AskUserQuestion's label becomes "Question for you".
- `question-card.tsx`:
  - An "Other" option with a text field. Its text is sent as the answer.
  - A "Use Claude's picks" button fills every question with the "(Recommended)" option, or the first option when none is labelled,
    then sends.
- Docs: `docs/user/claude-access.md` covers auto mode and answering in Activity.

Tests:

- `terminal-sessions.test.ts`:
  - card → settle → `updatedInput.answers`;
  - Stop → cancel and deny;
  - deadline → plain allow;
  - MessageDisplay → one narration, with no duplicate at Stop;
  - statusLine → `usage.reported`;
  - `auto` accepted, `bypassPermissions` killed.
- `session-files.test.ts`, `launch-args.test.ts`, `hook-events.test.ts`, `apps/web/tests/question-card.test.tsx`.
- An opt-in live test (`ZKS_LIVE_CLAUDE=1`, haiku, auto mode): a card answered through `broker.settle` reaches Claude, and the text
  written before the question arrives first.

Verify:

- `pnpm -F @zks/server exec vitest run test/terminal` and `pnpm -F @zks/web exec vitest run tests/question-card.test.tsx` pass.
- The live test passes on 2.1.312 in auto mode.
- On :4327 the openings appear as text, then the card. Answering in Activity moves Claude on, and the pane shows "⏵⏵ auto mode on".

### Phase 2: slice B (@lena, worktree; TDD; ui-ux-pro-max + impeccable)

- `editor-panel.tsx`: with no cuts spec, read the project's `videoId` (`projectQuery`) and its `source` asset (`mediaQuery`). Then:
  - `footageUrl` = the `streamProxy` route;
  - `spans` = `[{ at: 0, end: durationS }]`;
  - the header reads "Original video · not edited yet".
  - While ingest is running and there's no source yet, show "Preparing your video…".
- `preview-player.tsx`: gate on `footageUrl` and `spans`, not on `cuts`; zooms and blur stay optional.
- `timeline-items.ts`: with no cuts, one full-length "Original" video block. Once cuts exist, the edited view takes over as today.
- `TerminalPane.tsx`:
  - An Expand / Collapse icon button (`aria-pressed`).
  - Expanded, the pane is a fixed full-window layer and the host height goes from `h-96` to `flex-1`. The existing ResizeObserver →
    `fit.fit()` → `connection.resize` path keeps the PTY grid in step.
  - The choice is kept in `localStorage`, wrapped in try/catch.
- Tests:
  - `editor-panel.test.tsx`: the original plays with no specs, the "Preparing" state, edited view once cuts exist.
  - `preview-player.test.tsx`.
  - `terminal-pane.test.tsx`: expand toggles the layer and refits.

Verify: `pnpm -F @zks/web exec vitest run tests/editor-panel.test.tsx tests/preview-player.test.tsx tests/terminal-pane.test.tsx`
passes. On :4327 the clip plays before any prompt with 0 console errors, and the expanded terminal redraws at full size.

### Phase 3: slice C (@ravi, worktree; TDD), closes #24

- `cli.py` `ingest_payload`: wrap the join, audio and proxy steps in `progress.job(video, stage)` records, using the helper
  `join_sources.py:211` uses. `prepare.build_audio` and `build_proxy` report their ffmpeg progress (`-progress pipe:1`, pct from
  `out_time_us` / duration).
- `engine-jobs.ts` `runIngest`: use `followEngineProgress`, as transcribe does at `:88`.
- The engine tests set `ZKS_PROGRESS` to a temp dir, so the CI engine lane stops writing into the real studio progress folder.
- Tests first: an engine pytest (a record appears during the join of a short VFR fixture), and a server test (`runIngest` mirrors
  the records).

Verify: the engine pytest and `pnpm -F @zks/server exec vitest run test/tools` pass. On :4327, ingesting a copy of the 6 GB 4K VFR
clip shows the bar climbing through join, audio and proxy.

### Phase 4: slice D (@ravi, then @lena for the UI; worktree; TDD)

- `sample_reference` handler (`reference-tools.ts`, read-only):
  - a 3×3 contact sheet plus up to 6 frames via ffmpeg, as image blocks, the way `render_preview` returns them;
  - the shot-change rate (`select='gt(scene,0.3)'`), the average shot length, and loudness.
- `set_project_style` handler (`style-tools.ts`): writes `projects.style` after `ProjectStyleSchema` validates it.
- Theme in the render path:
  - `project-files.ts:11-12`: `PROJECT_THEME_ID` becomes the project's theme.
  - `render/__init__.py` and `brand_intro.py` pass `--theme` and the overrides to `hf/theme.js`, which validates and merges them.
    Components still come from the repo only (§7.8).
  - `list_cue_kinds` follows the theme.
- `project_info` lists references apart from clips.
- `style-rules` skill: a "Match a reference" step:
  - call `sample_reference`;
  - map the result onto the theme, tokens, fonts, captions and pace;
  - call `set_project_style`;
  - say what can't be matched: unbundled fonts, colour grade, custom motion.
- Found issue: `references/card-tiers.md` lists 7 kinds that `list_cue_kinds` hides. Drop them from the tiers, or add them to the
  cue schema if the theme draws them.
- D-UI (@lena, after B):
  - a "Style reference" drop slot on the project page;
  - a "Style" section with swatches, fonts, a caption sample and Reset;
  - the `minimal` theme is selectable there.
- Tests:
  - `sample_reference` against a fixture;
  - `set_project_style` rejects unknown tokens and unbundled fonts;
  - `theme.js` merges the overlay, and a `minimal` render differs from the default;
  - the Style panel.

Verify: `pnpm -F @zks/server exec vitest run test/tools`, the engine `hf` tests and the D-UI web tests pass. On :4327, a dropped
reference plus "match this style" calls `sample_reference` then `set_project_style`, and a preview still shows the new look.

### Phase 5: slice E (@ravi, worktree; TDD)

- `apps/server/src/edits/edit-recorder.ts`, subscribed to the event bus in `main.ts`:
  - It opens an edit on the first prompt with no open edit.
  - It folds `usage.reported` and SDK `turn.completed` totals into it: the latest value per session, summed across sessions, never
    across turns (§6.13).
  - It closes the edit when `export_deliverable` succeeds (`job-runner.ts:248`), sets `projects.status = 'delivered'`, writes the
    facts to `edits.summary` (source and kept length, segments, cut reasons, the opening chosen from that edit's answers, cost, time,
    tokens), and publishes `edit.closed`.
- `rules-prompt.ts`: appends an escaped `<studio_edit_history>` block with the last 5 edits.
- `suggest_lessons` handler (`lesson-tools.ts`): publishes a `lessons.suggested` card and writes nothing.
  - `lessons-card.tsx`: Save on each row goes through the existing rules route with `sourceQuote`.
  - `rules-catalog-guard.test.ts` stays green.
  - The `edit-director` skill calls `suggest_lessons` after export.
- Display, in every mode:
  - the agent pane meter: "This edit · 14 min · ≈ $0.62 estimate · 210k tokens", with `COST_DISCLAIMER` and "what you pay depends on
    your plan" for sign-in modes;
  - the totals on the render-finished banner and in the recent-projects list.
- Tests:
  - edit open/close;
  - the roll-up with no double count;
  - the history block, escaped;
  - the lessons Save round trip;
  - the meter, banner and list.

Verify: `pnpm -F @zks/server exec vitest run test/edits test/rules` and the web agent and render tests pass. The local database holds
an `edits` row with totals after a fixture export.

### Phase 6: slice F (@ravi, worktree; spikes gate the adapters)

- Codex spike (0.164.0, PTY, per-session `-c` overrides, `~/.codex` untouched). Prove each of these:
  - the studio MCP server loads;
  - hooks reach a test bridge (`--dangerously-bypass-hook-trust`, scoped to the generated hooks; Kai reviews);
  - shell and `apply_patch` are denied;
  - outside reads are refused (the beta permission profile with `":root"="deny"`);
  - `web_search = "disabled"`;
  - the ChatGPT sign-in is reused;
  - whether rollout `token_count` records give tokens.
- OpenCode spike (2.2.0). Run `opencode serve` (loopback, `OPENCODE_SERVER_PASSWORD`, `OPENCODE_CONFIG_CONTENT`), then `opencode
attach` in the PTY. The config:
  - the studio MCP server;
  - `permission`: `"*": "deny"`; read, grep, glob and list allowed; `external_directory: "deny"`; `studio_*` allowed; `question`
    denied;
  - `OPENCODE_DISABLE_PROJECT_CONFIG=1`.
  - Prove: outside reads are denied; SSE `/event` carries tool parts, messages and cost; permission asks can be answered.
- A spike gap that can't be closed is a four-leg blocker. Record it to `~/.claude/state/blocker-<sid>.json` and ask Angelo whether to
  ship that agent with the gap documented.
- `agents/codex.ts` and `agents/opencode.ts` implement `AgentAdapter`:
  - Codex events come from hooks.
  - OpenCode owns serve + attach; its events come from SSE; its permission asks become approval cards; prompts go through
    `prompt_async`; cost and tokens come from its messages.
  - The edit skills reach both agents as a generated instructions file (from `plugin/skills`, the single source) plus `read_skill`.
- Setup:
  - "Use Codex in a terminal" and "Use OpenCode in a terminal" cards, with connect routes and per-agent version checks in doctor and
    the CLI;
  - the OpenCode copy says the studio never offers a Claude Pro/Max sign-in.
- Docs: ADR 0007 amends §2.2 and §6.13. `policy-check.md` §12 covers auto mode (hook `deny` holds in every mode) and quotes OpenAI's
  sign-in and CLI terms and OpenCode's provider terms.
- Tests: an adapter contract suite per agent; `buildArgs`, session files, `mapEvent`, policy; the setup cards; opt-in live tests
  (`ZKS_LIVE_CODEX=1`, `ZKS_LIVE_OPENCODE=1`).

Verify: `pnpm -F @zks/server exec vitest run test/terminal/agents` and `pnpm -F @zks/web exec vitest run tests/setup-connect.test.tsx`
pass, and both live tests pass on the installed binaries.

### Phase 7: integration (primary)

- Merge A, C, B, E, D and F into `feat/editing-ux-agents` (no rebase, no force).
- Extract `agents/claude.ts` from slice A's code onto the seam. `session-launch.ts`, `pty-host.ts` (one binary path per agent),
  `project-routes.ts` (resume per auth mode) and `agent/routes.ts` + `project-agent.tsx` (prompt routing per PTY agent) take the
  adapter. Every existing Claude terminal test passes unchanged.
- Register D, E and F's handlers in `tools/catalog.ts`.
- Run every slice's tests, then `pnpm -s ci:local` (9/9).
- On :4327, a Codex edit and an OpenCode edit of a short clip each run with studio tools only. A shell or outside-read attempt shows
  as blocked in Activity, and each edit's totals land in `edits`.

Verify: `pnpm -s ci:local` reports 9/9 PASS, and the :4327 runs above succeed with the database rows read back.

### Phase 8: review, ship, close

- `/simplify` on the whole diff, the dead-code check, then one review pair (@maya + @kai) on the integration diff, then the Codex
  review hook. Fixes go in as new commits, and `ci:local` runs again.
- One PR `feat/editing-ux-agents` → `develop`: squash, a hand-written subject and body, `**Tickets — Closes #…**` for every ticket.
  Then a PR `develop` → `main`, merged with `--merge`.
- Restart Angelo's studio from `main` on 4317 and check every goal item on his real project.
- One narrated MP4 (Voice + captions, `demo-recording` §9, one section per ticket), recorded from the `main` build and frame-checked,
  at `/mnt/c/Users/Angelo/Desktop/Work/ZKidz/zkidz-studio/recordings/zks-editing-ux-agents.mp4`. If the narration record has expired
  by then, it records with no voice.
- One checklist per ticket in `~/Desktop/eor-feature-checklists/`, vault capture, HANDOFF updated, gauge.

Verify: both PRs are merged, every issue is closed, the live goal check passes on 4317, and the MP4 is frame-verified.

## Deploy (this plan's approval authorizes it)

1. PR `feat/editing-ux-agents` → `develop`, squash-merged once review and `ci:local` pass.
2. PR `develop` → `main`, merged with `--merge`.
3. If `site/` or the README changes, dispatch `pages.yml` on `develop` and curl it.

## Estimate

Running the slices in parallel cuts wall-clock time to about 20 h. The per-slice estimates add up to about 46 h with Claude and
about 150 h without.

| Phase       | With Claude | Without Claude |
| ----------- | ----------- | -------------- |
| Contracts   | 2 h         | 6 h            |
| A           | 5 h         | 16 h           |
| B           | 3 h         | 8 h            |
| C           | 3 h         | 10 h           |
| D           | 9 h         | 30 h           |
| E           | 6 h         | 22 h           |
| F           | 12 h        | 40 h           |
| Integration | 4 h         | 12 h           |
| Close       | 2 h         | 6 h            |

The Codex and OpenCode lockdown spikes carry the most risk to these numbers.
