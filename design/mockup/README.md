<!-- Created by The Angelo Umali. -->

# zkidz-studio UI mock-up

This is a clickable design reference for the v1 local web app. Build against it. It has no build step and runs opened from `file://` or served statically:

```bash
npx http-server@14 design/mockup -p 4917 -s
# open http://127.0.0.1:4917/#connect
```

Every number, file name, hash and status on these screens is illustrative. The mock-up calls no service, makes no request beyond its own folder, and dropped files never leave the page. It is reconciled with plan §9.1 (2026-10-22) plus Angelo's terminal addition of the same day.

## Screens

Open a screen from the top nav, or deep-link to it with `#connect`, `#first-render`, `#style`, `#home`, `#editor`, `#rules` or `#render`.

| #   | Screen          | App route         | What it shows                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | --------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Connect Claude  | `/setup`          | Mode cards in order: A, API key (default, Recommended); B, cloud provider (Advanced); C, Claude Code in a terminal (Opt-in; disclosure, consent, "Open terminal to sign in", "Signed in (shown by Claude Code)"). The key field checks only "not empty"; the server's `GET /v1/models` decides: "Checking key…", then works or rejected (401). Doctor table with one-line fixes and a read-only "Embedded database · switch in README" row.                         |
| 1b  | First render    | `/setup`          | The 5 s branded sample render, made with the detected encoder, that ends setup.                                                                                                                                                                                                                                                                                                                                                                                     |
| 1c  | Pick a style    | `/setup/style`    | Style cards (ZKidz, Plain, Loud), each playing the same 5 s sample.                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2   | Home            | `/`               | Drop zone with per-file progress, "Use a file in place" (single files only, native dialog), recent projects (empty and loading states), templates with their ingest mode (single clip, join, showcase).                                                                                                                                                                                                                                                             |
| 3   | Editor          | `/p/:slug`        | Media bin, 9:16 live preview, Activity / Terminal tabs over one run, prompt composer, usage meter, Stop. Terminal: the user's own `claude` in the project folder (session header, prompt, `● mcp__studio__…(…)` lines), in neutral chrome. Approval cards lead with server-derived facts and quote "Claude says" second. Version strip with restore. Four tracks: Video (struck-through proposed cuts, cut ticks, punch-ins, blur marker), Captions, Overlays, SFX. |
| 3b  | Rules           | `/p/:slug/rules`  | User-written rules only, 500-character cap, delete per rule.                                                                                                                                                                                                                                                                                                                                                                                                        |
| 4   | Render & export | `/p/:slug/export` | Target picker (full, reel, covers), per-stage progress with ETA and an encoder chip per job, hardware meters, QC ticks, deliverables with SHA-256, "Open folder" on `ZKS_HOME/projects/<slug>/deliverables/`.                                                                                                                                                                                                                                                       |

## States

The "Mock-up states" menu in the top bar is a prototype control, not part of the product.

- **Agent:** normal · key rejected (re-enter key, Console billing) · terminal signed out (sign in again with `/login` in the terminal) · rate limited (a retry countdown).
- **Key check:** accepts (200) · rejects (401). Any key text is allowed; this switch decides the answer.
- **Render:** GPU · no GPU (CPU profile, 1080p suggestion) · encoder error (one failed chunk, retried alone or on the CPU).
- **Home:** projects · empty · loading.
- **Hostile agent text:** pushes `</script><img src=x onerror=alert(1)>` as narration, a tool label, a tool result and a cue label. It must render literally (plan §9.1 contract test).
- Also covered: the empty key, the empty preview, the idle feed, Stop mid-run, and the light theme from the toggle.

Screenshots of every state are in `screens/` (1440×900, plus 1280×800 and 390-wide).

## Design rules this binds

- **Agent text is text.** Every dynamic string goes through `h()` in `js/core.js`, which only ever creates text nodes. No script in this folder uses `innerHTML`.
- **Colour.** Colour comes only from `tokens.css`, a copy of `design/tokens.css` plus the attribution comment on line 1 (a static server rooted here can't reach `../`; re-copy it when the tokens change). `styles.css` contains no raw hex.
- **Gold.** Gold is the one primary action per screen, plus the single flood band. Steel carries progress, focus and active state. Gold is never text on cream.
- **Depth.** Depth comes from three ground steps and 1px borders. The one shadow is `--shadow-overlay`, on floating menus and the dialog.
- **Type.** Archivo (condensed extrabold for headings) carries the chrome. JetBrains Mono is for timecodes, tool names, logs and the terminal. Both are self-hosted in `fonts/` (fontsource variable builds, OFL; licences alongside). If the files are missing, the token stacks fall back to system fonts.
- **Terminal.** Neutral chrome only: no Claude Code logo, mascot or ASCII art.
- **Motion.** Motion uses `--ease-out` at 160 or 320 ms, and only state changes animate. Tab switches and terminal lines don't animate, because they happen often. The 5 s sample's progress is linear because it is a clock. Under reduced motion, travel, wipes and spinners become fades or stills.
- **Icons.** Icons are Lucide paths (ISC), inlined as an SVG sprite.
- **Footage.** Placeholder footage is a canvas of token-coloured light fields. It contains no real media.

## Files

`index.html` · `styles.css` · `tokens.css` · `fonts/` · `js/` (classic scripts in load order: `core`, `terminal`, `connect`, `doctor`, `sample`, `home`, `timeline`, `preview`, `feed`, `versions`, `run`, `agent-state`, `render-outputs`, `render`, `rules`, `boot`) · `screens/*.png`
