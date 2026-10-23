# Created by The Angelo Umali.
# HyperFrames render: hf/render.js writes exactly one transparent 1080x1920 PNG per edited frame under frames/<video>/
# (the render_final.py contract), the gallery draws every brand kind, review stills composite on the proxy, and the
# gallery's SFX events are the canvas page's own.
# Skips without node, ffmpeg, system Chrome or the pinned CLI (pnpm install at the repo root).
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import wave
from pathlib import Path

import numpy as np
from support import ENGINE, GALLERY, GALLERY_FRAMES, HYPERFRAMES_SKIP, fixture_media, make_edl, needs_renderer, write_sheet, has_ffmpeg  # first: it sets a scratch ZKS_HOME

from zks_engine import doctor
from zks_engine.render_final import PNG_RGBA, png_header

TINY_CUES = [{"kind": "keyword", "at": 0.2, "end": 1.8, "text": "Tiny", "tone": "paper"}]
OPENER_CUES = [{"kind": "hookTitle", "at": 0, "end": 3, "intro": True, "kicker": "How I ask", "lines": ["From $12", "to $25."], "accentLine": 1}]
CANVAS_GALLERY_EVENTS = ENGINE / "tests" / "fixture" / "sfx" / "gallery-canvas.json"


def hyperframes_ready():
    # The file check first: it is free, and doctor.check_chrome launches Chrome.
    return bool((ENGINE / "hf" / "node_modules" / "hyperframes" / "package.json").exists() and shutil.which("node")
                and has_ffmpeg() and doctor.check_chrome()[0])


def rgba(png, shape=(1920, 1080)):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(png), "-f", "rawvideo", "-pix_fmt", "rgba", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.uint8).reshape(*shape, 4).astype(np.int16)


def pixel(png, x, y):
    return subprocess.run(["ffmpeg", "-v", "error", "-i", str(png), "-vf", f"crop=1:1:{x}:{y},format=rgba", "-f", "rawvideo", "-"],
                          capture_output=True, check=True).stdout


@needs_renderer(hyperframes_ready(), HYPERFRAMES_SKIP)
class HyperFramesRenderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder = tempfile.TemporaryDirectory()
        cls.work = Path(cls.folder.name) / "work"
        fixture_media(cls.folder.name)
        for name in ("edl", "cues", "mezz"):
            (cls.work / name).mkdir(parents=True)
        gallery = {**make_edl([(0, GALLERY_FRAMES)]), "bleeps": [{"at": 25.0, "end": 25.4, "x": 540, "y": 960}],
                   "cutaways": [{"at": 42.0, "end": 44.0, "title": "Quick context", "sub": "the camera moves"}]}
        (cls.work / "edl" / "gallery.json").write_text(json.dumps(gallery), encoding="utf-8")
        # The canvas page reads the same EDL as a script (edl.py writes both).
        (cls.work / "edl" / "gallery.js").write_text(f"window.EDL = {json.dumps(gallery)};\n", encoding="utf-8")
        (cls.work / "edl" / "tiny.json").write_text(json.dumps(make_edl([(0, 60)])), encoding="utf-8")
        write_sheet(cls.work, "gallery", GALLERY)
        write_sheet(cls.work, "tiny", TINY_CUES)
        (cls.work / "edl" / "opener.json").write_text(json.dumps(make_edl([(0, 90)])), encoding="utf-8")
        write_sheet(cls.work, "opener", OPENER_CUES)
        # compositeStill needs a proxy to seek into: a flat 1080x1920 clip as long as the gallery edit.
        subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=gray:size=1080x1920:rate=30000/1001:duration=97.1",
                        "-c:v", "libx264", "-preset", "ultrafast", "-g", "300", str(cls.work / "mezz" / "gallery.mp4")], check=True)

    @classmethod
    def tearDownClass(cls):
        cls.folder.cleanup()

    def render(self, target, *args):
        return subprocess.run(["node", str(ENGINE / "hf" / "render.js"), target, *args], cwd=self.work,
                              env={**os.environ, "ZKS_WORK": str(self.work)}, capture_output=True, text=True,
                              encoding="utf-8", errors="replace", timeout=900)

    def test_frames_are_one_transparent_png_per_edited_frame(self):
        result = self.render("tiny")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        pngs = sorted(path.name for path in (self.work / "frames" / "tiny").iterdir())
        self.assertEqual(pngs, [f"{index:05d}.png" for index in range(60)])
        self.assertEqual(pixel(self.work / "frames" / "tiny" / "00030.png", 5, 5), bytes(4))  # untouched corner: clear
        self.assertFalse((self.work / "frames" / "tiny.hf").exists())

    def test_the_brand_intro_is_two_opaque_seconds_that_end_on_the_splits_first_frame(self):
        # sfx.py's insert, written by hand: the split goes over the edit from frame 45.
        self.assertEqual(self.render("opener", "--events").returncode, 0)
        events = self.work / "edl" / "opener.sfx.json"
        payload = json.loads(events.read_text(encoding="utf-8"))
        events.write_text(json.dumps({**payload, "intro": {**payload["intro"], "at": 45}}), encoding="utf-8")
        result = self.render("opener")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads((self.work / "frames" / "opener.insert.json").read_text(encoding="utf-8")), {"at": 45})
        intro = self.work / "frames" / "opener.intro"
        self.assertEqual(sorted(path.name for path in intro.iterdir()), [f"{index:05d}.png" for index in range(60)])
        for index in (0, 30, 59):
            self.assertTrue((rgba(intro / f"{index:05d}.png")[..., 3] == 255).all(), f"pre-roll frame {index} is not opaque")
        # Opaque frames are still stored as RGBA, or render_final's PNG input changes format mid-chunk.
        for png in [*intro.iterdir(), *(self.work / "frames" / "opener").iterdir()]:
            self.assertEqual(png.read_bytes()[25], 6, f"{png.parent.name}/{png.name} is not RGBA")
        last, first = rgba(intro / "00059.png"), rgba(self.work / "frames" / "opener" / "00045.png")
        self.assertTrue((first[..., 3] == 255).all(), "the split's first frame lets footage through")
        self.assertLess(np.abs(last - first).mean(), 1.0, "the pre-roll's last frame and the split's first differ")
        # The opaque halves have left by INTRO.split, each off its own side of the cut (the hook's light leak is translucent).
        after = rgba(self.work / "frames" / "opener" / "00065.png")[..., 3]
        self.assertLess(after[:200, :40].max(), 128, "the upper half is still on frame")
        self.assertLess(after[1700:, 1000:].max(), 128, "the lower half is still on frame")

    def test_the_brand_intro_alone_renders_a_pre_roll_and_a_split_that_ends_clear(self):
        for orientation, (width, height) in (("landscape", (1920, 1080)), ("portrait", (1080, 1920))):
            with self.subTest(orientation):
                out = self.work / f"brand-intro-{orientation}"
                result = subprocess.run([sys.executable, "-m", "zks_engine.brand_intro", "--orientation", orientation, "--fps", "30000/1001",
                                         "--out", str(out)], cwd=self.work, env={**os.environ, "ZKS_WORK": str(self.work)},
                                        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=900)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertEqual(json.loads((out / "intro.json").read_text(encoding="utf-8"))["frames"], 60)
                preroll, split = sorted((out / "preroll").iterdir()), sorted((out / "split").iterdir())
                self.assertEqual((len(preroll), len(split)), (60, 16))
                for png in (*preroll, *split):
                    self.assertEqual(png_header(png), (width, height, PNG_RGBA), png.name)
                last, first = rgba(preroll[-1], (height, width)), rgba(split[0], (height, width))
                self.assertTrue((last[..., 3] == 255).all(), "the pre-roll lets the video through")
                self.assertLess(np.abs(last - first).mean(), 1.0, "the pre-roll's last frame and the split's first differ")
                self.assertEqual(rgba(split[-1], (height, width))[..., 3].max(), 0, "the split's last frame still covers the video")
                with wave.open(str(out / "intro.wav")) as track:
                    self.assertEqual(track.getnframes(), 96096)

    def test_gallery_draws_every_brand_kind_and_composites_stills(self):
        registry = subprocess.run(["node", "-e", f"console.log(JSON.stringify(Object.keys(require({json.dumps(str(ENGINE / 'hf' / 'components'))}).REGISTRY)))"],
                                  capture_output=True, text=True, check=True).stdout
        result = self.render("gallery", "--stills", "auto")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        placed = json.loads((self.work / "hf" / "gallery.stills" / "cues.json").read_text(encoding="utf-8"))
        self.assertEqual(sorted({cue["kind"] for cue in placed}), sorted(json.loads(registry)))
        stills = list((self.work / "stills" / "gallery.hf").glob("t*.png"))
        # One still per distinct settle time (the 0.22 s exit plus 0.1 s before each non-caption cue leaves), deduped.
        settled = {round(max(cue["start"] + (cue["stop"] - cue["start"]) / 2, cue["stop"] - 0.32), 2) for cue in placed if cue["kind"] != "caption"}
        self.assertEqual(len(stills), len(settled))
        self.assertFalse((self.work / "hf" / "gallery").exists(), "stills must not write the folder a frame render reads")

    def test_gallery_sounds_are_the_canvas_pages_through_the_effects_sound_design(self):
        # The canvas renderer is not shipped here: its --events output for this gallery is a recorded fixture.
        canvas_events = json.loads(CANVAS_GALLERY_EVENTS.read_text(encoding="utf-8"))
        result = self.render("gallery", "--events")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        hf_events = json.loads((self.work / "edl" / "gallery.sfx.json").read_text(encoding="utf-8"))
        self.assertTrue(canvas_events["events"])
        self.assertEqual(hf_events["frames"], canvas_events["frames"])
        hf = [(event["time"], event["sound"]) for event in hf_events["events"]]
        # Word-timed sounds keep their canvas times; card swishes, exits and the stamp thud are redesigned (hf/fx/sound.js).
        swaps = {"swish": "flyIn", "swishOut": "whipOut", "thud": "boom"}
        for event in canvas_events["events"]:
            sound = swaps.get(event["sound"], event["sound"])
            near = [time for time, name in hf if name == sound and abs(time - event["time"]) <= 0.2]
            self.assertTrue(near, f"{event['kind']} {event['sound']} at {event['time']:.3f}: no {sound} within 0.2 s")
        extras = {name for name in {name for _, name in hf} - {swaps.get(e["sound"], e["sound"]) for e in canvas_events["events"]}}
        self.assertEqual(extras, {"shimmer"})
        # Every sound the design emits has a recipe in sfx.py.
        from zks_engine import sfx
        self.assertFalse({name for _, name in hf} - set(sfx.RECIPES))


if __name__ == "__main__":
    unittest.main()
