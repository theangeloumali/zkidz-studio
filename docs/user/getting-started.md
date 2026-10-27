<!-- Created by The Angelo Umali. -->

# Getting started

For first-time users. You go from a fresh clone to a rendered demo video. Last reviewed 2026-10-27.

## 1. Install

```bash
git clone https://github.com/theangeloumali/zkidz-studio && cd zkidz-studio && ./setup.sh
```

On Windows run `setup.cmd`, or `powershell -ExecutionPolicy Bypass -File .\setup.ps1`. The script fetches pinned, hash-checked
copies of pnpm and uv, installs the packages, then runs `pnpm zks setup`, which downloads ffmpeg, Chrome and three whisper
models (`tiny`, `base` and `large-v3-turbo-q5_0`, about 800 MB together; transcription uses the turbo one). When it finishes it starts the app. Add `--no-start` to stop before that.

Everything lands in one data folder, `ZKS_HOME`:

| OS            | Default `ZKS_HOME`                           |
| ------------- | -------------------------------------------- |
| Linux and WSL | `~/.local/share/zkidz-studio`                |
| macOS         | `~/Library/Application Support/zkidz-studio` |
| Windows       | `%LOCALAPPDATA%\zkidz-studio`                |

Set `ZKS_HOME` before setup to put it somewhere else.

## 2. Check the machine

```bash
pnpm zks doctor
```

Each line is `ok`, `WARN` or `FAIL`, with a one-line fix under anything that is not ok. A missing GPU is never a failure. See
[troubleshooting](troubleshooting.md).

## 3. Start the app

```bash
pnpm start
```

Open <http://127.0.0.1:4317>. The Setup screen shows the doctor results and the Connect Claude cards. Pick a mode
([connecting Claude](claude-access.md)), then pick a house style ([templates and styles](templates-and-styles.md)). The style
step plays a 5-second sample so you can see what the agent will add.

## 4. Render the demo project

On Home, choose **Try the demo project**. The app builds a 6-second test clip (a test pattern and a tone with a pause), cuts the
pause, adds a hook title, two captions and a keyword chip, and opens the result in the Editor.

The same demo runs from a terminal if you want to see the engine steps:

```bash
export ZKS_FFMPEG=$(pnpm -s zks tools path ffmpeg) ZKS_CHROME=$(pnpm -s zks tools path chrome-headless-shell)
uv run --project packages/engine python examples/demo/make_demo.py
```

The master lands in `ZKS_HOME/projects/demo/work/out/v1.mp4`.

## 5. Edit your own footage

Drag clips anywhere onto Home, or choose "Use files in place" to register a single file without copying it. Open the project,
type what you want in the prompt box, and watch the agent work. [The editor](editor.md) explains what you see.
