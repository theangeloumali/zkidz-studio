# Created by The Angelo Umali.
# The demo project: a generated test clip (no footage needed), the committed specs, and every engine step to a master.
# From the repo root: uv run --project packages/engine python examples/demo/make_demo.py [--project DIR]
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

from zks_engine import ffio
from zks_engine.home import zks_home
from zks_engine.pipeline import FPS, HF_DIR
from zks_engine.specs import cut_spec_to_engine, validate

SPEC_DIR = Path(__file__).resolve().parent / "spec"
VIDEO = "v1"
CLIP_NAME = "demo.mp4"
CLIP_SECONDS = 6
CLIP_SIZE = "540x960"  # small to generate and keep; the engine scales it to 1080x1920
FRAME_RATE = "30000/1001"
# edl.py counts round(duration * fps) source frames; testsrc2 stops one short of that at 29.97, so cap by count instead.
CLIP_FRAMES = round(CLIP_SECONDS * FPS)
# The tone drops out here so the cut spec's one removal reads as a pause; keep it in step with spec/cut-spec.json.
SILENT_GAP = (2.6, 3.4)
# Marks a folder this script made, so a re-run may replace it and nothing else is ever overwritten.
MARKER = ".zks-demo"


class DemoError(RuntimeError):
    """Why the demo could not be built, in words for the person running it."""


def read_spec(name):
    return json.loads((SPEC_DIR / name).read_text(encoding="utf-8"))


def engine_cuts():
    """The committed cut spec in the shape edl.py reads, pointing at the generated clip."""
    return {**cut_spec_to_engine(read_spec("cut-spec.json")), "source": f"media/{CLIP_NAME}"}


def load_cues():
    return validate("cue-sheet", read_spec("cues.json"))


def prepare_project(project):
    """An empty project folder (or one an earlier run made) with media/ and work/ ready."""
    if project.exists() and any(project.iterdir()) and not (project / MARKER).exists():
        raise DemoError(f"{project} already holds other files; pass --project with an empty or new folder")
    for folder in ("media", "work/cuts", "work/cues"):
        (project / folder).mkdir(parents=True, exist_ok=True)
    (project / MARKER).write_text("made by examples/demo/make_demo.py\n", encoding="utf-8")


def generate_clip(target):
    """testsrc2 picture and a 440 Hz tone with a silent gap: no third-party media, and a few hundred KB."""
    gap_start, gap_end = SILENT_GAP
    tone = f"sine=frequency=440:sample_rate=48000:duration={CLIP_SECONDS},volume='if(between(t,{gap_start},{gap_end}),0,0.5)':eval=frame"
    command = [ffio.ffmpeg_bin(), "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
               f"testsrc2=size={CLIP_SIZE}:rate={FRAME_RATE}", "-f", "lavfi", "-i", tone,
               "-frames:v", str(CLIP_FRAMES), "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "64k", str(target)]
    run(command, "generate the demo clip")


def run(command, step, cwd=None, env=None):
    result = subprocess.run(command, cwd=cwd, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", check=False)
    if result.returncode:
        raise DemoError(f"{step} failed: {(result.stderr or result.stdout).strip()[-2000:]}")
    return result


def build(project):
    """Every engine step from the generated clip to work/out/v1.mp4; returns the master's path."""
    project = Path(project).resolve()
    prepare_project(project)
    work = project / "work"
    generate_clip(project / "media" / CLIP_NAME)
    (work / "cuts" / f"{VIDEO}.json").write_text(json.dumps(engine_cuts(), indent=1), encoding="utf-8")
    (work / "cues" / f"{VIDEO}.json").write_text(json.dumps(load_cues(), indent=1), encoding="utf-8")
    env = {**os.environ, "ZKS_WORK": str(work)}
    engine_steps = [
        ("prepare", ["prepare", VIDEO, f"media/{CLIP_NAME}"]),
        ("edl", ["edl", VIDEO]),
        ("audio", ["audio", VIDEO]),
    ]
    for step, (module, *arguments) in engine_steps:
        run([sys.executable, "-m", f"zks_engine.{module}", *arguments], step, cwd=project, env=env)
    run(["node", str(HF_DIR / "render.js"), VIDEO], "overlay render", cwd=work, env=env)
    run([sys.executable, "-m", "zks_engine.render_final", VIDEO], "render_final", cwd=project, env=env)
    return work / "out" / f"{VIDEO}.mp4"


def main(argv=None):
    parser = argparse.ArgumentParser(description="Render the no-footage demo project.")
    parser.add_argument("--project", type=Path, default=zks_home() / "projects" / "demo", help="project folder (default: ZKS_HOME/projects/demo)")
    args = parser.parse_args(argv)
    try:
        print(f"rendered {build(args.project)}")
    except DemoError as error:
        sys.exit(str(error))


if __name__ == "__main__":
    main()
