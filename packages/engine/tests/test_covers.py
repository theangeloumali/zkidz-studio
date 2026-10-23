# Created by The Angelo Umali.
# make_covers: stills skip the render's blur, so every cover gets the cut spec's boxes active at its frame (plan §7.6).
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

import numpy as np

from support import has_ffmpeg, make_edl, seconds  # first: it sets a scratch ZKS_HOME

from zks_engine import covers, ffio
from zks_engine.specs.gates import GateFailed

EDL = make_edl([(0, 60), (90, 180)])
BOX = (300, 600, 400, 300)
LEGACY_BLUR = [[seconds(95), seconds(120), *BOX, "a stranger's photo"]]


def read_rgb(path):
    raw = subprocess.run([ffio.ffmpeg_bin(), "-v", "error", "-i", str(path), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(1920, 1080, 3).astype(np.float32)


def detail(pixels, box):
    x, y, w, h = box
    return float(np.abs(np.diff(pixels[y:y + h, x:x + w], axis=1)).mean())


class BoxTests(unittest.TestCase):
    def test_an_edited_time_maps_to_the_source_second_it_shows(self):
        self.assertAlmostEqual(covers.source_seconds(seconds(70), EDL), seconds(100))

    def test_only_boxes_live_at_the_cover_frame_apply(self):
        self.assertEqual(covers.active_boxes({"blur": LEGACY_BLUR}, seconds(100)), [BOX])
        self.assertEqual(covers.active_boxes({"blur": LEGACY_BLUR}, seconds(10)), [])

    def test_json_cut_specs_name_their_boxes_too(self):
        spec = {"blurBoxes": [{"at": seconds(95), "end": seconds(120), "x": 300, "y": 600, "w": 400, "h": 300, "reason": "r"}]}
        self.assertEqual(covers.active_boxes(spec, seconds(100)), [BOX])

    def test_cover_names_run_a_b_c(self):
        self.assertEqual([covers.cover_name("v1", index) for index in range(3)], ["v1-cover-a.png", "v1-cover-b.png", "v1-cover-c.png"])


@unittest.skipUnless(has_ffmpeg(), "needs ffmpeg")
class MakeCoversTests(unittest.TestCase):
    def setUp(self):
        self.work = Path(tempfile.mkdtemp(prefix="zks-covers-"))
        for sub in ("edl", "cuts"):
            (self.work / sub).mkdir()
        (self.work / "edl" / "v1.json").write_text(json.dumps(EDL), encoding="utf-8")
        (self.work / "cuts" / "v1.json").write_text(json.dumps({"blur": LEGACY_BLUR}), encoding="utf-8")
        self.drawn = []

    def draw_stills(self, video, times, cues, work):
        """Stands in for hf/render.js --stills: a still of fine random cells per time."""
        self.drawn.append((video, times, cues))
        stills = {}
        for at in times:
            stills[at] = self.work / f"still-{at:g}.png"
            subprocess.run([ffio.ffmpeg_bin(), "-v", "error", "-y", "-f", "lavfi", "-i", "cellauto=size=1080x1920:rule=110:random_seed=4:random_fill_ratio=0.5", "-frames:v", "1", str(stills[at])],
                           check=True)
        return stills

    def test_every_cover_carries_the_blur_live_at_its_frame(self):
        made = covers.make_covers("v1", [seconds(70), seconds(10)], draw_stills=self.draw_stills, work=self.work)
        self.assertEqual([cover["path"] for cover in made], ["covers/v1-cover-a.png", "covers/v1-cover-b.png"])
        self.assertEqual([cover["blurBoxes"] for cover in made], [1, 0])
        blurred, plain = read_rgb(self.work / made[0]["path"]), read_rgb(self.work / made[1]["path"])
        self.assertLess(detail(blurred, BOX), detail(plain, BOX) / 4)
        outside = (0, 0, 200, 200)
        self.assertAlmostEqual(detail(blurred, outside), detail(plain, outside), delta=1)

    def test_a_cover_without_a_cut_spec_fails_instead_of_skipping_the_blur(self):
        (self.work / "cuts" / "v1.json").unlink()
        with self.assertRaisesRegex(GateFailed, "no cut spec"):
            covers.make_covers("v1", [seconds(70)], draw_stills=self.draw_stills, work=self.work)
        self.assertFalse((self.work / "covers").exists() and any((self.work / "covers").iterdir()))

    def test_a_reels_cover_carries_the_base_edits_blur(self):
        (self.work / "edl" / "v1r.json").write_text(json.dumps(EDL), encoding="utf-8")
        made = covers.make_covers("v1r", [seconds(70)], draw_stills=self.draw_stills, work=self.work)
        self.assertEqual(made[0]["blurBoxes"], 1)

    def test_a_reels_cover_is_named_for_the_reel_so_export_finds_it(self):
        (self.work / "edl" / "v1r.json").write_text(json.dumps(EDL), encoding="utf-8")
        made = covers.make_covers("v1r", [seconds(70), seconds(10)], draw_stills=self.draw_stills, work=self.work)
        self.assertEqual([cover["path"] for cover in made], ["covers/v1r-cover-a.png", "covers/v1r-cover-b.png"])
        self.assertTrue((self.work / "covers" / "v1r-cover-b.png").exists())

    def test_a_cover_cue_sheet_is_drawn_over_the_edit(self):
        sheet = self.work / "cues_cover" / "v1.json"
        sheet.parent.mkdir()
        sheet.write_text(json.dumps([{"kind": "hookTitle", "at": 0, "end": 3}]), encoding="utf-8")
        (self.work / "cues").mkdir()
        for name in ("v1", "v1-cc"):
            (self.work / "cues" / f"{name}.json").write_text("[]", encoding="utf-8")
        covers.make_covers("v1", [seconds(10)], cover_sheet=sheet, draw_stills=self.draw_stills, work=self.work)
        self.assertEqual(self.drawn[0][2], ["v1", "v1-cc", "v1-cover"])  # the frame's caption shows on the cover
        self.assertEqual(json.loads((self.work / "cues" / "v1-cover.json").read_text(encoding="utf-8"))[0]["kind"], "hookTitle")


class PostCaptionTests(unittest.TestCase):
    def setUp(self):
        self.work = Path(tempfile.mkdtemp(prefix="zks-caption-"))
        (self.work / "edl").mkdir()
        (self.work / "edl" / "v1.json").write_text(json.dumps(EDL), encoding="utf-8")
        (self.work / "edl" / "v1r.json").write_text(json.dumps({**EDL, "base": "v1"}), encoding="utf-8")
        self.text = self.work / "post.txt"

    def test_the_post_caption_lands_beside_the_covers_with_lf_endings(self):
        self.text.write_bytes("Line one\r\n#zkidz #shorts  \r\n\r\n".encode("utf-8"))
        self.assertEqual(covers.write_post_caption("v1", self.text, self.work), "covers/v1-caption.txt")
        self.assertEqual((self.work / "covers" / "v1-caption.txt").read_text(encoding="utf-8"), "Line one\n#zkidz #shorts\n")

    def test_a_reel_writes_the_one_caption_of_its_full_edit(self):
        self.text.write_text("caption", encoding="utf-8")
        self.assertEqual(covers.write_post_caption("v1r", self.text, self.work), "covers/v1-caption.txt")

    def test_an_empty_caption_fails_instead_of_shipping_a_blank_file(self):
        self.text.write_text(" \n", encoding="utf-8")
        with self.assertRaisesRegex(GateFailed, "empty"):
            covers.write_post_caption("v1", self.text, self.work)
        self.assertFalse((self.work / "covers" / "v1-caption.txt").exists())


if __name__ == "__main__":
    unittest.main()
