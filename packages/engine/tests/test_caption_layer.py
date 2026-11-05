# Created by The Angelo Umali.
# Unit tests for caption_layer: the caption plates expanded onto the edit's frame grid as hard-linked or drawn PNGs.
import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

import numpy as np
from PIL import Image
import support  # noqa: F401  first: it sets a scratch ZKS_HOME

from zks_engine import caption_layer

WIDTH, HEIGHT = 64, 48
RED = (255, 0, 0)


def plate(path, rows, colour=RED, opacity=255):
    """A plate `colour` in `rows` (first, end), transparent elsewhere; a new key for its folder, as render.js writes one."""
    pixels = np.zeros((HEIGHT, WIDTH, 4), np.uint8)
    pixels[rows[0]:rows[1]] = (*colour, opacity)
    Image.fromarray(pixels, "RGBA").save(path)
    (path.parent / ".hash").write_text(str(time.time_ns()), encoding="utf-8")


def over(top, bottom):
    """Straight-alpha RGBA `top` over an opaque RGB float `bottom`, both 0..1 out."""
    alpha = top[..., 3:] / 255
    return top[..., :3] / 255 * alpha + bottom * (1 - alpha)


def pixels(path):
    with Image.open(path) as image:
        return np.asarray(image.convert("RGBA"))


class CaptionLayerTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.work = Path(folder.name)
        (self.work / "frames" / "v1.plates").mkdir(parents=True)
        patcher = mock.patch.object(caption_layer, "WORK", self.work)
        patcher.start()
        self.addCleanup(patcher.stop)
        plate(self.work / "frames" / "v1.plates" / "0000.png", (10, 20))
        self.captions = [{"plate": "0000.png", "first": 2, "end": 8, "motion": [[2, 0.5, 0], [3, 1.0, 2.5]]}]

    def write_sheet(self, frames=10, captions=None, cards=None, under=()):
        """The sheet as render.js writes it, naming the keys of the card frames and plates it was drawn against."""
        folder = self.work / "frames" / "v1"
        folder.mkdir(exist_ok=True)
        if not (folder / ".hash").exists():
            (folder / ".hash").write_text("k1", encoding="utf-8")
        sheet = {"frames": frames, "cards": cards or caption_layer.folder_key(folder),
                 "plates": caption_layer.folder_key(self.work / "frames" / "v1.plates"),
                 "above": caption_layer.folder_key(self.work / "frames" / "v1.above"),
                 "captions": self.captions if captions is None else captions, "under": list(under)}
        (self.work / "frames" / "v1.cc.json").write_text(json.dumps(sheet), encoding="utf-8")

    def frame(self, index):
        return self.work / "frames" / "v1.cc" / f"{index:05d}.png"

    def test_no_sheet_returns_none(self):
        self.assertIsNone(caption_layer.build("v1"))
        self.assertFalse((self.work / "frames" / "v1.cc").exists())

    def test_captions_dropped_since_the_last_render_take_their_frames_with_them(self):
        # render_final composites frames/<v>.cc/ whenever the folder exists, so the last render's captions came back.
        self.write_sheet()
        self.assertIsNotNone(caption_layer.build("v1"))
        (self.work / "frames" / "v1.cc.json").unlink()
        self.assertIsNone(caption_layer.build("v1"))
        self.assertFalse((self.work / "frames" / "v1.cc").exists())
        self.assertFalse((self.work / "frames" / "v1.cc.hash").exists())

    def test_canvas_cards_get_no_caption_layer(self):
        # The canvas renderer resets the folder, dropping HyperFrames' key, and draws the captions in itself.
        self.write_sheet()
        (self.work / "frames" / "v1" / ".hash").unlink()
        self.assertIsNone(caption_layer.build("v1"))

    def test_a_sheet_for_other_hyperframes_cards_or_plates_stops_the_render(self):
        # A failed pass between the cards and the plates: refused by name, never a master without its captions.
        self.write_sheet(cards="k0")
        with self.assertRaisesRegex(SystemExit, "render.js"):
            caption_layer.build("v1")
        self.write_sheet()
        plate(self.work / "frames" / "v1.plates" / "0000.png", (10, 20))
        with self.assertRaisesRegex(SystemExit, "render.js"):
            caption_layer.build("v1")

    def test_one_rgba_png_per_frame(self):
        self.write_sheet()
        folder = caption_layer.build("v1")
        self.assertEqual(folder, self.work / "frames" / "v1.cc")
        self.assertEqual(sorted(path.name for path in folder.iterdir()), [f"{index:05d}.png" for index in range(10)])
        for index in range(10):
            with Image.open(self.frame(index)) as image:
                self.assertEqual((image.mode, image.size), ("RGBA", (WIDTH, HEIGHT)), index)

    def test_blank_frames_are_transparent_and_share_one_file(self):
        self.write_sheet()
        caption_layer.build("v1")
        for index in (0, 1, 8, 9):
            self.assertFalse(pixels(self.frame(index))[..., 3].any(), index)
            self.assertTrue(os.path.samefile(self.frame(0), self.frame(index)), index)

    def test_settled_frames_are_the_plate_and_share_one_file(self):
        self.write_sheet()
        caption_layer.build("v1")
        source = (self.work / "frames" / "v1.plates" / "0000.png").read_bytes()
        for index in range(4, 8):
            self.assertEqual(self.frame(index).read_bytes(), source, index)
            self.assertTrue(os.path.samefile(self.frame(4), self.frame(index)), index)
        self.assertFalse(os.path.samefile(self.frame(4), self.frame(0)))

    def test_motion_frame_multiplies_alpha(self):
        self.write_sheet()
        caption_layer.build("v1")
        image = pixels(self.frame(2))
        self.assertTrue(np.all(np.abs(image[10:20, :, 3].astype(int) - 128) <= 1))
        self.assertTrue(np.all(image[10:20, :, :3] == RED))
        self.assertFalse(image[:10, :, 3].any() or image[20:, :, 3].any())

    def test_motion_frame_shifts_down_whole_pixels(self):
        self.captions[0]["motion"][1][2] = 2
        self.write_sheet()
        caption_layer.build("v1")
        image = pixels(self.frame(3))
        alpha = image[..., 3].astype(int)
        self.assertFalse(alpha[:12].any() or alpha[22:].any())
        self.assertTrue(np.all(alpha[12:22] == 255))
        self.assertTrue(np.all(image[12:22, :, :3] == RED))

    def cards(self, index, rows, opacity=255):
        """The above layer's frame `index` (cards after the captions), green in `rows`: it covers the captions there."""
        (self.work / "frames" / "v1.above").mkdir(exist_ok=True)
        plate(self.work / "frames" / "v1.above" / f"{index:05d}.png", rows, colour=(0, 255, 0), opacity=opacity)

    def test_the_cards_cover_the_captions_in_an_under_span(self):
        # render_final lays the caption layer over the cards; over an `under` span that must equal the cards over the
        # captions, as in one page, half-transparent card pixels included.
        for index in range(10):
            self.cards(index, (0, 15), opacity=128)
        self.write_sheet(under=[[5, 7]])
        caption_layer.build("v1")
        base = np.full((HEIGHT, WIDTH, 3), 0.5)
        for index in (5, 6):
            cards, caption = pixels(self.work / "frames" / "v1.above" / f"{index:05d}.png"), pixels(self.frame(index))
            plate_now = pixels(self.work / "frames" / "v1.plates" / "0000.png")
            np.testing.assert_allclose(over(caption, over(cards, base)), over(cards, over(plate_now, base)), atol=2 / 255, err_msg=str(index))
        self.assertTrue(np.all(pixels(self.frame(4))[10:20, :, :3] == RED), "a frame outside the span is changed")
        self.cards(5, (0, 18), opacity=255)
        self.write_sheet(under=[[5, 7]])
        caption_layer.build("v1")
        self.assertTrue(np.all(pixels(self.frame(5))[15:18, :, :3] == (0, 255, 0)), "a changed card frame in the span is not redrawn")

    def test_a_locked_old_folder_does_not_stop_a_rebuild(self):
        self.write_sheet()
        caption_layer.build("v1")
        (self.work / "frames" / "v1.cc.old").mkdir()
        (self.work / "frames" / "v1.cc.old" / "held.png").write_bytes(b"")
        self.captions[0]["motion"][0][1] = 0.25
        self.write_sheet()
        # Defender or Explorer holding a file: the old folder cannot be cleared.
        with mock.patch.object(caption_layer.shutil, "rmtree"):
            self.assertEqual(caption_layer.build("v1"), self.work / "frames" / "v1.cc")
        self.assertTrue(np.all(np.abs(pixels(self.frame(2))[10:20, :, 3].astype(int) - 64) <= 1))

    def test_overlapping_captions_composite_in_list_order(self):
        plate(self.work / "frames" / "v1.plates" / "0001.png", (15, 25), colour=(0, 0, 255))
        self.write_sheet(captions=[{"plate": "0000.png", "first": 0, "end": 4, "motion": []},
                                   {"plate": "0001.png", "first": 3, "end": 6, "motion": []}])
        caption_layer.build("v1")
        image = pixels(self.frame(3))
        self.assertEqual(tuple(image[12][0]), (*RED, 255))
        self.assertEqual(tuple(image[17][0]), (0, 0, 255, 255))  # the later caption lands over the earlier one
        self.assertEqual(tuple(image[22][0]), (0, 0, 255, 255))

    def test_a_words_join_draws_both_plates_until_the_new_one_is_full(self):
        # render.js holds the state before a continuing words state for its 3 fade frames, under the fading one.
        plate(self.work / "frames" / "v1.plates" / "0001.png", (15, 25), colour=(0, 0, 255))
        fade = [[4, 0.4375, 0], [5, 0.75, 0], [6, 0.9375, 0]]
        self.write_sheet(captions=[{"plate": "0000.png", "first": 1, "end": 4, "hold": 3, "motion": []},
                                   {"plate": "0001.png", "first": 4, "end": 9, "motion": fade}])
        sheet = json.loads((self.work / "frames" / "v1.cc.json").read_text(encoding="utf-8"))
        plates = [self.work / "frames" / "v1.plates" / name for name in ("0000.png", "0001.png")]
        layers = caption_layer.frame_layers(sheet, plates)
        self.assertEqual([[(path.name, alpha) for path, alpha, _ in layers[index]] for index in (4, 5, 6, 7)],
                         [[("0000.png", 1.0), ("0001.png", alpha)] for _, alpha, _ in fade] + [[("0001.png", 1.0)]])
        caption_layer.build("v1")
        for index in (4, 5, 6):
            self.assertEqual(tuple(pixels(self.frame(index))[12][0]), (*RED, 255), f"frame {index}: the held plate dips")
        self.assertEqual(tuple(pixels(self.frame(7))[12][0][3:]), (0,), "the held plate outlives the fade")
        self.assertEqual(tuple(pixels(self.frame(7))[17][0]), (0, 0, 255, 255))

    def test_links_per_file_stay_under_the_ntfs_limit(self):
        self.write_sheet(frames=2500, captions=[])
        caption_layer.build("v1")
        stats = [os.stat(self.frame(index)) for index in range(2500)]
        self.assertEqual(len({stat.st_ino for stat in stats}), 3)
        self.assertLessEqual(max(stat.st_nlink for stat in stats), caption_layer.LINKS_PER_FILE)

    def test_second_build_is_a_cache_hit(self):
        self.write_sheet()
        caption_layer.build("v1")
        before = os.stat(self.frame(2)).st_mtime_ns
        with mock.patch.object(caption_layer, "draw", side_effect=AssertionError("redrawn")):
            self.assertEqual(caption_layer.build("v1"), self.work / "frames" / "v1.cc")
        self.assertEqual(os.stat(self.frame(2)).st_mtime_ns, before)

    def test_changed_sheet_or_plate_rebuilds(self):
        self.write_sheet()
        caption_layer.build("v1")
        self.captions[0]["motion"][0][1] = 0.25
        self.write_sheet()
        caption_layer.build("v1")
        self.assertTrue(np.all(np.abs(pixels(self.frame(2))[10:20, :, 3].astype(int) - 64) <= 1))
        plate(self.work / "frames" / "v1.plates" / "0000.png", (30, 40))
        self.write_sheet()
        caption_layer.build("v1")
        self.assertTrue(pixels(self.frame(5))[30:40, :, 3].all())

    def test_a_change_to_the_drawing_code_rebuilds(self):
        self.write_sheet()
        caption_layer.build("v1")
        before = os.stat(self.frame(2)).st_mtime_ns
        with mock.patch.object(caption_layer, "DRAWING", b"changed"):
            caption_layer.build("v1")
        self.assertNotEqual(os.stat(self.frame(2)).st_mtime_ns, before)

    def test_a_missing_frame_rebuilds(self):
        self.write_sheet()
        caption_layer.build("v1")
        self.frame(9).unlink()
        caption_layer.build("v1")
        self.assertTrue(self.frame(9).exists())


class RenameRetryTests(unittest.TestCase):
    """A folder Defender or the indexer still holds refuses a rename for a moment (WinError 5, v105c); the swap waits it out."""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        (self.root / "src").mkdir()

    def test_a_briefly_locked_folder_is_renamed_on_a_retry(self):
        real = Path.rename
        attempts = []

        def flaky(path, target):
            attempts.append(path)
            if len(attempts) == 1:
                raise PermissionError(5, "Access is denied")
            return real(path, target)

        with mock.patch.object(Path, "rename", flaky), mock.patch.object(caption_layer.time, "sleep"):
            caption_layer.rename_retrying(self.root / "src", self.root / "dst")
        self.assertTrue((self.root / "dst").is_dir())
        self.assertEqual(len(attempts), 2)

    def test_a_lock_that_never_clears_still_raises(self):
        with mock.patch.object(Path, "rename", side_effect=PermissionError(5, "Access is denied")), mock.patch.object(caption_layer.time, "sleep"):
            with self.assertRaises(PermissionError):
                caption_layer.rename_retrying(self.root / "src", self.root / "dst")


if __name__ == "__main__":
    unittest.main()
