<!-- Created by The Angelo Umali. -->

# The editor

For anyone working on a project. The editor is where you prompt the agent and watch it build. Last reviewed 2026-10-24.

```text
┌ media bin ┬──────── 9:16 preview ────────┬ agent pane ───────────┐
│ clips     │  proxy video + live overlays │ feed · cards · prompt │
├───────────┴──────────────────────────────┴───────────────────────┤
│ versions  v1 v2 v3        [Restore v2]                           │
│ timeline  Video │ Captions │ Overlays │ SFX        [-] [+] zoom   │
└──────────────────────────────────────────────────────────────────┘
```

## Prompt and feed

Type what you want ("cut this to 60 seconds, caption every line") and press send. The feed shows each step as it happens: what
the agent read, the specs it wrote, and its notes. It stops for you in two cases:

- A question card asks you to pick an option.
- An approval card asks before anything that costs time or money, such as a render or an export. The card leads with facts the
  server worked out (for example, estimated GPU minutes and the files it will write), not the agent's description.

**Stop** interrupts the current turn and keeps the session. In mode A the usage meter shows an estimated cost for the turn and the
project.

## Live preview

The preview plays a 1080×1920 proxy of your footage with the edit applied: removed parts are skipped, punch-ins and blur boxes
are drawn live, and titles and captions render on top. Nothing is rendered to a file. When the agent changes a spec, the preview
rebuilds and returns to the same moment, usually within a few seconds.

## Timeline

Four tracks: Video (shots, struck-through cuts, punch-in and blur markers), Captions, Overlays and SFX. New items wipe in when the
agent adds them.

- Zoom with the **+** and **−** buttons in the timeline header.
- Seek by pressing on the ruler or an empty part of a lane. Drag to scrub.

## Versions

Every spec the agent writes is a new version, listed as `v1`, `v2`, ... above the timeline. Pick an older one to preview it, then
**Restore** it to make it the latest. Restoring adds a new version; nothing is deleted.

## Cut review

When the agent proposes cuts (retakes, long pauses, filler), a **Proposed cuts** card appears in the feed and a chip sits on the
Video track at each cut. Hover a chip to see the reason and the words it removes. Press ✓ to approve or ✗ to reject each one; the
agent applies only the cuts you approved.

## Terminal pane (mode T)

In terminal mode the agent pane gains a terminal tab running your installed Claude Code. Sign in with `/login` there if asked.
If the terminal closes, the pane shows its exit code and a **Restart** button. Reopening the project resumes its session.
