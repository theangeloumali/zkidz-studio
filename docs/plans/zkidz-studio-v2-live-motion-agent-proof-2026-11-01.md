<!-- Created by The Angelo Umali. -->

# ZKidz Studio: v2 Live Motion in the studio, three agent edits of real footage, faster drop-to-preview (amended 2026-11-03)

Saved to the project as `docs/plans/zkidz-studio-v2-live-motion-agent-proof-2026-11-01.md` at Phase 0, with its `.mmd`
sidecar. The HTML twin is git-ignored.

## Context

Angelo asked: "Have we proven that the open code and Claude can now … implement the correct designs and correct output here? I
haven't seen any video edited by them". The answer, checked on 2026-11-01, is no:

- OpenCode stopped on trip-clip after one question. Its `edits` row `d566a6c1` is still `open`, with no cuts and no render.
- The only finished studio edit is Claude's from Oct 27, made before the edit tracking existed.
- Codex has no edit on his studio.

He chose "Both, proof first" and named the footage:
`C:\Users\Angelo\Desktop\x6 videos\OnePuhunanTrainingSession`, "use the V2 vlog skill".

Validated (read-only, 2026-11-02 repro):

- `node -e` over `themes/zkidz/index.json` vs `packages/shared/schema/cue-sheet.json` → `theme kinds 29 | missing from cue
schema: backdrop, chatCard, frameEscape, headlineStack, lineChart, paperCutout, phoneFrame`. The root cause is the union at
  `packages/shared/src/specs/cues.ts:23-83`. `grep -c depth` on that file gives 0.
- `grep -rln 'matte.py|--layer' packages/engine/zks_engine/render apps/server/src` gives 0 callers. A matte range therefore
  hits `render_final.py:411-415` (`sys.exit … re-run hf/render.js with --layer behind` / `run matte.py`).

Also found (read-only, 2026-11-01):

- **The studio cannot draw the v2 look.** `packages/engine` is an older fork of zkidz-films' engine. It has none of the v2 Live
  Motion work merged in zkidz-films `0dfb317` (#22):
  - the 17 learning kinds in `engine/hf/components/learning/*` (about 2,800 JS lines);
  - learning tokens, the Chakra Petch fonts and `cardclip.py`;
  - rack `focus`, the `lean` zoom, `grade: "learning"`;
  - word captions with pills (`caption_words.py`, `caption_layer.py`);
  - the music bed in `sfx.py`;
  - `v2_qc.py`.
- **Bug found:** the zod cue union (`packages/shared/src/specs/cues.ts:23-83`) accepts only 22 of the 29 kinds the zkidz theme
  draws. `chatCard`, `headlineStack`, `lineChart`, `phoneFrame`, `backdrop`, `paperCutout` and `frameEscape` fail `add_cue`
  (`apps/server/src/tools/handlers/cue-tools.ts:78-92` filters them out of `list_cue_kinds`). No cue can carry
  `depth: "behind"`.
- **Matte is dead in the studio.** The studio never runs `matte.py` or the `--layer behind` pass, so any `matteRanges` makes
  `render_final.py:412-416` exit.
- **The footage:** 3 clips, 43 min, 16 GB, 2160x2160 10-bit HEVC fisheye from a 360 camera: a meeting room with Angelo
  presenting to 4–5 people. Ingest letterboxes a square with 840 px bars (`join_sources.py:81-93`). No crop can fill 9:16 or
  follow the speaker.
- **Ingest timings** (`~/.local/share/zkidz-studio/progress/history.jsonl` and the jobs API):
  - 2:30 1080p H.264: join 50 s, proxy 12 s, then transcription 52 s.
  - 7:48 4K HEVC: ingest 269 s, transcription 763 s.
  - The editor waits for the whole ingest (`apps/web/src/editor/editor-panel.tsx:56-60`), though `streamMedia`
    (`apps/server/src/routes/media-stream.ts:87-101`) already serves the raw file.
  - Audio and proxy re-read the 4K mkv (`cli.py:90-93`).
  - Transcription:
    - runs on whisper.cpp's CPU build (`tools.lock.json:37-68`), 2 workers (`pipeline.py:47`), 6 fixed chunks (`cli.py:108`);
    - reloads the model per chunk;
    - starts only when the agent asks (`job-tools.ts:34-41`).

| Ticket | Status                       | Source link                                              | Conversation                                                                                                                                                                                  |
| ------ | ---------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #38    | planned, Phases 1–4          | https://github.com/theangeloumali/zkidz-studio/issues/38 | "I want you to use this video as a reference and I want you to use the V2 vlog skill"                                                                                                         |
| #39    | planned, Phase 6             | https://github.com/theangeloumali/zkidz-studio/issues/39 | "Have we proven that the open code and Claude can now fucking implement the correct designs and correct output here? I haven't seen any video edited by them with an actual video recording." |
| #40    | planned, Phase 1 (found bug) | https://github.com/theangeloumali/zkidz-studio/issues/40 | "Have we proven that the open code and Claude can now fucking implement the correct designs and correct output here?"                                                                         |
| #41    | planned, Phase 2             | https://github.com/theangeloumali/zkidz-studio/issues/41 | "I want you to use this video as a reference and I want you to use the V2 vlog skill"                                                                                                         |
| #42    | planned, Phase 5             | https://github.com/theangeloumali/zkidz-studio/issues/42 | "when I drag and drop a video on the platform, it's fucking too slow to load the video even if it's just running locally, which is quite weird. I'm not sure what it is processing"           |

Grill answers (binding): "Both, proof first"; footage = the OnePuhunanTrainingSession folder; style = the v2 vlog skill.

ASSUMPTIONS (not asked; the one question round is spent):

- **The footage is the source, not a style reference.** "Use this video as a reference" means: edit this footage. The v2-vlog
  skill is the bar, and the zkidz-films v2 engine is the implementation to port.
- **Phase order is port → speed → edits.** No edit can pass until the port lands. The speed phase cuts the 3× ingest and
  transcription of 43 min of footage (about 70 min of CPU whisper per project today), so it runs before the edits, and the
  edits then prove it on real footage. Angelo still sees the proof first: those videos are the run's headline deliverable.
- **Edit length:** each agent cuts one 3–6 min learning vlog of the session's strongest lessons, at 1080x1920 and 4K. No reel.
- **Framing:** a square or landscape source keeps its letterbox at ingest. The cut spec gains `reframes` windows that crop a
  9:16 slice of the picture band and follow the speaker. There is no fisheye dewarp: the clips are already a flat reframe.
- **"His face"** is the presenter in the reframed frame (the largest face). The face gate and the reframe use the same YuNet
  boxes.
- **The style lands as a theme:** v2 lands as a third theme, `learning`, selectable as a project style. The house theme
  `zkidz` and its edits are unchanged.
- **The demo is silent.** No narration was asked this round, so the demo MP4 records with no voice.
- **NAS:** no NAS drop. The finished edits are review copies on the Desktop until Angelo says go.

## How the team runs

BUDGET: T3, at most 5 active agents and 12 dispatches. Risk 2 (engine render path, agent tool surface), so @maya and @kai
review. Integration branch `feat/v2-live-motion` from `origin/develop`, in the worktree
`.claude/worktrees/v2-live-motion/`. Slices run in their own worktrees and merge locally.

```ascii
 Phase 0  primary: plan + issues + branch + CONTRACTS commit
          zod: 17 learning kinds, depth, word-caption entries, cut spec focus/grade/lean/reframes,
          theme id "learning", JSON schema export; the 7 rejected kinds (Phase 1 fix rides here)
                                   │
   ┌───────────────┬───────────────┼────────────────┬─────────────────┐  Wave 1, parallel worktrees
   ▼               ▼               ▼                ▼                 ▼
 P2a @rio        P2b @ravi       P3 @maya         P4 primary        P5 @ravi (after P2b)
 HF learning     render path:    v2 QC gates      agent surface:    ingest speed:
 kinds, tokens,  cardclip, matte as qc/* modules, tools, v2-vlog    raw-first play, audio
 fonts, theme    + behind layer, YuNet pin,       skill, style      from raw, auto
 pack, build/    focus, lean,    face/density/    picker, Codex/    transcribe, proxy
 render layers,  grade, reframes, variety gates   OpenCode          from raw, GPU whisper
 word captions   music bed                        instructions
   └───────────────┴───────────────┴────────────────┴─────────────────┘
                                   ▼
 Phase 6  primary: three studio projects on the 43-min session, one per agent (Claude, OpenCode, Codex),
          each to export; v2 QC + 2 fps critique; studio fixes → re-run (max 2 per agent)
                                   ▼
 Phase 7  @maya + @kai review → ci:local 9/9 → PR → develop (squash) → main (--merge) → demo MP4 → close
```

## Amendment 2026-11-03: overlapping text, bystander blur, speaker-following camera

Angelo reviewed OpenCode's finished edit (QC passed, 4:01) and found three problems the gates never caught:

1. **Text on text.** Above "WRONG DATA", two gold labels collide: "AI · DATA ENTRY" and "ONEPUHUNAN · AI TRAINING".
   - He said: "there's an overlapping of fucking text … fetch and get the latest V2 skill that we have that is fucking polish
     and I think we can implement it here".
2. **Colleagues on screen and unblurred.** He said: "I think you missed blurring the faces of some of the people here".
3. **The camera rests on the listeners.** He said: "you don't need to focus the camera entirely on them … Mostly it's focused
   on the speaker only most of the time but if it can automatically switch and detect who's speaking, that will be fucking
   awesome".

Validated (2026-11-03, read-only):

- **Overlap.** In OpenCode's `work/cues/v1.json`, cue 0 is a `bigWord` "WRONG DATA" at y 380 with
  `kicker: "ONEPUHUNAN · AI TRAINING"`, and cue 38 is a `chipRail` "AI · DATA ENTRY" at y 190. Both run 1030.46–1032.44 s.
  - `hf/components/learning/words.js:144-149` puts the kicker above the word's top, at about y 190.
  - The QC gate list (`zks_engine/qc/__init__.py:94-111`) has no text-against-text check.
  - zkidz-films' `v2_qc.py` has no such check on any branch either.
- **Stale skill.**
  - The studio's `plugin/skills/v2-vlog/SKILL.md:24,57,60` still tells the agent to put big words behind his head.
  - The latest skill (zkidz-claude-team `f6701a8`, Nov 3, and `e298fd7`) says all text stays fully visible, with no
    behind-head text. It also asks for captions from bottom 1750, a full edit plus a 120–180 s reel, and a music bed by
    default.
  - zkidz-films `d176181`, Nov 3: the density hook ends at the intro insert, the bed level lives in the cut spec, and the
    new `routeMap` kind has labels that clamp inside its box.
- **Privacy and framing.**
  - Blur today means static cut-spec boxes (`zks_engine/blur.py`). The studio's learnings cover only "faces in photos".
    Nothing in v2-vlog or QC covers bystanders.
  - A second without a `reframes` window shows the whole letterboxed 360 room.
  - The presenter is whoever has the largest face (`zks_engine/faces.py:55`), not whoever is speaking.

Grill answers (binding, 2026-11-03):

- Blur: "For this video, one puhunan, they need to be blurred but not every video needs to be blurred. I suggest you
  should ask me if they need to be blurred or not". So the agent asks every time, and OnePuhunan's answer is blur.
- Outputs: a full edit plus a 2–3 min reel, as the latest skill says.
- Re-runs: all three agents run again on the new build.

ASSUMPTIONS (not asked; this turn's one question round is spent):

- **Blurred speakers.** With blur on, every face except the creator's is blurred, even while that person speaks. The camera
  still switches to them, so the viewer sees who is talking.
- **The creator** is the person tracked as speaking the longest in the source. A cut-spec override covers the rare miss.
  As built (Phase 5d): the person most often alone on screen in a whole-source census, since a creator talks to camera
  alone while colleagues come in groups. Speaking time cannot be credited to a face while he talks off camera, as he does for minutes on OnePuhunan. The override was not built: track ids renumber whenever the kept footage changes, so an id would silently
  name someone else. The census picked him on every run; a stable override (a source second where he is alone) waits on
  a real miss.
- **Switches are hard cuts** at the start of a speaker's turn, not pans. The 360 camera is fixed, so a pan would sweep
  across the room.
- **routeMap is ported only if it renders offline** (bundled geography). If it needs network tiles, it is named as not
  ported, with the reason.

| Ticket        | Status                                                                     | Source link                                              | Conversation                                                                                                                                                                                  |
| ------------- | -------------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #38           | Phases 2–5 on `feat/v2-live-motion`; 5b brings the latest v2 rules         | https://github.com/theangeloumali/zkidz-studio/issues/38 | "fetch and get the latest V2 skill that we have that is fucking polish and I think we can implement it here"                                                                                  |
| #43           | planned, Phase 5c                                                          | https://github.com/theangeloumali/zkidz-studio/issues/43 | "See an issue here: there's an overlapping of fucking text."                                                                                                                                  |
| #44           | planned, Phase 5d                                                          | https://github.com/theangeloumali/zkidz-studio/issues/44 | "I think you missed blurring the faces of some of the people here on this output. I just want to know if we set that as a rule or it's not"                                                   |
| #45           | planned, Phase 5d                                                          | https://github.com/theangeloumali/zkidz-studio/issues/45 | "if it can automatically switch and detect who's speaking, that will be fucking awesome"                                                                                                      |
| #39           | Claude + OpenCode exported before these fixes; all three re-run in Phase 6 | https://github.com/theangeloumali/zkidz-studio/issues/39 | "Have we proven that the open code and Claude can now fucking implement the correct designs and correct output here? I haven't seen any video edited by them with an actual video recording." |
| #40, #41, #42 | done on the branch; ship in Phase 7                                        | https://github.com/theangeloumali/zkidz-studio/issues    | "Have we proven that the open code and Claude can now fucking implement the correct designs and correct output here?"                                                                         |

### How the amendment runs

BUDGET: T3. The session is past its dispatch ceiling (about 61 of 60), so Phases 5b–5d run inline on the primary thread. Phase
7 is the one review pair (@maya + @kai). Risk 2: the render path and the agent tool surface. All work goes on
`feat/v2-live-motion` in `.claude/worktrees/v2-live-motion/`, TDD throughout.

```ascii
 Phases 0–5 ✓ (v2 engine, QC, agent surface, ingest speed)
        │
 5b latest v2 rules ──► 5c text never on text ──► 5d camera on the speaker + asked-for blur
   skill sync, no         render_master refuses      speakers.py: face tracks × mouth motion
   behind-head text,      colliding text in secs;    × transcript voice → speaker timeline;
   captions 1750,         qc gate textClear          follow:"speaker" auto-reframes; blurFaces
   full + reel, d176181                              "others" → tracked mask blur; gates
        │                                            framed + facesBlurred
        ▼
 6  re-run Claude, OpenCode, then Codex: full edit + 120–180 s reel each, blur = yes,
    QC + 2 fps critique, Desktop review copies
        ▼
 7  /simplify → Maya + Kai → Codex hook → ci:local 9/9 → PR → develop (squash) → main (--merge) → demo MP4
```

## Phase ledger

- [x] Phase 0: plan in repo, issues, branch, contracts commit
- [x] Phase 1: the 7 drawn-but-rejected kinds become addable (found bug)
- [x] Phase 2: the v2 Live Motion engine in the studio (2a draw, 2b render path)
- [x] Phase 3: v2 QC gates
- [x] Phase 4: agent surface: tools, v2-vlog skill, style picker, Codex/OpenCode instructions
- [x] Phase 5: faster drop-to-preview and GPU transcription (GPU whisper pinned 2026-11-03 on Angelo's "use the GPU": release whisper-cuda-b5454)
- [x] Phase 5b: the latest v2 rules (skill sync, no behind-head text, captions, full + reel, films d176181; routeMap waits on its unmerged films branch)
- [x] Phase 5c: text never overlaps text (render pre-check + QC gate)
- [x] Phase 5d: the camera follows the speaker; other faces blurred when the creator says so
- [x] Phase 5e: map every place (the latest skill's rule 8): routeMap kind, map gate, cut-spec places
- [x] Phase 6: Claude and OpenCode edits (full + reel), judged; Claude's re-render and Codex skipped on Angelo's "Ship now" (2026-11-05)
- [x] Phase 7: review, PRs, release, demo, close (2026-11-05: /simplify, Maya + Kai, Codex 3 turns and ci:local 9/9 done; the PR, release, demo and close run in the same session)

### Phase 0: contracts (primary)

- Copy the plan to `docs/plans/` with its `.mmd` sidecar and run `plan-to-html.sh`. File the five issues.
- Create the worktree and branch. Write the dispatch state (T3, risk 2).
- Contracts commit, which every slice builds on:
  - **`packages/shared/src/specs/cues.ts`:**
    - the 17 learning kinds, with fields copied from zkidz-films `engine/docs/cues-hf.md` 226–541;
    - an optional `depth: "front" | "behind"` on every kind;
    - the 7 drawn kinds' schemas.
  - **`specs/captions.ts`:** `CaptionEntrySchema` gains `pills` and `scale`. The `caption` kind gains `style: "words"`,
    `line`, `pills` and `scale`.
  - **`specs/cut-spec.ts`:**
    - `ZOOM_PRESETS` + `lean`;
    - `focus: [at, end, amount][]`;
    - `grade: "house" | "learning"`;
    - `reframes: {at, end, cx, cy?, scale?}[]` (source seconds, cx/cy 0–1 over the picture band);
    - `music: {style, level}`.
  - **`enums.ts`:** `THEME_IDS` + `learning`.
  - `pnpm --filter @zks/shared schema:export` and the drift test.

Verify: `pnpm -r typecheck` and `pnpm --filter @zks/shared test` pass.

### Phase 1: found bug: drawn kinds the agent cannot add (primary, TDD)

- The 7 schemas from Phase 0 go through `cue-tools.ts`. `list_cue_kinds` returns them. `add_cue` accepts a valid one of each.
- Test first: `apps/server/test/tools/cue-tools.test.ts` adds one of each through `add_cue` (RED today), then GREEN.
- `plugin/skills/style-rules/references/card-tiers.md` is kept in step with `index.json`.

Verify: `pnpm -F @zks/server exec vitest run test/tools` passes. `scripts/tests/plugin-skills.test.mjs` passes.

### Phase 2a: draw the learning kinds (@rio, worktree, TDD)

Port from zkidz-films `0dfb317` `engine/hf`, following the studio's patterns (`hf/kit` paths, no `ZKIDZ_FILMS_DIR`):

- `components/learning/*` (21 files), `learning/tokens.js`, `learning/cover.js`, `intro-shared.js` (nodePop, vectorZ), and
  `springValue` in `fx/springs.js`.
- `ChakraPetch-Bold/SemiBold.ttf` plus the OFL licence into `hf/kit/fonts/`. Per-weight families in `brand/fonts.js`. Chakra
  Petch joins `FACES` in `theme.js`.
- `themes/learning/theme.json`: every learning kind, its tier, purpose and `slots.maxChars`, plus the captions kind.
  `index.json` is regenerated with `zks-engine theme-index`.
- `build.js` / `render.js` / `compose.js` / `captions.js`:
  - the layers `front | behind | captions | above`;
  - `--clips` / `clipPlan` for footage cards;
  - `style: "words"` captions with plates and join fades;
  - `loadCueSheet(work, names)` stays B's signature.
- `sfx.py RECIPES` + `riser`.
- Tests, ported and adapted:
  - films `tests/test_hf_learning*.py` → `hf/test/*.test.js` + engine pytest;
  - the gallery fixture `fixture/cues/hf-gallery.js` renders one still per kind;
  - `theme.test.js` keys = REGISTRY for `learning`.

Verify: the engine `hf` tests and pytest pass. A gallery still per kind is Read and matches the films gallery.

### Phase 2b: render path (@ravi, worktree, TDD)

Port into `zks_engine`, following B's patterns:

- `ffio.ffmpeg_bin()`, encoders from `backends.active()`, errors as `GateFailed`/`SpecError`, steps wired in
  `render/__init__.draw_overlays` and `render_master`.

What it covers:

- **`cardclip.py`:** from `mezz/<v>.mp4`, or `sources/<v>.mkv` for a crop. The encoder comes from the backend profile.
  It runs before frames.
- **Matte:**
  - `matte.py` runs from `draw_overlays` when the cut spec has `matteRanges` or a cue has `depth: "behind"`;
  - `render.js --layer behind` runs too;
  - mask naming `mask/<base>.mkv` (B's) stays.
- **Rack `focus`:** `edl.map_focus`, `render_final.focus_graph` (CUDA path, `boxblur_opencl`), `check_focus`.
- **`lean`:** in `edl.ZOOM_PRESETS` and `render_final.ZOOM_CURVES`.
- **Grade:** `GRADES {house, learning}` replaces the single `GRADE` in `backends/graph.py`; `grade_of(edl)`.
- **`reframes`** (new, not in films): per-window crop of a 9:16 slice of the picture band, scaled to the canvas in the same graph
  as the zooms. Outside a window the letterboxed frame shows. Cut-spec validation refuses windows on a source that already fills
  9:16.
- **Word captions:** `caption_words.py` and `caption_layer.py`; `captions.emit_cues(words=True)`; the caption layer is an
  input in `render_final`.
- **Music bed:**
  - `zks_engine/music_bed.py`, ported from vlog-production's `music_bed.py bed` onto `synth.py`;
  - `sfx.py bed_track`/`bed_for`: 20 dB under the voice, 8 dB duck, 1.5 s tail fade;
  - written to `audio/<v>_bed.wav` from the cut spec's `music`.

Verify:

- Engine pytest passes.
- A 2-min fixture cut with `reframes`, `focus`, `lean`, `grade: learning`, a behind-word, a footage card, word captions and a
  bed renders a 4K master on this machine. Its frames are Read.

### Phase 3: v2 QC gates (@maya, worktree, TDD)

- Split films `v2_qc.py` into `zks_engine/qc/` modules collected by `qc_master`:
  - `density` (hook ≤ 2 s, body ≤ 4 s between visuals);
  - `variety` (≤ 30 % per technique, no run > 3);
  - `faceClear` (overlay alpha ≤ 0.5 % of the presenter's face box);
  - `faceWidth` (reported; a fail is framing and Angelo's call).
- The existing frames, loudness and motion gates cover the rest.
- The gates run when the project theme is `learning`.
- `opencv-python-headless` joins `packages/engine/pyproject.toml`. `yunet.onnx` is pinned by sha in `tools.lock.json` and
  fetched on setup, like the whisper models.
- A read-only `frame_faces` engine command and agent tool samples the proxy at 1 fps and returns presenter face boxes per
  second. The agent uses them to place `reframes` and keep graphics off the face.

Verify: the qc pytest passes, with fixtures for a face covered and a run of 4 of one technique. `pnpm -F @zks/server exec vitest
run test/tools` passes.

### Phase 4: agent surface (primary, TDD)

- **Tools:**
  - `set_cuts` accepts the new cut-spec fields;
  - `set_captions` accepts `pills` / `scale`;
  - `make_caption_phrases` takes `words: true`;
  - `frame_faces`;
  - `set_beat_map` (writes `work/research/beat-map.md`, which the v2 rules require before any cue);
  - `set_project_style` takes `theme: "learning"`.
  - All are registered in `tools/catalog.ts`, with contracts in `packages/shared/src/tools/`.
- **Skill:**
  - `plugin/skills/v2-vlog/SKILL.md` + `references/`: Angelo's 7 rules, the technique menu, the brand, the variety and
    camera bar, "done means", all in studio tool terms;
  - `edit-director` routes to it when the theme is `learning`;
  - the `style-rules`, `cut-spec`, `captions` and `qc-gates` skills gain the new fields.
- **Codex and OpenCode:**
  - `buildAgentInstructions` (`terminal/agents/instructions.ts:13-24`) adds the v2-vlog body when the project theme is
    `learning`;
  - `read_skill` already finds the new folder.
- **Web:**
  - the Style panel lists "v2 Live Motion (learning vlog)";
  - timeline labels for the new kinds;
  - the cut-spec view shows reframe windows.
- **Tests:** tool handlers, the instructions builder per agent, `plugin-skills.test.mjs`, the Style panel.

Verify: the server and web vitest runs pass. On :4327 a scratch project switches to `learning`, and Claude's first tool calls
are `read_skill v2-vlog` → `set_beat_map`.

### Phase 5: faster drop-to-preview (@ravi, worktree, TDD)

- **Raw-first playback:**
  - when the raw is H.264, 8-bit and SDR, `editor-panel.tsx` plays it through `streamMedia` right after the upload and switches
    to the proxy once ingest ends;
  - HEVC, 10-bit and HDR raws still wait for the proxy;
  - the header says "Preparing the full-quality copy…".
- **Engine order (`cli.py` `ingest_payload`):**
  - audio is built from the raw first (16 kHz wav) and published;
  - the proxy is built from the raw in parallel with the join, under the one-heavy-job rule;
  - the 4K join stays for the render.
- **Auto-transcribe:** the server starts `transcribe` as soon as the wav exists (`auto-ingest.ts` → `startTranscribe`), with
  the project's language.
- **Whisper:**
  - one `whisper-cli` process per chunk, with the chunk count set from the duration (about 90 s chunks) instead of a fixed 6;
  - workers from `ZKS_JOBS`;
  - `-bs 1 -bo 1` behind a measured-accuracy check against the current transcript of `trip-clip`.
- **GPU whisper:** build whisper.cpp `1.9.5` with `-DGGML_CUDA=1` on this machine, pinned by sha in `tools.lock.json` as
  `linux-x64-cuda`. `capabilities.py` and `doctor.py` choose it when the CUDA runtime is present, else the CPU build.
  - If the CUDA build fails here, it's a four-leg blocker. Record it, ship the CPU speedups, and carry on.
- Measured before and after on the same two clips (trip-clip and the 7:48 HEVC): time to first frame in the editor, ingest,
  transcription. The numbers go in the PR body.

Verify: server, web and engine tests pass. On :4327 trip-clip plays within 10 s of the upload finishing. The 7:48 clip's
transcription is at least 3× faster than 763 s on the GPU build. If the CPU fallback applies, the measured gain is reported
instead.

### Phase 5b: the latest v2 rules (primary, TDD)

- Copy this amendment into the repo plan and sidecar, and file the three new issues.
- **`plugin/skills/v2-vlog/SKILL.md` and `references/`:** rewrite them from zkidz-claude-team `skills/v2-vlog` at `e298fd7`,
  in studio tool terms:
  - rule 5 "all text fully visible";
  - the technique menu without behind-head words;
  - captions from bottom 1750, clear of the mouth and chin;
  - outputs: a full edit plus a 120–180 s reel through the existing `reel` render target (`render-tools.ts:71`);
  - music by default;
  - the new privacy step: ask whether other people's faces are blurred.

  `cut-spec`, `cues` and `captions` skills drop their behind-head text lines. `plugin-skills.test.mjs` stays green, with no
  private markers.

- **Contracts (`packages/shared/src/specs/cues.ts`):** text-bearing kinds lose `depth: "behind"`. `add_cue` refuses it, and
  the test goes RED first. `depth` stays only where the films kinds use it for non-text. Matte stays for rack `focus`.
- **Captions:** `WORDS_BOTTOM` (`zks_engine/captions.py:31`) and `hf/learning/tokens.js:22` move from 1415 to 1750. The tests
  pin the new line.
- **Films `d176181`, the parts that apply:**
  - the learning density gate's hook window ends at the intro insert (`qc/learning.py`);
  - the bed level is read from the cut spec's `music` in `sfx.py`;
  - `routeMap` and its label clamp come over with their test, if they render offline (see ASSUMPTIONS).

Verify: the shared, server and engine tests pass. A `bigWord` with `depth: "behind"` is refused. A caption still sits at 1750.

### Phase 5c: text never overlaps text (primary, TDD)

- **`hf/render.js --boxes`:** seeks each cue at its settled time and at its entry and exit extremes, then reads
  `getBoundingClientRect` of every text element under the cue's root. It writes `edl/<v>.text.json` as
  `[{id, kind, at, end, boxes}]` on the 1080x1920 grid, in master seconds. Captions come from the `-cc` sheet. This is a DOM
  read, with no pixel readback, so it costs seconds.
- **`zks_engine/qc/text_gates.py` `text_clear_problems`:** any two cues whose spans overlap and whose text boxes intersect
  (8 px margin) fail. The message names both ids, the time and the fix, for example "'hook-topic' chip overlaps
  'hook-wrong-data' kicker at 17:10.5; move one or drop the kicker".
  - The function runs inside `render_master` before any frame is drawn, as `check_focus` does, so the agent hears in
    seconds, not after a 30-min QC.
  - It also runs as the `textClear` gate in `qc_master`, which keeps the record against the master.
- Tests:
  - OpenCode's exact pair (cue 0 + cue 38) fails;
  - the same cues 1 s apart pass;
  - a caption under a bigWord fails;
  - the gate is blocking on learning.
- `qc-gates` and `v2-vlog` skills name the check and its fix.

Verify: the engine pytest and the hf tests pass. OpenCode's own sheet, re-checked on the scratch studio, reports the
1030.46 s collision.

### Phase 5d: the camera follows the speaker; others blurred on request (primary, TDD)

- **`zks_engine/speakers.py`:**
  - reuse `faces.frames` / `faces.detect` on the proxy at 5 fps; `ranked()` keeps YuNet's mouth-corner landmarks;
  - tracks by IoU (the camera is fixed);
  - mouth motion per track: the mean frame difference in the mouth box;
  - voiced spans from the transcript's word times;
  - each voiced span goes to the track with the most mouth motion, with a 2 s minimum hold;
  - the creator is the track with the most speaking time (as built: the census rule above);
  - cached in `work/faces/<v>.speakers.json`, keyed by the proxy's sha.
  - Cost: about 13k YuNet frames for 43 min, a few minutes of CPU.
- **Cut spec (`cut-spec.ts` + `specs/cuts.py`):**
  - `follow: "speaker"`: every kept second without a manual `reframes` window gets an automatic window on the active
    speaker's face (the existing reframe crop graph);
  - `blurFaces: "others" | "none"`;
  - `creator` (an optional track override; not built, see the creator note above).
  - When the source holds more than one person, a render without `blurFaces` refuses with "ask the creator whether other
    people's faces are blurred, then set blurFaces".
- **Blur:** `blurFaces: "others"` writes a mask video of every non-creator face track (padded ellipse, edited timeline) to
  `mask/<v>.faces.mkv`. `render_final` blurs under it with `maskedmerge`, beside the matte mask path. A per-frame expression
  per box would not scale: `blur.py:3` measured 2.6 fps at 18 regions.
- **Gates (learning theme):**
  - `framed`: on a source that does not fill 9:16, every kept second of footage sits inside a reframe window or under a
    full-frame cover, so no full-room shot remains;
  - `facesBlurred`: with `blurFaces: "others"`, YuNet on the master at 2 fps finds no face except the creator's.
- **Agent surface:**
  - the `frame_faces` tool also returns the speaker timeline;
  - the v2-vlog skill's first step asks the blur question (a card for Claude, plain words for OpenCode and Codex);
  - the test driver answers "Blur them" for OnePuhunan.
- Tests:
  - a synthetic two-face clip where the moving mouth wins the span;
  - the minimum hold;
  - the creator is the person most often alone on screen (the census rule);
  - follow fills the gaps between manual reframes;
  - the refusal without `blurFaces`;
  - the mask covers only the non-creator tracks;
  - both new gates, pass and fail.

Verify: the engine and server tests pass. On the scratch studio, OpenCode's project re-rendered with `follow: "speaker"`
and `blurFaces: "others"`. Its 2 fps sheets around 3155 s+ (colleagues' turn) show the speaker framed and every colleague
blurred. Both new gates pass on that master.

### Phase 5e: map every place (primary, TDD)

zkidz-claude-team `ae6712e` (2026-11-03) added rule 8 to v2-vlog, "Map every place": a vlog that leaves home pins each
place it visits on a real map the first time it arrives there. zkidz-films merged the pieces as `1a6508a` (#26), which
lifts the routeMap assumption above.

- Port the `routeMap` learning kind (`hf/components/learning/route-map.js`, `geo/{bake,labels,land,projection}.js`, Natural
  Earth land, public domain), its zod schema, theme entry and gallery still; a full-frame map counts as a cover.
- Port `geo_proof.py` and the map gate as `qc/map_gates.py` (`map`, blocking on FAIL, a WARN passes): places from each
  clip's own GPS (Insta360 track, EXIF, ISO 6709 tags) or the cut spec's new `places`; home is device-local and never
  pinned; the GeoNames gazetteer is optional.
- v2-vlog rule 8, the menu row and the qc-gates row.

Verify: engine, shared and server tests pass; a gallery still of `routeMap` is read; the gate returns WARN (passes) on the
OnePuhunan footage, which carries no proven places.

### Phase 6: the proof: three agent edits (primary)

- The scratch studio runs on :4327 with the new build. Angelo's 4317 is untouched.
- The brief: "Edit this OnePuhunan training session into a v2 Live Motion learning vlog: a full edit and a 2–3 minute reel,
  max creativity." The agent's blur question is answered "Blur them".
- The order is Claude (a fresh project), then OpenCode (a fresh project), then Codex (`ef6274a1…`). One agent runs at a time,
  each to `export_deliverable` for both the full edit and the reel.
- Each edit is judged:
  - the learning gates, including textClear, framed and facesBlurred, PASS;
  - the reel is 120–180 s, with branding;
  - a 2 fps contact-sheet critique of both masters against the latest rules;
  - cost, time and tokens are read from `edits`.
- A studio defect gets a fix with a test and a re-run, at most 2 re-runs per agent. An agent's own weak judgement is
  reported as found, not hidden.
- Review copies go to the Desktop, hash-verified: `/mnt/c/Users/Angelo/Desktop/onepuhunan-v2-{claude,opencode,codex}{,-reel}.mp4`.
- The report `docs/reports/zkidz-studio-agent-edit-proof-2026-11-01.md` (+ sidecar + HTML twin) is rewritten for these
  runs. The first runs' studio-defect table and findings stay.
- No NAS drop: a drop is a post, and these are test edits.

Verify: six exported masters (3 agents × full + reel), each with its QC report read back, and the report written. An agent
that cannot pass is named with the reason.

Closed 2026-11-05 at four masters (Claude and OpenCode, full + reel), every one QC-passed and critiqued. Angelo reviewed
the OpenCode edits and called it ("this is all good for now. Since this is a demo this is all good"), then chose to ship
now: Claude's blur re-render was stopped at 57 % and the Codex run was not started.

### Phase 7: review, ship, close

- `/simplify`, then the dead-code check, then @maya + @kai on the integration diff, then the Codex review hook. Fixes are
  new commits.
- `pnpm -s ci:local` 9/9.
- One PR `feat/v2-live-motion` → `develop` (squash, hand-written body, `**Tickets — Closes #38 #39 #40 #41 #42 #43 #44 #45**`),
  then `develop` → `main` (`--merge`).
- Restart Angelo's studio on 4317 from `main`.
- Demo MP4 (silent, frame-verified) at
  `/mnt/c/Users/Angelo/Desktop/Work/ZKidz/zkidz-studio/recordings/zks-v2-live-motion-agent-proof.mp4`. It shows:
  - the v2 style picked;
  - a clip that plays at once;
  - the agent asking the blur question;
  - the speaker-following crop;
  - the six finished edits.
- Checklists, vault, HANDOFF, gauge.

Verify: both PRs are merged, every issue is closed, ci:local 9/9, and the MP4 is frame-verified.

## Deploy (approval authorizes it)

1. PR `feat/v2-live-motion` → `develop`, squash-merged once review and `ci:local` pass.
2. PR `develop` → `main`, merged with `--merge`.

## Estimate

| Phase                                              | With Claude                                                     | Without Claude |
| -------------------------------------------------- | --------------------------------------------------------------- | -------------- |
| 5b latest v2 rules                                 | 3 h                                                             | 10 h           |
| 5c text never on text                              | 3 h                                                             | 10 h           |
| 5d speaker follow + blur                           | 7 h                                                             | 28 h           |
| 6 three agents × full + reel (mostly machine time) | 14 h                                                            | 30 h           |
| 7 close                                            | 3 h                                                             | 8 h            |
| **Remaining total**                                | **30 h** (about 20 h wall clock, most of it QC and render time) | **86 h**       |

The biggest risks:

- **Speaker detection on fisheye footage**, where faces are small at the frame's edges. The fallback is to hold the last
  speaker, and the framed gate still guarantees no full-room shot.
- **A full edit of a 43-min session** can be long, so each QC round grows with it.
