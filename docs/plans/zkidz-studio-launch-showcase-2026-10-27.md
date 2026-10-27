<!-- Created by The Angelo Umali. -->

# ZKidz Studio launch: README, GitHub pages and a 60–75 s launch film

Saved to the project as `docs/plans/zkidz-studio-launch-showcase-2026-10-27.md` at Phase 1 start (with its `.mmd` sidecar and HTML twin).

## Context

v1 is built and released to `main`. Angelo now wants the project presented to the public:

- the README and every GitHub surface updated, including a showcase of the edits the old repository (zkidz-films) produced;
- a 45–90 s product launch film, made by a team of agents, lively and heavy on motion graphics, demoing the whole platform.

Grill answers (2026-10-27), binding:

| Question         | Answer                                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Showcase         | zkidz-films edits: a cover gallery of the episodes the engine already shipped, plus the studio's own ep 12 edit. Covers get committed                        |
| GitHub pages     | Repo + docs + Pages site: README, docs/user, repo About (description, topics, homepage), social preview image, a new GitHub Pages landing site with the film |
| Narration        | Voice + captions (Gemini voice; a key is set on this machine)                                                                                                |
| Film destination | Local + README/Pages: MP4 in `recordings/`, embedded in the site and linked from the README. No NAS drop                                                     |

Facts checked in exploration:

- Pages is not enabled (`gh api …/pages` → 404). The repo has no topics and no homepage.
- `.gitignore:15` ignores `*.mp4` and `.gitignore:31` ignores every `media/` folder. Committed media therefore goes under `site/assets/` and `docs/assets/`, and the film needs a `!site/assets/*.mp4` negation.
- `scripts/check-attribution.mjs` needs the attribution line in `.html`, `.css`, `.md`, `.svg` and `.yml`.
- Workflows pin actions by SHA and are `workflow_dispatch` only (`golden.yml:1-12`).
- 47 delivered edits are in `zkidz-films/media/deliverables/`, each with `cover-A/B.png`. YouTube channel: `https://www.youtube.com/@theangeloumali`. No per-post URLs are stored, so the gallery links to the channel.
- Machine: RTX 5090 (NVENC h264/hevc/av1); `GEMINI_API_KEY` is set; `demo-recording/scripts/narrate.mjs` and `voices.mjs` exist; the zkidz-films HyperFrames renderer is at `engine/hf/`.
- Rio's launch-film research brief is done (`scratchpad/launch-research.md`, 14 sources). It recommends:
  - 72 s at 120 BPM, nine beats on bar lines, about 130 VO words;
  - the real UI as the hero, one action at a time; each click causes the next change;
  - a hook in the first 3 s (a typed prompt, then the timeline cutting itself), not a logo;
  - sound-off-safe captions, and one consistent visual texture;
  - every number on screen from a real run;
  - end on one action and one address, held 2.5 s or longer.

ASSUMPTIONS (not asked):

- The showcase leaves out edits that show client products or other people: 22, 25, 57, both ClearSpent films, the family vlogs (18, 19, 31–34), and 35. That leaves about 25 eligible covers; the gallery shows 12, and the film's cover wall uses all eligible ones.
- The film is 16:9 1920x1080 at 30 fps, H.264, targeting 60–75 s. No 9:16 cut-down (not asked).
- There is no UI mock-up round for the site. It reuses the studio's own tokens (`apps/web/src/styles/app.css`) and the film's look.
- The film's source (HyperFrames composition, capture specs, VO, music) stays local in the main checkout's git-excluded `recordings/launch/` and `apps/web/e2e-demo/`. Only the finished MP4, poster and teaser are committed, under `site/assets/`.
- Music and SFX are synthesized (zkidz-films `films/` sound synthesis or ffmpeg/WebAudio). No licensed tracks.
- A GitHub issue is filed for this work so the PRs can `Closes #N`.

```ascii
 Phase 1  pre-production ─────────────┐ (rio research → script, beat sheet, shot list, VO lines)
                                      │
           ┌──────────────────────────┼──────────────────────────────┐
           ▼                          ▼                              ▼
 Phase 2  elena (worktree)     Phase 3  lena + jordan (worktrees)  Phase 4  rio: UI captures
   README rewrite + showcase     site/ landing page                   real studio, 2560x1440
   docs/user pass                .github/workflows/pages.yml          ep12 project + live prompt
   docs/assets/showcase/*.jpg    social preview 1280x640                   │
           │                          │                                    ▼
           │                          │                         Phase 5  rio: launch film
           │                          │                           HyperFrames motion pass
           │                          │                           Gemini VO + captions, synth music
           │                          │                           NVENC → recordings/…launch.mp4
           └──────────────┬───────────┴────────────────────────────────────┘
                          ▼
 Phase 6  integrate: film → site/assets, README embed, gates, Maya + Kai review,
          PR → develop (squash) → main (merge), enable Pages, deploy, set About
                          ▼
 Phase 7  close: checklist, site walk-through MP4 (frame-verified), vault, issue closed
```

## Phase ledger

- [ ] Phase 1: pre-production (research brief, script, beat sheet, shot list)
- [ ] Phase 2: README, docs and the zkidz-films showcase
- [ ] Phase 3: GitHub Pages site, deploy workflow, social preview
- [ ] Phase 4: UI captures of the real studio
- [ ] Phase 5: launch film (motion graphics, VO, music, render, frame-verify)
- [ ] Phase 6: integrate, gates, review, PRs, enable and deploy Pages, repo About
- [ ] Phase 7: close

Phases 2, 3 and 4 run in parallel after Phase 1 (disjoint files; at most 3 agents at once because captures and renders share the GPU). Phase 5 needs Phases 1 and 4. Phase 6 needs Phases 2, 3 and 5.

### Phase 1: pre-production (primary, inline)

- Read rio's research brief. Write `recordings/launch/script.md` (local):
  - a beat sheet with timings (60–75 s);
  - VO lines, plain and specific, around 2.5 words/s, no marketing superlatives;
  - on-screen text per beat;
  - a shot list naming the exact studio screen and state for each beat.
- Story spine: hook (raw footage → finished short in seconds), then "drop footage, type what you want", Claude cuts live in the preview and timeline, captions/titles/motion/sound, QC gates, 4K master + Reels + covers, local-first and BYO Claude, the cover wall of real edits, open source, then the CTA `github.com/theangeloumali/zkidz-studio`.
- Facts on screen come only from the repo and the docs (modes A/B/T, backends, QC gates, deliverables). The edit count comes from counting EPISODES.md rows.
- Copy the plan to `docs/plans/` in the worktree, write the `.mmd` sidecar, run `plan-to-html.sh`.

Verify: `test -s recordings/launch/script.md` and the beat timings sum to 45–90 s.

### Phase 2: README, docs, showcase (elena, `isolation: worktree`, ACTION `structured-docs`)

Files owned: `README.md`, `docs/user/*.md`, `docs/assets/showcase/*` (new).

- README:
  - a hero line, a poster image linking to the Pages film (placeholder path `site/assets/launch-poster.jpg`, filled in Phase 6), and an animated teaser (`docs/assets/launch-teaser.webp`);
  - "What it does" as 4–6 concrete bullets, and a "How it works" ASCII diagram (prompt → Claude → studio tools → engine → preview/QC/export);
  - a **Showcase** section: a 4x3 grid of zkidz-films covers (JPG, 480 px wide, ≤ 120 KB each) with titles, a line on the edits the engine already delivered, the studio's own ep 12 edit (master and Reels covers), and a link to the YouTube channel;
  - the existing install, Connect Claude, hardware and docs sections kept, accurate to the code.
- docs/user: a consistency pass (links, the site URL, the showcase mention). No behaviour claims beyond what the code does.
- Every new `.md` file gets the attribution line. Covers come from `zkidz-films/media/deliverables/<NN>/cover-A.png` through ffmpeg scale + JPEG q 4. Each picked cover is checked by eye on one contact sheet for client names or personal details.

Verify: `npx prettier --check README.md docs/user && node scripts/check-attribution.mjs && du -k docs/assets/showcase/*` (all ≤ 120).

### Phase 3: Pages site and workflow (lena: `site/`, ACTION `build-component`; jordan: workflow, ACTION `write-infra-code`; both worktrees)

- lena owns `site/index.html`, `site/styles.css`, `site/assets/*` (except the film files), and `docs/assets/social-preview.png`:
  - a static one-page site: hero with `<video controls playsinline poster>` for `assets/zkidz-studio-launch.mp4`; what it does; how it works; the showcase grid (reusing `docs/assets/showcase/` copied into `site/assets/showcase/`); Connect Claude modes; install commands; links to docs on GitHub; footer with licence and the not-affiliated line;
  - no framework, no external scripts, fonts from Google Fonts only, works at 375 px, dark default with a light toggle, `prefers-reduced-motion` honoured;
  - the social preview (1280x640) is rendered from an HTML card with headless Chrome.
- jordan owns `.github/workflows/pages.yml`: `workflow_dispatch` only; `permissions: pages: write, id-token: write, contents: read`; checkout → `actions/configure-pages` → `actions/upload-pages-artifact` (path `site`) → `actions/deploy-pages`, all pinned by SHA with version comments like `golden.yml`, plus a `concurrency` group.

Verify: lena: `npx prettier --check site && node scripts/check-attribution.mjs`, a local `python3 -m http.server -d site` load in Chrome with 0 console errors at 1440 and 375 px. jordan: `npx --yes @action-validator/cli .github/workflows/pages.yml` (or actionlint) exits 0.

### Phase 4: UI captures (rio, ACTION `hyperframes-engine`)

- Run the studio from the final `develop` build. A new local-only server on a spare port is fine; leave 4317 alone or restart it from the main checkout.
- Playwright specs in the git-excluded `apps/web/e2e-demo/` (reuse `scratchpad/e2e-demo-final/demo-kit.ts` and `playwright.demo.config.ts`). Record at 2560x1440 so 1.5x punch-ins stay sharp, with a visible cursor.
- Shots from the script's shot list:
  - Home drop zone and templates;
  - the ep 12 project's Editor: prompt, Activity feed, live 9:16 preview, timeline, the terminal pane with Claude working on a real short prompt;
  - spec versions;
  - render progress, the QC panel showing passing gates, and the deliverables list with SHA-256;
  - the Connect Claude/setup page; the doctor JSON or the backend table.
- Output: `recordings/launch/captures/*.mp4` (CFR, H.264, NVENC) plus a `shots.json` with each shot's useful in/out times and the element boxes for callouts.

Verify: `ffprobe` each capture (h264, 2560x1440, CFR) and one contact sheet per shot, read once.

### Phase 5: launch film (rio, ACTION `hyperframes-engine`, loads `hyperframes:hyperframes`, `zkidzdevteam:motion-graphics`, `zkidzdevteam:demo-recording`)

- A HyperFrames composition in `recordings/launch/film/`, 1920x1080 at 30 fps. Techniques from the research brief:
  - kinetic type on VO keywords, and 3D-tilted screen panels with parallax;
  - punch-ins and speed ramps on the captures, cursor-focus spotlights, and callouts on the AC element;
  - a timeline "scrub" transition, an animated pipeline diagram, a counter for edits and gates, and the cover-wall fly-through;
  - a brand intro sting and an end card with the repo URL and the `git clone … && ./setup.sh` line.
- VO: per-line Gemini TTS through `narrate.mjs` (the narration answer is recorded), mixed under captions that carry the same words.
- Music: a synthesized 120–128 BPM bed with hits on the cuts, risers before the reveals and whooshes on the transitions. Loudness is normalized to −14 LUFS, with VO ducking.
- Render: frames → NVENC H.264 CQ 18 yuv420p + AAC 192k → `recordings/zkidz-studio-launch.mp4`. Also a poster JPG (best frame) and an 8 s 960 px animated WebP teaser.
- QC:
  - duration 45–90 s; `ffprobe` h264/yuv420p/1920x1080/audio present; loudnorm measured;
  - one frame per beat extracted and read; captions inside the safe area; no frame shows a credential, an email or a client name.

Verify: `ffprobe -v error -show_entries format=duration:stream=codec_name,width,height,pix_fmt recordings/zkidz-studio-launch.mp4` → h264, 1920, 1080, yuv420p, 45 ≤ duration ≤ 90.

### Phase 6: integrate and ship (primary)

- Worktree `.claude/.worktree/launch-showcase` on branch `docs/launch-showcase` from `develop`. Merge the elena/lena/jordan branches in.
- Copy the film, poster and teaser into `site/assets/` and `docs/assets/`. Add `!site/assets/*.mp4` to `.gitignore`. The film must be ≤ 50 MB; if it's over, re-encode at CQ 21.
- README: the poster links to `https://theangeloumali.github.io/zkidz-studio/`, and the teaser WebP sits under the hero.
- Gates:
  - `pnpm -s format:check` on the changed paths and `node scripts/check-attribution.mjs`;
  - a markdown link check (every relative link resolves) and `pnpm -s ci:local`;
  - a local site serve with a Chrome console check at 1440 and 375 px.
- Wave 2 review: Maya (docs accuracy against the code, site a11y) + Kai (the workflow's permissions and pinning; no secrets or personal data in the committed images).
- File the issue. PR → `develop` with `gh pr merge --squash` and a hand-written subject/body (`**Tickets — Closes #N**`, no tool attribution, no video wording in the commit/PR text). Then PR `develop` → `main` with `--merge`.
- Enable Pages (`gh api -X POST repos/theangeloumali/zkidz-studio/pages -f build_type=workflow`), then `gh workflow run pages.yml --ref develop`, wait for the run, and `curl -I` the site and the MP4 (200, `video/mp4`).
- Repo About: `gh repo edit --homepage https://theangeloumali.github.io/zkidz-studio/ --add-topic` with video-editor, ai, claude, claude-code, local-first, open-source, ffmpeg, whisper, shorts, reels.
- The social preview image has no API. I hand Angelo the absolute path and the Settings → Social preview step.

Verify: `curl -sfI https://theangeloumali.github.io/zkidz-studio/ && curl -sfI https://theangeloumali.github.io/zkidz-studio/assets/zkidz-studio-launch.mp4 | grep -i 'video/mp4'`.

### Phase 7: close

- Feature checklist `/mnt/c/Users/Angelo/Desktop/eor-feature-checklists/zkidz-studio-<issue>-review-checklist.md`.
- A site walk-through MP4 of the live Pages site, film playing, scroll to the showcase, at 375 px too, saved to `recordings/zks-launch-site.mp4` and frame-verified.
- Vault learning capture; ticket table; HANDOFF.md updated; the gauge vs last push.

Verify: the checklist has no unresolved rows; `ffprobe` on the walk-through.

## Agents (BUDGET: T3 active=5 total=12)

rio ×3 (research, captures, film), elena, lena, jordan, maya, kai = 8 dispatches, with 4 spare for retries. Sonnet for execution; Opus for the reviews. Every brief carries the STEP 5 fields.

## Estimate

With Claude: about 7 h (research 0.5, docs 1, site 1.5, captures 1, film 2.5, ship 0.5). Without Claude: about 40 h (a motion designer's 60–75 s launch film is 2–3 days alone).
