<!-- Created by The Angelo Umali. -->

# ZKidz Studio: three agents edit the OnePuhunan training session (agent edit proof)

Plan: `docs/plans/zkidz-studio-v2-live-motion-agent-proof-2026-11-01.md`, Phase 6. Issue #39.

## The test

- **Footage:** `C:\Users\Angelo\Desktop\x6 videos\OnePuhunanTrainingSession`. Three clips (514 + 1200 + 871 s), about 43 min
  in all. They are 2160x2160 10-bit HEVC from a 360 camera, added to each project in place (no copy).
- **Studio:** the `feat/v2-live-motion` build on a scratch studio (port 4327, its own `ZKS_HOME`). The theme is
  `learning` (v2 Live Motion).
- **Brief, the same for each agent:** "Edit this OnePuhunan training session into a v2 Live Motion learning vlog, 3–6
  minutes, max creativity."
- **Driver:** a local script answers every question with the agent's recommended option (as "Use Claude's picks"
  would), approves every gate, and tells an idle agent when one of its jobs has finished.
- **Bar:** the `learning` QC gates pass, the edit exports, and a 2 fps contact-sheet critique finds nothing left to fix.

## How the runs went

```ascii
 agent edits ──► render_master ──► qc_master ──► fails? ──► agent fixes ──► …
                      │                │
                      │                └─ studio defect? ──► fixed in the studio with a test,
                      │                                      agent resumes on the new build
                      └─ studio defect? ──► same
```

### Claude Code, run 2 (2026-11-03/04, the latest rules): both exported, QC passed, critique "close"

The re-run on the Phase 5b–5d build: the same brief plus a reel, with "Blur them" as the answer to the blur question.

**These copies carry the weak blur** (`7a62ca2`): Angelo read colleagues' faces through it at 4:10 and 4:45. The
re-render on the fixed build was stopped at 57 % when Angelo chose to ship (2026-11-05), so these copies stay as they
are. The fixed build redraws the masks on any re-render of this project.

| Output    | Length | Review copy (H.264 + AAC, 1080x1920, byte-identical to the deliverable) |
| --------- | ------ | ----------------------------------------------------------------------- |
| Full edit | 7:15   | `/mnt/c/Users/Angelo/Desktop/onepuhunan-v2-claude.mp4`                  |
| Reel      | 2:53   | `/mnt/c/Users/Angelo/Desktop/onepuhunan-v2-claude-reel.mp4`             |

- **QC, both masters:** every blocking gate passes: frames, loudness, motion, hookMouth, lipSync, density (hook 1.6 s, body
  3.7 s on both), variety (full 158 beats, 15 techniques, top `zoom:lean` 28%; reel 70 beats, 14 techniques), faceClear
  (worst 0.0000), textClear, framed, facesBlurred and cutWords. captionContrast and faceWidth are reported only.
- **Cost:** $66.49 over two edit sessions (43 + 12 turns), 323,989 output tokens. Wall clock 20 h from first prompt to
  the full edit's export, most of it render and QC rounds while the studio fixes below landed.
- **What stopped it, in order:** the reel's QC failed his own turned face as a colleague's (`486c982`), then faceClear
  read a colleague's frosted face as his (`0e18bfe`), then 10+ rounds of words clipped at cuts (`f9e5a00`, `0a13242`).
  The last round failed only 'kasi' at 1:41; the pad fix cleared it.

**Critique of the full edit (2 fps, 22 sheets): close, not at the bar.**

- **Strong:** the open shrinks his footage into the paper card on "How long did it take you to build?", the brand intro
  lands after "4 to 5 hours", and "4–5 HRS" sits above his raised arms. The typed prompt "Did you verify, validate and
  critique it?" is his own line. The count to 300 lands on "300 users", "MODERATOR" rolls to "BOSS", "6%" and "3%" are
  his own usage figures. Every colleague is frosted on every sheet, and the camera follows him while he is in the room.
- **Fixed in the studio after this critique:** stepBars drew its labels in paper ink over footage, so "FASTER" vanished
  into the dark monitor at 1:16 (`89f960e`).
- **Agent judgement, reported as found:**
  - Five paper explainers (0:54, 1:55, 3:46, 5:19, 6:11; 8–20 s each) are small `listRows` beside a small card of him.
    The rows are too small to read on a phone (rule 3).
  - From 4:03 to the end (3:12, 44% of the edit) the camera is on two frosted colleagues while he speaks off camera.
    The source has him out of shot from about 3155 s, so only a shorter cut would fix it.
  - White captions over the bright ceiling (4:04–4:12) are hard to read; captionContrast reports it.
  - It ends on "Okay, all of that." with no outro or loop card. The reel ends the same way.
- **The reel:** the same strengths, plus the opening flicker fixed by `6ada9a0` after its export. 2:08–2:52 is the
  colleagues' side of the room.

### OpenCode, run 2 (2026-11-04/05, the latest rules): both exported, QC passed, critique "not at the bar"

The same brief and blur answer as Claude's run 2, on a fresh project.

| Output    | Length | Review copy (H.264 + AAC, 1080x1920, byte-identical to the deliverable) |
| --------- | ------ | ----------------------------------------------------------------------- |
| Full edit | 12:33  | `/mnt/c/Users/Angelo/Desktop/onepuhunan-v2-opencode.mp4`                |
| Reel      | 2:56   | `/mnt/c/Users/Angelo/Desktop/onepuhunan-v2-opencode-reel.mp4`           |

- **QC, reel:** every blocking gate passes, facesBlurred and framed included (density hook 2.0 s, body 3.8 s; variety
  34 beats, 13 techniques, top `listRows` 21%). captionContrast (1.9:1, white captions over the pale table) and
  faceWidth (0.273) are reported only.
- **QC, full edit:** every blocking gate passes (density hook 2.0 s, body 4.0 s; variety 110 beats, 16 techniques, top
  `listRows` 20%; faceClear worst 0.0000; textClear, framed, facesBlurred, cutWords). captionContrast (1.9:1) and
  faceWidth (0.314) are reported only. Four rounds to get there, each the agent's to fix:
  - facesBlurred at 12:22: a colleague turned away at the crop's left edge was never found by the face scan, and her ear
    and cheek showed. OpenCode widened its own blur box.
  - Two density pre-checks (5.25 s at 8:24, then 4.32 s at 0:49) refused the render in seconds, before any frame.
  - cutWords at 0:23 ("pinakauna" heard twice) and 0:52 ("dun" clipped).
- **Usage:** 1.27M input and 187k output tokens (214M cached) over two edit sessions. OpenCode reports $0: its provider
  bills by subscription. Wall clock about 22 h from first prompt to the full edit's export (18 h to the reel, 3.9 h for
  the full edit's last rounds). Most of it was render and QC rounds while the blur fixes below landed, plus about 3 h of
  driver go-aheads while it was blocked (below).

**Critique of the reel (2 fps, 9 sheets): not at the bar.**

- **Strong:** the open on "You don't have Git. You need to install Git first", with chips that build as he names each
  step. The prompt he dictates types into a chat box ("Na-verify? Na-validate? Na-critic?") and the terminal types
  "Make sure it's installed". A rack focus drops the room behind him on "give it context", and "LAHAT" lands on
  "everything". Every colleague is blurred on every sheet.
- **Agent judgement, reported as found:**
  - Four paper explainers (Chromium, HR branch, plan mode, the screenshots flow; 6–10 s each) are 32 px `listRows`
    beside a small card of him, on a mostly empty page. OpenCode set that size; the default is twice it (rule 3).
  - It added a static blur box across the bottom third for the colleagues' side of the room. The box frosts the table
    under the captions, and over the last 20 s it covers almost half the frame.
  - The last 50 s are the colleagues' side and the ceiling, ending on "IT WORKS" over the frosted room.

**Critique of the full edit (2 fps, 24 sheets): not at the bar.**

- **Strong:** the same open, the brand intro at 0:11 after "Git Bash for Windows", "SSH" struck on "it errored because
  there's no SSH", the gauge needle swinging to HIGH on "costly", "MODERATOR" rolling to "OVERSEE AI" and "THE BOSS",
  and the receipt counting "86 held, 2 already exist, rejected" at 11:46. Every colleague is blurred on every sheet.
- **The camera rests on one colleague while he talks (6:56–8:20).** He speaks from behind the camera there (source
  1878–1962 s; the 360 view at those times holds only the four colleagues). With no on-screen speaker, the follow kept
  the colleague whose hand stays at her mouth: her lip motion reads 0.25–0.50 against the 0.25 floor. Claude's run 2
  has the same stretch. See Known limits.
- **Agent judgement, reported as found:**
  - The same 32 px `listRows` explainers and bottom-third blur box as the reel; captions sit on the frosted band from
    6:56 to the end.
  - The last 15 s (12:17–12:33) are the ceiling over a frosted band, ending on "IT WORKS".

### Claude Code, run 1 (claude-opus-5-5, before Phases 5b–5d): exported, QC passed, critique "no"

- **Result:** a 5:52.7 learning vlog that passes every blocking QC gate and exported on 2026-11-02 at 21:32 UTC.
  - Review copy: `/mnt/c/Users/Angelo/Desktop/onepuhunan-v2-claude.mp4` (1080x1920, H.264 + AAC, byte-identical to
    the studio's deliverable).
  - Final QC: frames, loudness, motion, cutWords, hookMouth, lipSync, density (hook 1.8 s, body 3.9 s) and variety
    (63 beats, 13 techniques, top 25%) pass. faceClear passes (worst 0.0000), and faceWidth is 0.206 of the width.
    captionContrast is reported only.
- **Cost:** $64.71 of Claude usage (the studio's count), 389,877 output tokens.
- **Rounds:** 11 renders. Studio defects blocked the first three. The rest fixed the edit's own failures: pacing gaps,
  then words clipped at cuts.
- **Two cut edges needed a human ear.** At two cuts the transcript's word times were off: 'so' was stamped 30 ms long,
  and 'pero' sat in near-silent room audio. Claude cannot listen, and `check_window` judges by those same times, so it
  tried five out-points before it chose a real silence earlier. That dropped the "Like Netflix" row.

| Round | Render | QC failures (blocking)                                                                  |
| ----- | ------ | --------------------------------------------------------------------------------------- |
| 1     | failed | none reached: "Argument list too long" at the final ffmpeg step                         |
| 2     | 5:30   | cutWords 112, density (hook 2.7 s, body 21.5 s), captionContrast 964                    |
| 3     | 5:56   | cutWords 62, density (hook 2.6 s, body 14.8 s)                                          |
| 4     | 5:55   | cutWords 15, density (body 14.3 s)                                                      |
| 5     | 5:55   | cutWords 10, density (body 11.9 s)                                                      |
| 6     | 5:55   | cutWords 3, density (body 7.6 s)                                                        |
| 7–10  | 5:55   | cutWords 1–3, at the same two edges ('so' at 184 s, 'pero' and its neighbours at 209 s) |
| 11    | 5:52   | none: exported                                                                          |

**Critique (2 fps, by @rio, against the v2-vlog bar): no.** The first two minutes are close to the bar.

- **Strong:** the brand intro lands on a pause, and the EVERYTHING drop lands on his laugh. "4–5 HOURS" carries a rack
  focus. The typed prompts quote his own words. The list rows build as he says each item.
- **Rule 3, empty paper:** two paper scenes (19 s at 0:55, 33 s at 3:57) are small lists on cream that are too small to
  read on a phone.
- **Rule 5, text over text:** chips sit on top of big words (0:07, 0:48, 3:10, 3:35).
- **Rule 6, invented visuals:** "no git yet" is not his terminal. A strike through $200 implies money lost, which he
  never says.
- **Rule 7:** the flowSteps "unlock" card draws a padlock and blocks. That is the engine kind as ported from zkidz-films,
  where it is on the technique menu, so it is a v2 design question, not a port defect.
- **Camera:** stretches with no move (0:12–0:20, 1:42–1:54).
- **No outro or loop card.**
- **Angelo off screen from 3:29 to 3:56 and from 4:30 to the end.** Checked against the source: from about 3155 s the
  camera faces the colleagues and he is not in the picture, so no reframe can find him. The edit could only have cut
  that part shorter.

### Codex: not run

Angelo called the proof after reviewing the OpenCode edits ("Since this is a demo this is all good") and chose to ship
before the Codex run started.

## Studio defects the runs found, all fixed in this branch

Each one stopped or misled a real agent edit. Each fix has a test that fails without it.

| Commit                | Defect                                                                                                                                                                                                                     | Found by                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `8e0b56e`             | A long edit's chunk filter graph (234 KB) passed Linux's 128 KiB one-argument limit; every full render failed                                                                                                              | Claude round 1                                |
| `05d7616`             | `qc_master` held the tool call for a 61-min QC; Claude Code dropped it at 30 min, twice, and a second QC queued                                                                                                            | Claude round 2                                |
| `212c863`             | QC reported no progress for an hour                                                                                                                                                                                        | Claude round 2                                |
| `4af3807`             | The house caption-contrast gate failed every v2 caption; its fix (a plate) is forbidden by v2 rule 2                                                                                                                       | Claude round 2                                |
| `50e3aec`             | Density counted cues only through their sounds; a tumble bigWord (no sound) read as a 21 s gap                                                                                                                             | Claude round 2                                |
| `43e8e32`             | Counting every cue also counted captions, which would pass any captioned edit                                                                                                                                              | the fix above, checked on round 2             |
| `7708e27`             | No tool read a stored spec back, so changing one cut-spec field meant retyping 28 zooms                                                                                                                                    | Claude round 3                                |
| `04f350b`             | A check listing 964 problems made a report Claude Code could not show; the agent probed with an export instead                                                                                                             | Claude round 3                                |
| `af9ff34`             | Whisper re-heard 3 s Taglish windows as Spanish, so kept words read as lost at 44 cuts                                                                                                                                     | Claude round 3                                |
| `faac356`             | Whisper drops short fillers at random in a window centred on the cut; the same words flagged and cleared run to run                                                                                                        | Claude round 5                                |
| `cb9d4b6`             | Whisper stamps some words with no length; `propose_cuts` made zero-length candidates and failed its own contract (HTTP 500)                                                                                                | OpenCode run 1                                |
| `8f1a9c8`             | A rack focus without matteRanges failed at render, pointing the agent at `matte.py`, a films script it cannot run; focus now brings its own matte                                                                          | OpenCode run 2                                |
| `3d5fdb3`             | edit-director said only `references/learnings.md`, so OpenCode asked two other skills for it first                                                                                                                         | OpenCode run 2                                |
| `39f9100`             | The auto-ingest test still counted one job after Phase 5 made ingest queue its own transcription                                                                                                                           | full server run                               |
| `ede23b2`             | A big word's kicker landed on a chip at the same moment and every gate passed; render now measures each cue's text in Chrome and refuses collisions                                                                        | Angelo, OpenCode's edit                       |
| `abc4e90`             | The studio's v2 skill still put words behind his head; the latest rules keep all text visible, captions below the chin, the hook ends at the intro                                                                         | Angelo, OpenCode's edit                       |
| `697b19a`             | Colleagues showed unblurred and the camera rested on listeners; the edit now follows whoever speaks and frosts every face but his when asked                                                                               | Angelo, OpenCode's edit                       |
| `fe5121e`             | `propose_cuts` over a 43-min session returned a list too long for the agent to read; it now takes the spans the edit keeps and caps at 150                                                                                 | Claude run 2                                  |
| `f7c0dcf`             | Each preview re-wrote the face mask under the render lock, and a stopped render lost its whole face scan                                                                                                                   | Claude run 2                                  |
| `32ece6a`             | The latest rules map every place beyond home; the studio had no routeMap kind and no map gate                                                                                                                              | the v2 skill sync                             |
| `de81090`             | A footage card's odd-sized crop failed only at render, 20 minutes in; the cue is now checked when written                                                                                                                  | Claude run 2                                  |
| `026e2a2`             | Footage cards showed colleagues unblurred and the letterboxed room; cards now carry their own face mask and a framed crop                                                                                                  | Claude run 2, frame check                     |
| `30ce0f7`             | The cut-word check (whisper over every cut) ran for 2 h on a master that had already failed a quick gate                                                                                                                   | Claude run 2                                  |
| `89f4ed2`             | Whisper ran on the CPU; it now runs on the GPU where there is one (60 s of audio: 3.5 s against 35.2 s)                                                                                                                    | Angelo: "fucking use the GPU"                 |
| `486c982`             | In the reel the creator turned to the screen was classed as a colleague: the mask blurred him at the 6% beat and the gate failed his own face                                                                              | Claude run 2, reel QC                         |
| `0e18bfe`             | With colleagues blurred, faceClear took a colleague's frosted face for his and failed a big word above it while he was off screen                                                                                          | Claude run 2, full QC                         |
| `f71afcf`             | A thin cue sheet (hook gap) failed only at QC, after a 20-min render of each master; render now refuses it in seconds, before any frame                                                                                    | Angelo: "this should be fast"                 |
| `f9e5a00`             | Cut edges snapped into soft words and pause trims removed words, so QC failed clipped words round after round; cuts now stay off every word                                                                                | Claude runs 1-2 (10+ rounds)                  |
| `c8f90ec`             | The blur mask (~5 min of each full render) was redrawn even when only a graphic moved; it is now reused when faces and cuts are unchanged                                                                                  | Angelo: "taking too long"                     |
| `9d62374`             | Every render re-shot all ~800 caption plates (7.4 min) when any cut moved; plates are cached by their drawn markup, 815 of 815 reused after a re-cut                                                                       | Angelo: "taking too long"                     |
| `6ada9a0`             | The reel opened on 3 frames of bare footage and 1 of blank paper (a cover cue 0.08 s after the cut); a cue within 0.2 s of a cut starts on it                                                                              | 2 fps critique, Claude's reel                 |
| `0a13242`             | A cut edge that met a word's stamped start still clipped its first sound; each word is now widened by up to 60 ms, never into its neighbour                                                                                | Claude run 2, 'kasi' at 1:41                  |
| `f36f072`             | After `6ada9a0` QC still placed a snapped cue at its authored time and failed hookMouth and faceClear at 0.0 s; QC now places it on the cut                                                                                | Claude run 2, full QC                         |
| `89f960e`             | stepBars labels were paper ink over footage, so "FASTER" vanished on a dark monitor; labels are white over footage, as big words are                                                                                       | 2 fps critique, Claude's full edit            |
| `4e9d0a0`             | The face-mask tests wrote their masks into the working folder                                                                                                                                                              | test run                                      |
| `5c581bc`             | Each preview set the face scan's cache aside and rescanned the whole 43-min source (10–25 min a preview)                                                                                                                   | OpenCode's previews                           |
| `06ee128`             | A failed render step reported only "exit code 1", not the reason on its last line                                                                                                                                          | OpenCode's renders                            |
| `caef0e6`             | The density refusal named only the longest gap, so OpenCode fixed one gap per 3.5-min refusal (about 40 gaps)                                                                                                              | OpenCode's renders                            |
| `7a62ca2`             | Face masks were stored at 30..218 instead of 16..235, so the blur let 9% of each face through and eyes and nose stayed readable                                                                                            | Angelo, Claude's full edit at 4:10 and 4:45   |
| `5f6813d` → `aea7268` | Caption snapshots failed on HyperFrames' 10 s page-load limit on a loaded machine; the first fix set the wrong flag and every render failed again until the limit was raised through `PRODUCER_PAGE_NAVIGATION_TIMEOUT_MS` | OpenCode's renders (5 failed)                 |
| `b78610a`             | Whisper finished before the 3-clip join and its transcript was filed under the first clip; `qc_master` then said "no transcript" for every master and OpenCode waited 3 h                                                  | OpenCode's QC                                 |
| `39eedfe`             | Footage-card clips encoded under the weak mask were reused after its fix: their record said only that a mask existed, not which                                                                                            | facesBlurred probe, OpenCode's master at 9:31 |
| `880b7e9`             | facesBlurred skipped every face under the detail floor, so it passed the see-through blur Angelo caught; a face still detected under a frost now fails unless it is his                                                    | Angelo's catch, measured on both masters      |
| `ea6dfa5`             | The mask drew only the nearest face sample (3 a second), so a colleague turning her head slid out of it for a frame or two                                                                                                 | facesBlurred, OpenCode's full edit at 11:20   |
| `3d500ae`             | Each mask input was seeked on the source's timestamps; the mask's own drifted 27 ms by frame 74 424, so it ran a frame late                                                                                                | the 11:20 investigation                       |

## Angelo's review of OpenCode's edit (2026-11-03)

OpenCode's first edit (4:01) passed every blocking gate and still failed three of Angelo's checks:

- **Text on text.** Above "WRONG DATA", the word's kicker "ONEPUHUNAN · AI TRAINING" sat under a chip "AI · DATA ENTRY"
  for the same two seconds. No gate compared text with text.
- **Colleagues unblurred.** "For this video, one puhunan, they need to be blurred but not every video needs to be
  blurred. I suggest you should ask me if they need to be blurred or not".
- **The camera on listeners.** "Mostly it's focused on the speaker only most of the time but if it can automatically
  switch and detect who's speaking, that will be fucking awesome".

All three are fixed in the studio (table above), and every agent now asks the blur question before the cut. The
speaker-following camera and the blur were proven on an 80 s cut of the same session before the agents re-ran: it held
on Angelo through his profile shots, followed three colleagues in turn, and frosted all three; `framed` and
`facesBlurred` pass on that master. The first blur (a box blur) still let SFace match a colleague; the shipped one
rebuilds each face from a 12x21 copy of the frame. The 9-48 Laplacian detail measured then was the weak blend `7a62ca2`
fixed: eyes and nose still read through it. Blurred right, a face is no longer found by the detector at all.

## Agent behaviour found

- **Claude ended its turn mid-QC.** It said "I'll read the report when it lands" and stopped, and nothing wakes an agent
  when a job ends. The skill already says to keep calling `job_wait`. The driver now nudges an idle agent when its job
  finishes, as a user watching the Activity panel would.

- **OpenCode asks in prose.** Question cards come only from Claude Code's `AskUserQuestion`. OpenCode put its three
  openings, with a recommendation, in its narration and then waited, so the answer has to be typed in the prompt box.
  The driver now answers a question asked this way with the agent's own recommendation.

- **The driver's go-ahead loop.** The test driver sends "carry on" each time the agent goes idle, about once a minute.
  While OpenCode was blocked, it spent about 3 h of those turns, each a `job_wait` and a status line, with nothing moving.
  A user would have cancelled and retried the stuck job. That is a fault in the
  test driver, not in the studio or the agent, and it is counted in OpenCode's tokens above.

## Known limits, not fixed here

- **The speaker follow cannot hear who is talking.** It picks the face whose lips move most, so when the creator speaks
  from behind the camera, a listener who touches her mouth or chews takes the shot (OpenCode 6:56–8:20, Claude 4:03 on).
  Telling them apart needs the lip motion matched against the audio, a larger change than this branch. What the camera
  shows during an off-screen voice (a group shot of the listeners, or graphics over it) is Angelo's call.
- **QC takes 20–60 min per round on CPU whisper**, because it re-hears every cut. The GPU build measured 10.8 s against
  131 s on a 7:48 transcription. Pinning it waits on Angelo's hosting decision (about 650 MB hosted against a 3 GB
  setup build).
- **The studio's Read guard blocks Claude Code's own `tool-results/` folder**, where any oversized tool output lands.
  The QC cap keeps reports under that size. Widening the guard means allowing reads inside `~/.claude`, a security
  change left for review.
