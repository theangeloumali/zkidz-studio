<!-- Created by The Angelo Umali. -->

# zks-engine

The ZKidz Studio render engine, managed by uv. Python owns the edit (EDL, audio, captions, blur, GPU masters); `hf/` is the
HyperFrames overlay renderer, a Node package with its own lockfile.

```bash
uv sync --project packages/engine
uv run --project packages/engine zks-engine version --json
uv run --project packages/engine zks-engine probe --json <media file>
uv run --project packages/engine python -m unittest discover -s packages/engine/tests
pnpm install                         # at the repo root: also installs the overlay renderer (hf/)
```

The project installs editable: the engine finds `hf/` next to `zks_engine/`.

## Environment

| Variable                                  | Default                                                                                                                     |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `ZKS_HOME`                                | the OS data dir: `~/.local/share/zkidz-studio`, `~/Library/Application Support/zkidz-studio`, `%LOCALAPPDATA%\zkidz-studio` |
| `ZKS_WORK`                                | the current directory (a project's `work/`)                                                                                 |
| `ZKS_MODELS`, `ZKS_LOCKS`, `ZKS_PROGRESS` | `ZKS_HOME/models`, `ZKS_HOME/locks`, `ZKS_HOME/progress`                                                                    |
| `ZKS_JOBS`                                | 2 concurrent ffmpeg/whisper jobs                                                                                            |

## Media input policy

Every ffmpeg and ffprobe call on user media goes through `zks_engine/ffio.py`: only the `file` and `pipe` protocols, a container
whitelist, and a content sniff that rejects playlists, concat lists and URLs whatever the file is named. Engine-written concat lists
escape `'` so a home folder such as `O'Brien` still renders.

Imported from the zkidz-films engine. The traps it encodes (frame identity, packet-time chunk seeks, frame-rate declared looping
inputs) are load-bearing: read `render_final.py` and `edl.py` before simplifying anything there.
