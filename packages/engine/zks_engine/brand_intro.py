# Created by The Angelo Umali.
# The ZKidz brand intro on its own, for a video without a hook (a vlog): the 2 s pre-roll and the Z-split as RGBA frames in
# the orientation's layout, plus the pre-roll's own track.
# Usage: python -m zks_engine.brand_intro --orientation landscape --fps 30000/1001 --out DIR
#   → DIR/preroll/%05d.png (opaque), DIR/split/%05d.png (RGBA, ends clear), DIR/intro.wav, DIR/intro.json
import argparse
import json
import subprocess
from pathlib import Path

from . import sfx
from .pipeline import HF_DIR


def render(orientation, fps, out):
    out.mkdir(parents=True, exist_ok=True)
    subprocess.run(["node", str(HF_DIR / "render.js"), "--brand-intro", orientation, "--fps", fps, "--out", str(out)], check=True)
    num, den = (int(value) for value in fps.split("/"))
    sfx.mix_intro(out / "intro.wav", json.loads((out / "intro.json").read_text(encoding="utf-8")), {"fps_num": num, "fps_den": den})


def rate(value):
    """A frame rate as N/D (30000/1001), checked before the render rather than after it."""
    num, _, den = value.partition("/")
    if not (num.isdigit() and den.isdigit() and int(num) > 0 and int(den) > 0):
        raise argparse.ArgumentTypeError(f"--fps is N/D, e.g. 30000/1001, not {value}")
    return value


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Render the ZKidz brand intro for a video without a hook.")
    parser.add_argument("--orientation", choices=["landscape", "portrait"], required=True)
    parser.add_argument("--fps", type=rate, required=True, help="the video's frame rate as N/D, e.g. 30000/1001")
    parser.add_argument("--out", type=Path, required=True)
    arguments = parser.parse_args()
    render(arguments.orientation, arguments.fps, arguments.out.resolve())
