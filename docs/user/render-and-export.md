<!-- Created by The Angelo Umali. -->

# Render, covers, export and checks

For anyone finishing an edit. Covers the Render screen at `/p/<project>/render`. Last reviewed 2026-10-24.

## Start a render

Ask the agent to render ("render the full edit and the Reels cut"). It shows an approval card with the estimated GPU minutes and
the files it will write. Approve it and the job starts. Open the Render screen from the Editor to follow it.

The Render screen shows:

- each stage with its progress, ETA and the backend in use (for example `nvidia` or `cpu`);
- hardware meters for GPU, encoder and CPU use;
- the checks, ticked as they pass;
- the deliverables, each with its SHA-256, and **Open folder**.

Cancelling a render leaves a job you can resume. On a machine with no hardware encoder, the screen says so and offers
**Render 1080p instead**, because a 4K CPU render takes a long time.

## Covers

The agent makes two covers for the full edit (A and B) and two for the Reels cut. Covers use the edit's opening hook title, and
any blur boxes in the edit are applied to them too.

## Checks

Every master is checked before it can be exported. A failed check blocks the export until a new master passes.

| Check                   | Fails when                                                   |
| ----------------------- | ------------------------------------------------------------ |
| Format                  | The master is not the expected size, codec or frame rate     |
| Frame count             | The master's frame count differs from the edit's             |
| Loudness                | The mix is outside −14 LUFS ±1                               |
| Moving footage          | Camera footage froze while the original was moving           |
| Words at cuts           | A word is clipped at a cut (the master is transcribed again) |
| Caption contrast        | A caption is hard to read against the picture behind it      |
| Hook clear of the mouth | Something covers the mouth in the opening seconds            |
| Lip sync                | Audio and picture drift apart at a cut                       |

The Reels cut gets its own set, labelled "Reels:". If a master changes after its check ran, the check shows as pending again.

## Export

Approve the export card and the app copies the passed masters, covers and caption into the project's deliverables folder. See
[deliverables](deliverables.md).
