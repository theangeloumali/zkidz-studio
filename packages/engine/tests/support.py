# Created by The Angelo Umali.
# Shared by the engine tests: scratch ZKS_HOME, hand-made EDLs and scratch work dirs.
import functools
import json
import os
import shutil
import tempfile
import unittest
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
# Every HyperFrames brand kind once, for the gallery stills, parity sheets and coverage test (test_hf_render.py). Its EDL is
# one uncut segment (0-97 s), so source seconds are edited seconds; it also derives a censor (bleep at 25.0) and a cutaway (42-44 s).
GALLERY = ENGINE / "tests" / "fixture" / "cues" / "hf-gallery.json"
FIXTURE_MEDIA = ENGINE / "tests" / "fixture" / "images"
GALLERY_FRAMES = 2908  # 97 s: every gallery cue fits
HF_SKIP = "needs node and the overlay renderer's packages (pnpm install at the repo root)"
HYPERFRAMES_SKIP = "needs node, ffmpeg, Chrome and the overlay renderer's packages (pnpm install at the repo root)"


def hf_installed():
    return bool(shutil.which("node") and (HF / "node_modules" / "fontkit" / "package.json").exists())


def needs_renderer(ready, reason=HF_SKIP):
    """skipUnless for the overlay renderer tests; ZKS_REQUIRE_HF=1 (CI) fails them instead, so they cannot quietly stop running."""

    def missing():
        if os.environ.get("ZKS_REQUIRE_HF") == "1":
            raise AssertionError(f"ZKS_REQUIRE_HF=1 but the test {reason}")
        raise unittest.SkipTest(reason)

    def decorate(item):
        if ready:
            return item
        if isinstance(item, type):
            item.setUpClass = classmethod(lambda cls: missing())
            return item

        @functools.wraps(item)
        def guarded(*args, **kwargs):
            missing()

        return guarded

    return decorate


def media_file(name="clip.mp4"):
    """A binary stand-in for user media under ZKS_HOME: ffio's sniff passes it; only a mocked ffmpeg/ffprobe reads it."""
    path = Path(os.environ["ZKS_HOME"]) / "media" / name
    path.parent.mkdir(exist_ok=True)
    path.write_bytes(b"\x00\x00\x00\x18ftypmp42" + bytes(64))
    return path


def playlist_file(name="playlist.mp4"):
    """An HLS playlist renamed .mp4: the input policy must refuse it before ffmpeg runs."""
    path = Path(os.environ["ZKS_HOME"]) / "media" / name
    path.parent.mkdir(exist_ok=True)
    path.write_text("#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:1.0,\nfile:///etc/hostname\n", encoding="utf-8")
    return path


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


def write_sheet(work, name, cues):
    """cues/<name>.json in `work`: `cues` is a list of cues (or patches), or a JSON file to copy."""
    sheet = Path(work) / "cues" / f"{name}.json"
    sheet.parent.mkdir(exist_ok=True)
    sheet.write_bytes(cues.read_bytes()) if isinstance(cues, Path) else sheet.write_text(json.dumps(cues), encoding="utf-8")


def scratch_work(folder, name, edl_spec, cues):
    """`folder`/work as a work dir with edl/<name>.json and cues/<name>.json (see write_sheet).
    `folder` stands in for the repo root, holding the fixture images at media/fixture/."""
    work = Path(folder) / "work"
    work.mkdir(exist_ok=True)
    fixture_media(folder)
    for sub in ("edl", "cues"):
        (work / sub).mkdir(exist_ok=True)
    (work / "edl" / f"{name}.json").write_text(json.dumps(edl_spec), encoding="utf-8")
    write_sheet(work, name, cues)
    return work
