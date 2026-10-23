<!-- Created by The Angelo Umali. -->

# Editor states: empty, loading, error, reduced motion, dense timeline

Slice 4d (plan §14 Phase 4). Owner priya; built by lena in slice 4a. This is a build spec: every string below is final copy, every colour is a
token from `design/tokens.css`, and every state names the component that shows it. Where this file is silent, the approved mock-up
(`design/mockup/`, `APPROVED.md`) decides.

Sources: plan §9.1 (screens, agent text is text), §9.3 (live preview, timeline wipe), §9.5 (2,000 items at 60 fps), §6.11 (events), §6.12 (Stop,
reopen), §6.13 (usage), §6.14 (failure states); mock-up screens `12`–`20`, `27`–`29`, `33`; `design/mockup/styles.css` (`.empty`, `.player-empty`,
`.feed-empty`, `.auth-block`, `.notice`, `.blk[data-fresh]`, the reduced-motion block at the end).

## 1. Rules that apply to every state

1. **Regions are independent.** The Editor has five regions: media bin, preview, agent pane, timeline, version strip. Each one resolves its own
   state. A failing preview never blanks the feed; a slow spec fetch never hides the bin. Only the route-level states in §3.1 replace the whole grid.
2. **Precedence inside a region:** error, then first load, then empty, then ready. A refetch that already has data never shows a loading state: it
   keeps the stale content on screen until the new content arrives (stale while revalidate).
3. **Layout never jumps.** Every skeleton and empty block has the same box as the content it stands in for. Timeline lanes keep their height when
   empty. The preview keeps its 9:16 stage in every state.
4. **Agent and server text is text.** Error messages, engine output, file names and item labels render as React text children (plan §9.1). Server
   detail goes on its own line in `--font-mono`, `--text-ui-sm`, `--color-copy-muted`, with `break-words`.
5. **Colour never carries a state alone.** Every error has the `TriangleAlert` or `CircleX` icon plus words. Danger text uses `--color-danger`
   (8.78:1 on `--color-bg-elevated` dark, 6.54:1 light). Gold stays on the one primary action; no state uses gold.
6. **Copy voice:** say what happened, then what to do, in plain sentences. No "Oops", no exclamation marks, no blame. Name the thing ("preview
   copy", "media list"), not the mechanism ("query", "SSE").

## 2. Component map

Lena builds against this table. "Existing" means import it; "4a" means the component slice 4a already builds for the ready state, extended with the
state here; "New" carries a one-line reason.

| State surface                                 | Component                                                     | Status                                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Route skeleton, not found, server unreachable | `EditorRoute` (`apps/web/src/routes/editor.tsx`)              | Existing route; the 4-pane grid replaces its Phase 2 list layout                                            |
| Skeleton blocks                               | the `recent-projects.tsx` pattern: `bg-surface animate-pulse` | Existing pattern; reuse the classes, add no skeleton component                                              |
| Centred empty or error block                  | the mock-up `.empty` / `.auth-block` layout                   | Existing pattern (mock-up); one `EmptyBlock` is allowed only if lena already has one, else inline it        |
| Buttons                                       | `buttonClass("secondary" \| "quiet")`                         | Existing; no state uses `primary`                                                                           |
| Status lines (polite)                         | `StatusLine` (`apps/web/src/setup/status-line.tsx`)           | Existing; move to `components/` if a second folder imports it                                               |
| Session errors in the feed                    | `ErrorCard` (`apps/web/src/agent/error-card.tsx`)             | Existing; its copy stays as written                                                                         |
| Empty feed                                    | `ActivityFeed` empty branch                                   | Existing; copy unchanged                                                                                    |
| Upload progress in the bin                    | `UploadList` (`apps/web/src/components/upload-list.tsx`)      | Existing                                                                                                    |
| Bin drop target                               | `DropZone` (`apps/web/src/components/drop-zone.tsx`)          | Existing                                                                                                    |
| Preview states                                | `PreviewPlayer`                                               | 4a                                                                                                          |
| Timeline states, dense mode                   | `Timeline`, its lanes and blocks                              | 4a                                                                                                          |
| Version strip states                          | `VersionStrip`                                                | 4a                                                                                                          |
| Cut-candidate chip errors                     | `CutCandidateChips`                                           | 4a                                                                                                          |
| Notice strip (reconnecting, preview behind)   | the mock-up `.notice` / `.notice-error`                       | Existing pattern (mock-up); first use in the app, so lena may extract it once both uses land                |
| Density run (`blk-run`)                       | a block variant inside `Timeline`                             | New: 2,000 items cannot all draw at fit zoom; a run is the only honest way to show items narrower than 2 px |
| Timeline zoom controls                        | two `icon-btn` buttons plus "Fit" in the timeline head        | New: §9.5 budgets zoom and the mock-up has none                                                             |
| Timeline keyboard seek                        | `role="slider"` on the timeline lane area                     | New: click-to-seek has no keyboard path today (WCAG 2.1.1)                                                  |

## 3. States by region

### 3.1 Route (the whole Editor)

| State              | Trigger                                           | What shows                                                                                                                                                                                                                                                                                                                                       |
| ------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Loading            | `projectQuery` pending and no cached data         | The 4-pane grid with skeletons: bin 2 rows (§3.2), preview stage as one `bg-surface` 9:16 block, agent pane 3 bars of 1 line each, timeline 4 lane bars. One `role="status"` with sr-only text **"Loading project…"**; `aria-busy="true"` on `<main>`.                                                                                           |
| Not found          | `projectQuery` error, HTTP 404                    | Centred block, icon `FolderX` (`--color-copy-dim`). Title **"This project isn't here"**. Body **"It may have been deleted, or the link came from another computer."** Action: link styled `buttonClass("secondary")`, **"Back to projects"**, to `/`. Focus moves to the title (`tabIndex={-1}`).                                                |
| Server unreachable | `projectQuery` error, network failure or HTTP 5xx | Centred block, icon `CircleX` (`--color-danger`). Title **"Can't reach the studio server"**. Body **"Check that `pnpm start` is still running in your terminal."** Action `buttonClass("secondary")` **"Try again"** → refetch; while pending it reads **"Trying again…"** and is disabled. Mono detail line: the error message. `role="alert"`. |

### 3.2 Media bin

| State        | Trigger                              | What shows                                                                                                                                                                                                                                           |
| ------------ | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Empty        | `mediaQuery` success, 0 assets       | The `bin-list` is not rendered. The `DropZone` grows to fill the bin (min-height 12rem) with icon `Upload`, title **"No clips yet"**, body **"Drop video, audio or images here, or use + to pick files."** The `+` button stays in the head.         |
| Loading      | `mediaQuery` pending, no data        | 2 skeleton rows, each the size of a bin item: a 2rem × 3.5rem thumb block and two text bars (60% and 80% width), gap `--space-3`.                                                                                                                    |
| Uploading    | a file upload in progress            | `UploadList` rows above the bin list (existing behaviour, per-file progress).                                                                                                                                                                        |
| Error (list) | `mediaQuery` error                   | Inline in the bin, left aligned: icon `TriangleAlert` + **"Couldn't load the media list."**, then `buttonClass("quiet")` **"Try again"**, then the mono detail line. `role="alert"`.                                                                 |
| Error (item) | the server marks an asset unreadable | The item keeps its row. The thumb is replaced by `TriangleAlert` in `--color-danger`; the meta line reads **"Can't read this file"** followed by `·` and the server's reason in mono. The item's accessible name ends with ", can't read this file". |

### 3.3 Preview

The stage is always the dark video ground (`--color-video-ink`), in both themes. Messages on it use `--color-video-paper` (14.01:1).

| State                   | Trigger                                                             | What shows                                                                                                                                                                                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No media                | 0 assets                                                            | The mock-up's `player-empty`: **"Add a clip to see it here."** Play button disabled; timecode **"0:00.0 / 0:00.0"**. "Safe zones" toggle disabled.                                                                                                                                                                   |
| Making the preview copy | assets exist, the proxy job is queued or running                    | Centred on the stage: **"Making a preview copy…"** then, when `job.progress` gives a percent, ` {pct}%` in mono; under it a `.progress` bar (steel fill, `--dur-2` linear). No pct yet: text only plus the `Loader` icon spinning (static under reduced motion). Transport disabled.                                 |
| Updating                | a `spec.version` arrived and its `preview.ready` has not            | The current frame stays and keeps playing. The `preview-note` slot changes from **"Live preview · not a render"** to **"Updating to v{n}…"**. Nothing overlays the footage.                                                                                                                                          |
| Behind                  | still updating 3 s after the `spec.version` (the §9.5 budget)       | `preview-note` reads **"Preview is behind · showing v{shown}, building v{n}"** in `--color-copy-muted`. No alarm colour: the edit itself is saved.                                                                                                                                                                   |
| Ready after update      | `preview.ready`                                                     | Re-seek to the same edited time and swap the double buffer on the next `requestVideoFrameCallback`. The swap is instant: a crossfade would show two edits at once. `preview-note` returns to **"Live preview · not a render"**.                                                                                      |
| Overlays not loading    | the 4318 iframe fails to load, or sends no ready message within 5 s | Footage keeps playing without overlays. A `.notice-error` strip under the stage: **"Overlays aren't showing. The preview server didn't answer."** Action `buttonClass("quiet")` **"Retry overlays"** reloads the iframe.                                                                                             |
| Couldn't update         | the composition build for v{n} fails                                | The stage stays on the last good version. `.notice-error` strip: **"Couldn't update the preview to v{n}. The edit is saved; the preview catches up on the next change."** plus the mono engine detail. A **"Try again"** quiet button appears only if slice 4b exposes a rebuild trigger route; otherwise no button. |
| Can't play              | the `<video>` fires `error` on the proxy                            | Centred on the stage, icon `CircleX`: **"Can't play the preview copy."** plus the mono media error. Transport disabled. The timeline stays usable.                                                                                                                                                                   |

Only the error strips are `role="alert"`. "Updating" and "Behind" are not live regions: they change on every agent write and would talk over the
feed, which already narrates each change.

### 3.4 Agent pane

| State                     | Trigger                                               | What shows                                                                                                                                                                                                                                                                                               |
| ------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Checking the connection   | the connection query is pending                       | Existing text **"Checking how the studio reaches Claude…"** as a `StatusLine`.                                                                                                                                                                                                                           |
| Loading history           | reopening a project while persisted events replay     | `StatusLine` **"Loading this project's history…"** where the feed goes. The composer is visible and enabled.                                                                                                                                                                                             |
| Empty feed                | no feed items                                         | Existing copy: **"Tell the agent what you want"** / **"It transcribes, plans cuts, writes captions and adds overlays. You approve before anything renders."**                                                                                                                                            |
| Empty feed, no media      | no feed items and 0 assets                            | Same empty copy. The composer's send button is disabled and the hint line (where **"Ctrl + Enter to send"** sits) reads **"Add a clip first. The agent edits the clips in this project."**, linked to the button with `aria-describedby`.                                                                |
| Reconnecting              | event stream status `reconnecting` for 2 s or more    | `.notice` strip at the top of the pane: icon `RefreshCw` + **"Reconnecting to the studio… Changes made meanwhile will appear when it's back."** `role="status"`. It leaves the moment status is `live`.                                                                                                  |
| Disconnected              | still not `live` 30 s after the strip appeared        | The strip turns `.notice-error`: **"Lost the connection to the studio. The preview and timeline may be out of date."** Action `buttonClass("quiet")` **"Reload"** reloads the page. `role="alert"`.                                                                                                      |
| Resync                    | a `resync` event, or a stream reopened with no cursor | No UI. Queries are invalidated and content updates in place.                                                                                                                                                                                                                                             |
| Session error             | `session.error`                                       | `ErrorCard`, copy as written in `error-card.tsx`.                                                                                                                                                                                                                                                        |
| Key rejected (modes A, B) | `session.error` kind `auth_failed`                    | The mock-up's `auth-block-key` replaces feed and composer: **"Your API key was rejected"** / **"Anthropic answered 401 when the studio checked the key. Paste a new one, or check your credit in the Claude Console."** / **"Re-enter key"** (to `/setup`) / **"Console billing"** (opens in a new tab). |
| Rate limited, retrying    | `retry`                                               | Mock-up retry banner: **"Rate limited."** + mono **"Retrying in {s} s"** + **" · attempt {attempt} of {max}"**, a linear `.progress` bar counting down; then **"Back on."** + **" The request went through on attempt {attempt}."** Status chip: **"Waiting on rate limit · {s} s"**.                    |
| Plan limit reached        | `limit` with `status: "rejected"`                     | `ErrorCard` kind `rate_limited` with its existing copy, plus a mono line **"Resets in {h} h {m} min"** computed from `resetsAt`, updated once a minute.                                                                                                                                                  |
| Signed out (mode T)       | none: the app can't detect it (§6.14)                 | The static hint above the terminal pane, **"Sign in inside the terminal with /login"**, as Phase 2 built it.                                                                                                                                                                                             |

### 3.5 Timeline

| State            | Trigger                                                | What shows                                                                                                                                                                                      |
| ---------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No media         | 0 assets                                               | Ruler hidden. The four lanes render empty at their normal heights. `timeline-meta` reads **"No media"**. Zoom controls and the seek slider are disabled.                                        |
| Uncut            | media, no cuts spec yet                                | Mock-up screen 12: one raw block per clip (**"clip A · uncut"**), meta **"Uncut · {duration}"**.                                                                                                |
| Empty track      | a lane with 0 items                                    | The lane stays blank: no placeholder text, no hatch. Its accessible name says **"{Track}, no items"**.                                                                                          |
| First load       | specs query pending, no data                           | Each lane shows one skeleton bar at 100% width; the ruler shows no ticks. `timeline-meta` reads **"Loading edit…"**.                                                                            |
| Updating         | a `spec.version` arrived, its content fetch is pending | The old blocks stay. When the new content lands, only blocks whose id is new or whose span changed get the entrance (§4.3). Removed blocks disappear with no animation.                         |
| Error, with data | specs fetch failed after a previous success            | Blocks stay on the last good version. `timeline-meta` is replaced by `TriangleAlert` + **"Couldn't load v{n} of the edit."** in `--color-danger`, then a quiet **"Try again"**. `role="alert"`. |
| Error, no data   | first specs fetch failed                               | The lanes stay empty. One `.notice-error` row spans the lane column: **"Couldn't load this edit."** + quiet **"Try again"** + the mono detail.                                                  |

### 3.6 Version strip

| State               | Trigger                                         | What shows                                                                                                                                                                                            |
| ------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No versions         | no spec written yet                             | The strip shows its label and **"No versions yet"** in `--color-copy-dim`. No chips, no restore button.                                                                                               |
| Restore unavailable | the agent is running                            | Restore button disabled, with a help line under the strip, linked by `aria-describedby`: **"Restore is off while the agent is working. Stop it first."**                                              |
| Restoring           | the restore request is pending                  | Button reads **"Restoring v{n}…"** and is disabled. Chips stay clickable but restore stays disabled.                                                                                                  |
| Restored            | the request succeeded and the new version lands | A new chip **"v{m} Restored v{n}"** appears with `aria-current="true"`. A `StatusLine` under the strip says **"Restored v{n} as v{m}. Later versions are still in the strip."** and clears after 6 s. |
| Restore failed      | the request failed                              | A `TriangleAlert` + **"Couldn't restore v{n}."** + mono detail under the strip, `role="alert"`. The selection stays, so "Restore v{n}" can be pressed again.                                          |

### 3.7 Cut-candidate chips (errors only)

The pending, approved and rejected looks are slice 4a's (mock-up screen 13). This spec adds the two failure states.

| State       | Trigger                                                    | What shows                                                                                                                                                        |
| ----------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sending     | the decisions POST is pending                              | Submit reads **"Sending your choices…"**, disabled. Chips stay put and cannot be toggled.                                                                         |
| Expired     | the server answers that the request is closed (409 or 410) | Chips leave the Video lane with no animation. Notice in the feed: **"These suggestions expired. Ask the agent to propose cuts again."**                           |
| Send failed | any other error                                            | Chips keep the user's choices. Under submit: `TriangleAlert` + **"Couldn't send your choices."** + mono detail, `role="alert"`; submit is enabled again to retry. |

## 4. Transition rules

### 4.1 State machine (one per region)

```ascii
                 fetch starts
   ┌────────┐  (no cached data)  ┌──────────────┐  data, 0 items   ┌────────┐
   │  idle  │ ─────────────────► │ first load   │ ───────────────► │ empty  │
   └────────┘                    │ (skeleton    │                  └───┬────┘
                                 │  after 200ms)│  data, ≥1 item       │ first item
                                 └──────┬───────┘ ──────────────┐      ▼
                                        │ fails                 └─► ┌────────┐
                                        ▼                           │ ready  │◄─┐
                                 ┌──────────────┐  retry ok         └───┬────┘  │ refetch ok
                                 │ error        │ ────────────────────► │       │ (stale shown
                                 │ (no data)    │                       │       │  meanwhile)
                                 └──────────────┘    refetch fails      ▼       │
                                                  ┌─────────────────────────────┴┐
                                                  │ error, with data (stale kept)│
                                                  └──────────────────────────────┘
```

### 4.2 Timing

All durations and curves are tokens. Exits are faster than entrances: a resolved problem should vanish the moment it is resolved.

| Change                         | Rule                                                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Fetch starts                   | Show nothing for 200 ms. Most local fetches finish inside that and the user never sees a skeleton flash.       |
| Skeleton shown                 | Keep it at least 400 ms, then swap, so it does not flicker.                                                    |
| Skeleton → content             | Remove the skeleton and fade the content in: `opacity` 0 → 1, `--dur-1` (160 ms), `--ease-out`. Nothing moves. |
| Empty → first item             | Remove the empty block in the same frame; the first item uses its normal entrance (feed row or timeline wipe). |
| Ready → error block (blocking) | Fade in, `--dur-1`, `--ease-out`. No shake, no colour flash.                                                   |
| Error → retry                  | The error stays on screen; only the button text changes to its "…ing" form. Success fades content in as above. |
| Notice strip appears           | After its debounce (2 s reconnecting, 3 s preview behind), fade in over `--dur-1`.                             |
| Notice strip leaves            | Instantly, with no exit animation.                                                                             |
| Preview buffer swap            | Instant, on `requestVideoFrameCallback`.                                                                       |
| Spinner                        | `Loader` rotates at 800 ms per turn, linear (the mock-up `.spin`). Only where no percent is known.             |
| Progress bars                  | `transform: scaleX()`, `--dur-2`, linear: a progress bar is a clock.                                           |
| Feed autoscroll                | Only when the reader is within 48 px of the bottom. Scrolled up, new rows never move them.                     |

### 4.3 Timeline item entrance

- A new or changed block wipes in from its start edge: `clip-path: inset(0 100% 0 0)` → `inset(0)`, `--dur-2` (320 ms), `--ease-out` (the mock-up's
  `@keyframes wipe`). SFX diamonds fade in instead.
- Stagger: 12 ms per item in time order, capped so the whole batch finishes within 240 ms of stagger plus the 320 ms wipe. Above 20 items the step
  becomes `240 / count` ms.
- A batch of more than 40 new items in the visible window does not animate per item: the blocks appear in place, and the feed row narrating that
  tool call is the signal. 40 wipes at once read as noise, not as building.
- Items outside the visible window never animate, and neither do items mounted by scrolling or zooming.
- Animate only `clip-path` and `opacity`. Never `left`, `width` or `transform` on blocks.

## 5. Reduced motion

`prefers-reduced-motion: reduce` keeps the fades that explain a state change and drops travel, wipes, pulses and spin. The app's global rule
(`apps/web/src/styles/app.css`) shortens transitions only, so every keyframe animation below needs its own `motion-reduce:` variant.

| Element                     | Default                                    | Reduced motion                                                                      |
| --------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------- |
| Timeline block entrance     | clip-path wipe 320 ms, staggered           | `opacity` 0 → 1 over `--dur-1`, no stagger; the block is in its final place at once |
| SFX diamond entrance        | fade 320 ms                                | fade `--dur-1`                                                                      |
| Feed row entrance           | rise 0.5rem + fade, `--dur-2`              | fade `--dur-2`, no rise (the mock-up's `fade-in`)                                   |
| Narration text              | streams in 3 characters per frame          | the whole sentence at once                                                          |
| Skeleton pulse              | `animate-pulse`                            | static `bg-surface`                                                                 |
| Spinner                     | rotating `Loader`                          | static `Loader` icon; the words beside it carry the state                           |
| Skeleton → content          | fade 160 ms                                | unchanged (a fade is not motion)                                                    |
| Notice strips, error blocks | fade 160 ms                                | unchanged                                                                           |
| Progress bar                | `scaleX` transition 320 ms linear          | jumps to each new value                                                             |
| Retry countdown bar         | animates down                              | jumps once a second with the number                                                 |
| Preview swap, re-seek       | instant                                    | instant                                                                             |
| Playhead during playback    | follows the clock per frame                | unchanged: it is the playback itself                                                |
| Timeline follow-scroll      | jumps one viewport when the playhead exits | unchanged: it never scrolls smoothly                                                |
| Zoom                        | follows the gesture per frame              | unchanged; zoom buttons jump straight to the next level with no tween               |
| Feed autoscroll             | `scrollTo({ behavior: "smooth" })`         | `behavior: "auto"`                                                                  |

Tab switches (Activity / Terminal) and terminal lines never animate, in either mode.

## 6. Dense timeline (2,000 items)

The acceptance fixture: a 60-minute source with 1,200 captions, 400 video segments, 250 overlay cues and 150 SFX markers, which is 2,000 items.
Cut marks between segments are drawn but not counted. The AC is 60 fps scroll and zoom (plan §9.5).

### 6.1 What is drawn

- **Windowing.** Only items that intersect the visible time range plus one viewport width on each side are mounted. At any zoom the timeline has at
  most 600 DOM nodes.
- **Level of detail by on-screen width `w`:**

| `w`       | Drawn as                                                                                  |
| --------- | ----------------------------------------------------------------------------------------- |
| ≥ 48 px   | the normal block, label shown (ellipsis), as in the mock-up                               |
| 6 – 47 px | the normal block, no label; the label stays in `title` and the accessible name            |
| 2 – 5 px  | the block with no inset ring and a 0 radius (a ring or radius on a sliver reads as noise) |
| < 2 px    | not drawn alone. Neighbours less than 2 px apart merge into one **density run**           |

- **Density run (`blk-run`).** A run spans its first item's start to its last item's end, in the lane's block fill, with a 1 px inset ring in
  `--color-line-strong` (4.93:1 dark, 4.58:1 light on `--color-bg-elevated`). Its `title` and accessible name are **"{count} {track items},
  {start}–{end}"**, for example "84 captions, 12:04–14:51". Runs never animate.
- **Cut marks** closer than 3 px merge into one mark. **SFX diamonds** closer than 8 px merge into one diamond titled **"{count} sound effects"**.
- **Track labels** show a count once the lane has items: **"Captions"** then a mono **"412"** in `--color-copy-dim`, so a dense lane still says what
  it holds when its blocks are runs.
- **Ruler.** The tick step is the smallest of 1, 2, 5, 10, 15, 30, 60, 120, 300 or 600 s that keeps ticks at least 64 px apart.

### 6.2 Zoom and scroll

- Controls in the timeline head, between the meta and the legend: icon buttons **"Zoom out"** (`ZoomOut`), **"Zoom in"** (`ZoomIn`), and a quiet
  text button **"Fit"**. Each icon button has that text as its `aria-label` and a 44 px hit area (`--target-min`).
- Range: **Fit** (the whole edit in the lane width) to 40 px per second. Buttons step ×2 and ÷2. `Ctrl` + wheel (`⌘` + wheel on macOS) zooms
  around the pointer; trackpad pinch does the same. With the timeline focused, `+` and `-` zoom around the playhead.
- At Fit, "Zoom out" and "Fit" are disabled. At 40 px/s, "Zoom in" is disabled.
- During playback, when the playhead leaves the visible range the view jumps one viewport forward. It never scrolls smoothly: a moving timeline
  under a moving preview is too much to watch.

### 6.3 Performance contract (checked by a trace on the fixture)

- Frame time ≤ 16.7 ms at p95 while scrolling and while zooming; no long task over 50 ms.
- Zoom changes recompute positions once per animation frame, not per wheel event.
- No per-item layout reads during scroll (`getBoundingClientRect` on blocks is banned in the scroll path).
- The §4.3 entrance rules hold: off-window items and batches over 40 never animate.

## 7. Accessibility requirements

- Loading states use one `role="status"` per region with sr-only text; the region gets `aria-busy="true"` while loading. Skeleton blocks are
  `aria-hidden`. They are decorative, so their 1.09:1 contrast with the lane is not a failure.
- Errors that block a region are `role="alert"`. Non-blocking notices are `role="status"`. Never more than one live announcement per event.
- Errors never take focus, except the route-level not-found and server-unreachable titles, which replace the whole page.
- Disabled controls explain themselves with a visible help line linked by `aria-describedby` (composer with no media, restore while running).
- **Timeline keyboard seek.** The lane area is one focusable `role="slider"`, `aria-label="Playhead"`, `aria-valuemin="0"`, `aria-valuemax` the edit
  length in seconds, `aria-valuetext` like **"1:04.2 of 3:12.0"**. Arrow keys move ±1 s, `Shift` + arrow ±10 s, `Home` / `End` go to the ends,
  `+` / `-` zoom. Blocks are not tab stops (2,000 tab stops is a trap); cut-candidate chips are, because they take a decision.
- Each lane is `role="group"` with the accessible name **"{Track}, {count} items"** or **"{Track}, no items"**.
- Focus ring: the existing `:focus-visible` rule (`--focus-width` 2 px, `--color-focus`), on the slider as on every control (mock-up screen 33).
- Every state in this file is checked in both themes. All text pairs used here pass 4.5:1 and all non-text indicators pass 3:1 (measured
  2026-10-23 against `design/tokens.css`).

## 8. Checks lena can test against

1. With the network panel throttled so `projectQuery` takes 1 s: the skeleton appears after 200 ms, stays at least 400 ms, and the grid does not
   shift when content replaces it.
2. A 404 slug shows "This project isn't here" with focus on the title; stopping the server shows "Can't reach the studio server", and "Try again"
   recovers once it is back.
3. A project with 0 assets: bin "No clips yet", preview "Add a clip to see it here.", timeline meta "No media", send disabled with its help line.
4. A replayed `spec.version` without `preview.ready` for 3 s turns the note into "Preview is behind · showing v{shown}, building v{n}"; the
   `preview.ready` returns it to "Live preview · not a render" with no crossfade.
5. Blocking the 4318 origin shows "Overlays aren't showing…" while footage keeps playing.
6. Killing the event stream for 2 s shows the reconnecting strip; 30 s more turns it into the error strip with "Reload".
7. With `prefers-reduced-motion: reduce` emulated, no element in §5 moves, pulses or spins; fades remain.
8. The 2,000-item fixture: timeline DOM nodes ≤ 600 at Fit and at 40 px/s; the performance trace meets §6.3; runs carry their counts in the
   accessible name.
9. Keyboard only: Tab reaches the timeline slider, arrows move the playhead and the preview re-seeks; `+` / `-` zoom.
10. A cue label of `</script><img src=x onerror=alert(1)>` renders literally as a block label, in a run's `title`, and in any error detail line.

## 9. Notes

- **Reduced motion for new timeline items.** Plan §9.3 says "instant placement"; the approved mock-up fades them (`styles.css`, reduced-motion
  block). This spec keeps both: the block is placed instantly with no wipe or travel, and its opacity fades over 160 ms. A fade is not motion and it
  tells the user the item is new.
- **Usage meter in mode T.** Mock-up screens 12 and 13 show "Plan session 34% used" for the terminal mode; plan §6.13 says the app shows no meter in
  mode T. The app already follows the plan (`usage-meter.tsx`), and this spec does too: no usage state exists in mode T.
