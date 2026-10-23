# Created by The Angelo Umali.
# Depth layers: a cue with depth "behind" draws only in the second pass (render.js --layer behind → frames/<v>.behind/),
# which the person matte composites under him. The normal pass skips those cues; the behind pass skips captions, every
# other cue and the brand intro. Plus the three matte kinds: backdrop, paperCutout and frameEscape.
import json
import os
import subprocess
import tempfile
import time
import unittest

from support import ENGINE, HYPERFRAMES_SKIP, hf_installed, make_edl, needs_renderer, scratch_work  # first: it sets a scratch ZKS_HOME
from test_hf_bridge import assert_seek_safe, build, clip_markup, tweens
from test_hf_render import hyperframes_ready, rgba

LAYER_CUES = [
    {"kind": "keyword", "at": 0.2, "end": 1.6, "text": "Front", "tone": "paper"},
    {"kind": "backdrop", "at": 0.5, "end": 2.5, "depth": "behind", "src": "media/fixture/backdrop.png", "fit": "cover"},
    {"kind": "frameEscape", "at": 2.6, "end": 4.5, "depth": "behind", "x": 140, "y": 420, "w": 800, "h": 900, "tilt": -4},
    {"kind": "paperCutout", "at": 1.0, "end": 3.0, "src": "media/fixture/cutout.png", "x": 760, "y": 1100, "scale": 0.45, "rot": 6},
    {"kind": "caption", "at": 0.2, "end": 2.0, "depth": "behind", "text": "Captions stay in front"},
]
HOOK = {"kind": "hookTitle", "at": 0, "end": 2, "intro": True, "depth": "behind", "kicker": "Posts", "lines": ["Posts itself."], "accentLine": 0}
INTRO_CUES = [HOOK, {"kind": "keyword", "at": 2.5, "end": 4, "text": "Front", "tone": "paper"}]
MISSING_CUES = [{"kind": "backdrop", "at": 0.5, "end": 2, "src": "media/fixture/nope.png"}]


def kinds(work, folder):
    return sorted(cue["kind"] for cue in json.loads((work / "hf" / folder / "cues.json").read_text(encoding="utf-8")))


@needs_renderer(hf_installed())
class LayerFilterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder = tempfile.TemporaryDirectory()
        cls.work = scratch_work(cls.folder.name, "depth", make_edl([(0, 150)]), LAYER_CUES)
        cls.front = build(cls.work, "depth", "--events")
        cls.behind = build(cls.work, "depth", "--layer", "behind")

    @classmethod
    def tearDownClass(cls):
        cls.folder.cleanup()

    def test_the_normal_pass_skips_every_behind_cue(self):
        self.assertEqual(self.front.returncode, 0, self.front.stderr)
        self.assertEqual(kinds(self.work, "depth"), ["caption", "keyword", "paperCutout"])

    def test_the_behind_pass_draws_only_behind_cues_and_no_captions(self):
        self.assertEqual(self.behind.returncode, 0, self.behind.stderr)
        self.assertEqual(kinds(self.work, "depth.behind"), ["backdrop", "frameEscape"])

    def test_sounds_come_from_every_cue_whatever_its_layer(self):
        from zks_engine import sfx
        events = json.loads((self.work / "edl" / "depth.sfx.json").read_text(encoding="utf-8"))["events"]
        self.assertTrue({"backdrop", "frameEscape", "paperCutout"} <= {event["kind"] for event in events})
        self.assertFalse({event["sound"] for event in events} - set(sfx.RECIPES))

    def test_images_ship_inside_the_composition(self):
        front = (self.work / "hf" / "depth" / "index.html").read_text(encoding="utf-8")
        behind = (self.work / "hf" / "depth.behind" / "index.html").read_text(encoding="utf-8")
        self.assertIn('src="media/', front)
        self.assertIn('src="media/', behind)
        self.assertTrue(list((self.work / "hf" / "depth" / "media").glob("*cutout.png")))
        self.assertTrue(list((self.work / "hf" / "depth.behind" / "media").glob("*backdrop.png")))

    def test_the_cutout_has_a_dilated_white_outline_and_a_shadow(self):
        front = (self.work / "hf" / "depth" / "index.html").read_text(encoding="utf-8")
        cue = next(cue for cue in json.loads((self.work / "hf" / "depth" / "cues.json").read_text(encoding="utf-8")) if cue["kind"] == "paperCutout")
        markup = clip_markup(front, cue["id"])
        self.assertIn("feMorphology", markup)
        self.assertIn('operator="dilate"', markup)
        self.assertIn("feDropShadow", markup)

    def test_every_tween_in_both_layers_is_seek_safe(self):
        for folder in ("depth", "depth.behind"):
            with self.subTest(folder):
                assert_seek_safe(self, tweens((self.work / "hf" / folder / "index.html").read_text(encoding="utf-8")))

    def test_an_unknown_layer_is_refused(self):
        result = build(self.work, "depth", "--layer", "under")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("behind", result.stderr)


@needs_renderer(hf_installed())
class LayerIntroTests(unittest.TestCase):
    """A behind hook still places the brand intro, but only the normal pass carries the pre-roll and the split."""

    def test_the_behind_pass_has_no_brand_intro(self):
        with tempfile.TemporaryDirectory() as folder:
            work = scratch_work(folder, "hook", make_edl([(0, 150)]), INTRO_CUES)
            self.assertEqual(build(work, "hook", "--events").returncode, 0)
            self.assertTrue((work / "hf" / "hook.intro" / "index.html").exists())
            behind = build(work, "hook", "--layer", "behind")
            self.assertEqual(behind.returncode, 0, behind.stderr)
            self.assertEqual(kinds(work, "hook.behind"), ["hookTitle"])
            self.assertEqual(kinds(work, "hook"), ["keyword"])
            # The behind pass leaves the normal pass's pre-roll alone.
            self.assertTrue((work / "hf" / "hook.intro" / "index.html").exists())
            self.assertFalse((work / "hf" / "hook.behind.intro").exists())

    def test_a_missing_image_fails_and_names_it(self):
        with tempfile.TemporaryDirectory() as folder:
            work = scratch_work(folder, "missing", make_edl([(0, 90)]), MISSING_CUES)
            result = build(work, "missing")
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("media/fixture/nope.png", result.stderr)


@needs_renderer(hyperframes_ready(), HYPERFRAMES_SKIP)
class BehindRenderTests(unittest.TestCase):
    def render(self, target, *args):
        return subprocess.run(["node", str(ENGINE / "hf" / "render.js"), target, *args], cwd=self.work,
                              env={**os.environ, "ZKS_WORK": str(self.work)}, capture_output=True, text=True,
                              encoding="utf-8", errors="replace", timeout=900)

    @classmethod
    def setUpClass(cls):
        cls.folder = tempfile.TemporaryDirectory()
        cls.work = scratch_work(cls.folder.name, "depth", make_edl([(0, 150)]), LAYER_CUES)
        (cls.work / "mezz").mkdir()
        subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=gray:size=1080x1920:rate=30000/1001:duration=5.1",
                        "-c:v", "libx264", "-preset", "ultrafast", str(cls.work / "mezz" / "depth.mp4")], check=True)

    @classmethod
    def tearDownClass(cls):
        # HyperFrames' Chrome can outlive the render by a moment, holding the work dir open on Windows.
        for _ in range(20):
            try:
                return cls.folder.cleanup()
            except PermissionError:
                time.sleep(0.5)
        cls.folder.cleanup()

    def test_the_behind_pass_writes_one_png_per_edited_frame(self):
        result = self.render("depth", "--layer", "behind")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        behind = self.work / "frames" / "depth.behind"
        self.assertEqual(sorted(path.name for path in behind.iterdir()), [f"{index:05d}.png" for index in range(150)])
        self.assertFalse((self.work / "frames" / "depth").exists(), "the behind pass wrote the normal pass's frames")
        # The backdrop covers the whole frame while it holds (1.5 s), and the sheet's paper fills the frame edge at 3.5 s.
        self.assertTrue((rgba(behind / "00045.png")[..., 3] == 255).all(), "the backdrop lets footage through")
        sheet = rgba(behind / "00105.png")[..., 3]
        self.assertEqual(sheet[5, 5], 255)
        self.assertEqual(sheet[960, 540], 0, "the frame escape's window is not clear")
        # Captions never draw behind him: before the backdrop the frame is clear.
        self.assertEqual(rgba(behind / "00010.png")[..., 3].max(), 0)

    def test_behind_stills_composite_only_that_layer_on_the_proxy(self):
        result = self.render("depth", "--stills", "1.5", "3.5", "--layer", "behind")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("kinds drawn: backdrop, frameEscape", result.stdout)
        stills = self.work / "stills" / "depth.hf.behind"
        self.assertEqual(sorted(path.name for path in stills.iterdir()), ["t1.5.png", "t3.5.png"])
        # The window shows the gray proxy; the sheet round it is paper.
        sheet = rgba(stills / "t3.5.png")
        self.assertTrue((abs(sheet[960, 540, :3] - 128) <= 3).all(), sheet[960, 540])
        self.assertGreater(sheet[5, 5, :3].min(), 200)


if __name__ == "__main__":
    unittest.main()
