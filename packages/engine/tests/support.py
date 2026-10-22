# Created by The Angelo Umali.
# Shared by the engine tests: scratch ZKS_HOME, hand-made EDLs and scratch work dirs.
import json
import os
import shutil
import tempfile
from pathlib import Path

ENGINE = Path(__file__).resolve().parents[1]
HF = ENGINE / "hf"
# Test runs keep locks, progress and models in a scratch ZKS_HOME and never pop a toast; child processes inherit both.
os.environ["ZKS_HOME"] = tempfile.mkdtemp(prefix="zks-home-")
for name in ("ZKS_LOCKS", "ZKS_PROGRESS", "ZKS_MODELS"):
    os.environ.pop(name, None)
os.environ["ZKS_TOASTS"] = "0"

from zks_engine import edl  # noqa: E402

NTSC = {"fps_num": 30000, "fps_den": 1001}
GALLERY = ENGINE / "tests" / "fixture" / "cues" / "hf-gallery.js"
FIXTURE_MEDIA = ENGINE / "tests" / "fixture" / "images"
GALLERY_FRAMES = 2908  # 97 s: every gallery cue fits
HF_SKIP = "needs node and the overlay renderer's packages (npm ci --prefix packages/engine/hf)"


def hf_installed():
    return bool(shutil.which("node") and (HF / "node_modules" / "fontkit" / "package.json").exists())


def seconds(frames):
    return frames * NTSC["fps_den"] / NTSC["fps_num"]


def make_edl(ranges, zooms=None):
    segments, target = [], 0
    for index, (start, end) in enumerate(ranges):
        zoom = zooms[index] if zooms else 1.0
        segments.append({"in": start, "out": end, "target": target, "zoom": zoom, "cut_after": "pause"})
        target += end - start
    return {**NTSC, "frames": target, "segments": segments, "punch_crop": edl.PUNCH_CROP, "bleeps": [], "cutaways": []}


def fixture_media(root):
    """The fixture images cue sheets name by repo-relative path (media/fixture/), copied under `root`."""
    shutil.copytree(FIXTURE_MEDIA, Path(root) / "media" / "fixture", dirs_exist_ok=True)


def scratch_work(folder, name, edl_spec, cues):
    """`folder`/work as a work dir with edl/<name>.json and cues/<name>.js: `cues` is a sheet's text, or a file to copy.
    `folder` stands in for the repo root, holding the fixture images at media/fixture/."""
    work = Path(folder) / "work"
    work.mkdir(exist_ok=True)
    fixture_media(folder)
    for sub in ("edl", "cues"):
        (work / sub).mkdir(exist_ok=True)
    (work / "edl" / f"{name}.json").write_text(json.dumps(edl_spec), encoding="utf-8")
    sheet = work / "cues" / f"{name}.js"
    sheet.write_bytes(cues.read_bytes()) if isinstance(cues, Path) else sheet.write_text(cues, encoding="utf-8")
    return work
