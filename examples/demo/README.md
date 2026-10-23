<!-- Created by The Angelo Umali. -->

# Demo project

A first edit that needs no footage. `make_demo.py` generates a 6-second test clip with ffmpeg (`testsrc2` picture, a 440 Hz
tone with a pause in it), applies the committed specs and runs every engine step to a 1080×1920 master.

```bash
pnpm zks setup                                   # once: the pinned ffmpeg and Chrome
export ZKS_FFMPEG=$(pnpm -s zks tools path ffmpeg) ZKS_CHROME=$(pnpm -s zks tools path chrome-headless-shell)
uv run --project packages/engine python examples/demo/make_demo.py
```

The project lands in `ZKS_HOME/projects/demo` (pass `--project <folder>` for another empty folder) and the master in its
`work/out/v1.mp4`. A re-run replaces an earlier demo; it refuses a folder that holds anything else.

## What is in it

| File                 | What it shows                                                                  |
| -------------------- | ------------------------------------------------------------------------------ |
| `spec/cut-spec.json` | A cut spec (the `CutSpec` contract) with one pinned removal over the pause     |
| `spec/cues.json`     | A cue sheet: hook title, two captions and a keyword chip, in source seconds    |
| `make_demo.py`       | The clip generator and the engine steps: prepare, EDL, audio, overlays, master |
| `test_make_demo.py`  | Spec checks, and a full render when ffmpeg, node and the renderer are present  |

Tests, from the repo root:

```bash
uv run --project packages/engine python -m unittest discover -s examples/demo
```
