<!-- Created by The Angelo Umali. -->

# Mode T: drop the "pending Anthropic approval" label

## Context

Angelo asked why mode T says "pending Anthropic approval" when the app only uses a CLI the user installed and signed in to
themselves. His direction (2026-10-28): "we are only leveraging a cli that the user alreadyh logged in, we are just a frontend that
sees the editing in the platform".

Facts found:

- Anthropic's legal page allows it in so many words: "Nor does it prevent an end user from signing in to the unmodified Claude Code
  binary with their own Claude subscription" (`docs/release/policy-check.md` S3). The label hedged on the SDK overview's "offer
  claude.ai login or rate limits" sentence (S1). The app offers no login and handles no credential.
- The label also claims something false. The README says "We have asked Anthropic for written approval", and
  `docs/user/claude-access.md:55` says "The request is still open". But `docs/legal/drafts/anthropic-terminal-mode-request.md` is
  headed "DRAFT, NOT SENT".
- The launch film shows the badge: at about 72.5 s the Connect Claude capture (S11) has "Opt-in · Pending Anthropic approval" on the
  mode T card.

| Ticket                                 | Status  | Source link                          | Conversation                                                                                                                  |
| -------------------------------------- | ------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| none — needs filing (filed in Phase 1) | planned | this Claude Code session, 2026-10-28 | "why do we have pending anthropic approval? when we are just leveraging claude code terminal?"                                |
| none — needs filing (same issue)       | planned | this Claude Code session, 2026-10-28 | "we are only leveraging a cli that the user alreadyh logged in, we are just a frontend that sees the editing in the platform" |

ASSUMPTIONS (not asked):

- Mode T stays opt-in and keeps its disclosure, which links Anthropic's terms. Only the approval claim goes.
- The unsent draft is deleted; git history keeps it. The platform plan of record (2026-10-22) is history and is not rewritten. The
  decision is recorded in `docs/release/policy-check.md` §11 instead.
- The F2 hold on the v1.0.0 tag (Commercial Terms date) is a separate item. This change doesn't touch it.
- No narration question this turn: the film keeps its existing voiceover, and the site walkthrough stays silent, as before.

```ascii
 Phase 1  app copy (TDD) ──► docs + site ──► gates (ci:local) ── commit
                                                  │
                                                  ▼
 Phase 2  build web+server in the worktree, restart studio on :4317 from it
          re-shoot S11 (shots2.mjs S11-setup) ─► prep.sh ONLY=b9_setup
          ─► HyperFrames render ─► finish.sh ─► web encode ─► site/assets
                                                  │
                                                  ▼
 Phase 3  Maya review ─► PR (squash → develop) ─► develop → main (--merge)
          ─► Pages deploy ─► curl ─► site walkthrough re-recorded ─► close
```

## Phase ledger

- [x] Phase 1: remove the label from the app, README, docs and site; record the decision
- [x] Phase 2: launch film without the badge (S11 re-shot, re-rendered, web copy replaced)
- [x] Phase 3: review, ship, deploy, close

The phases run in order: Phase 2 shoots the UI that Phase 1 builds.

### Phase 1: copy, docs, site (primary, inline)

Worktree `.claude/.worktree/mode-t-label` on branch `docs/mode-t-label` from `develop`; `pnpm install --frozen-lockfile`.

- Test first: `apps/web/tests/setup-connect.test.tsx:59` expects the badge. Change it to expect "Opt-in" on the mode T card and
  `queryByText("Pending Anthropic approval")` to be null. Run it and see it go RED.
- `apps/web/src/routes/setup.tsx:34`: badges become `["Opt-in"]`, and the import goes. Then `apps/web/src/copy/claude.ts:16`:
  delete `TERMINAL_PENDING_LABEL` (no other users, per grep). GREEN.
- `README.md:141`: the mode T row label becomes "Opt-in". Lines 148–149: replace the approval sentence with the carve-out in plain
  words: "Anthropic's terms allow you to sign in to your own, unmodified Claude Code with your own subscription; that is all mode T
  does."
- `docs/user/claude-access.md:14` (table), `:54-55` (the paragraph, reworded the same way) and `:111` (`modeT.badge` → "Opt-in").
- `site/index.html:455`: the chip becomes "Opt-in". This is HTML only, not the inline script, so the CSP hash test is unaffected.
- Delete `docs/legal/drafts/anthropic-terminal-mode-request.md` (the only file in `drafts/`).
- `docs/release/policy-check.md`: the Verdict "Anthropic reply" row points to the new §11. §11 "Owner decision (2026-10-28)" gets
  Angelo's quote, S3 as the basis, the label removed, the draft deleted unsent, and R12/R17 superseded.
- Humanizer pass on the changed prose; prettier on every changed file; `node scripts/check-attribution.mjs`.

Verify: `pnpm -F @zks/web exec vitest run tests/setup-connect.test.tsx` passes, and
`grep -rni "pending anthropic\|anthropic approval\|written approval" README.md docs/user site apps/web/src` prints nothing.

### Phase 2: launch film (primary, inline, loads `hyperframes:hyperframes`)

- Build web and server in the worktree. Stop the p7-squash server (background task b42pv29jy) and start the server from the
  worktree on 127.0.0.1:4317, same data dir, so the ep 12 project and connection state stay.
- Re-shoot S11: `node apps/web/e2e-demo/shots2.mjs S11-setup` (copy the git-excluded `e2e-demo/` from the main checkout into the
  worktree, or run it from the main checkout against :4317; it writes `recordings/launch/captures/S11-setup.mp4` in the main
  checkout). Check one contact sheet: the mode T card shows only "Opt-in".
- `ONLY=b9_setup bash recordings/launch/film/prep.sh`, then the HyperFrames render to `film/out/picture.mp4` (same command as
  `render.log`, about 8 min), then `bash recordings/launch/film/finish.sh` (master, poster, teaser, QC numbers).
- Web encode: NVENC VBR 4 Mbps, as before, to `recordings/launch/zkidz-studio-launch-web.mp4`, then copy it to the worktree's
  `site/assets/zkidz-studio-launch.mp4`. Poster and teaser are unchanged (76.5 s and 0–5.6 s / 74–76.8 s), so they are copied only
  if their bytes differ.

Verify: `ffprobe` says h264, yuv420p, 1920x1080, duration 80.0 on the master and the web copy; the frame at 72.5 s shows no
"Pending" text; loudness within ±0.5 of −14 LUFS (finish.sh's qc.py); web copy under 50 MB.

### Phase 3: review, ship, close

- `pnpm -s ci:local` (9/9). Maya reviews the diff for accuracy against Anthropic's quoted text and the code (risk 1, Maya only).
- `/simplify` and dead-code check on the diff (the one export removed is the only code change).
- File the issue, then PR → `develop` (`gh pr merge --squash`, hand-written subject/body, `**Tickets — Closes #N**`, no tool or
  video wording), then PR `develop` → `main` (`--merge`).
- `gh workflow run pages.yml --ref develop`, wait, then `curl` the site (200, chip reads "Opt-in") and the MP4 (200, `video/mp4`,
  new byte count).
- Re-record the site walkthrough (scratchpad `sitewalk/walk.mjs`) to `recordings/zks-launch-site.mp4`, frame-checked. Restart
  the studio server from the main checkout after it pulls develop, then remove the worktree.
- Checklist `/mnt/c/Users/Angelo/Desktop/eor-feature-checklists/zkidz-studio-<issue>-review-checklist.md`; vault capture;
  HANDOFF.md updated (mode T label gone; F2 still holds the tag); gauge.

Verify: the live page and the README on main contain no "pending Anthropic approval"; both PRs merged; the issue is closed.

## Deploy (this plan's approval authorizes it)

1. Squash-merge the PR into `develop`.
2. PR `develop` → `main`, merged with `--merge`.
3. Dispatch `pages.yml` on `develop` and curl the site and film.

## Estimate

With Claude: about 1.5 h (copy and docs 0.3, film re-shoot and render 0.6, ship and walkthrough 0.6). Without Claude: about 5 h.
