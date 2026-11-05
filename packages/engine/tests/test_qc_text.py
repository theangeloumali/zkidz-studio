# Created by The Angelo Umali.
# textClear (#43): no two cues' text shares space at the same moment, judged from the boxes render.js --boxes measured.
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from support import ENGINE, HYPERFRAMES_SKIP, make_edl, needs_renderer, scratch_work  # first: it sets a scratch ZKS_HOME
from test_hf_render import hyperframes_ready

from zks_engine.qc import text_gates
from zks_engine.specs.gates import GateFailed

# OpenCode's OnePuhunan edit at 1030.46 s: a bigWord's kicker chip landed on a chipRail at y 190.
KICKER = {"clip": "c0", "name": "hook-wrong-data", "kind": "bigWord", "at": 17.0, "end": 19.0, "boxes": [[244, 104, 400, 44], [64, 160, 820, 140]]}
CHIP = {"clip": "c38", "name": "hook-topic", "kind": "chipRail", "at": 17.0, "end": 19.0, "boxes": [[294, 82, 300, 51]]}
CAPTION = {"clip": "c40", "name": None, "kind": "caption", "at": 18.0, "end": 18.6, "boxes": [[300, 1690, 480, 72]]}


class TextClearTests(unittest.TestCase):
    def test_a_kicker_on_a_chip_at_the_same_moment_fails_naming_both(self):
        problems = text_gates.text_clear_problems([KICKER, CHIP])
        self.assertEqual(len(problems), 1)
        self.assertIn("'hook-topic' (chipRail)", problems[0])
        self.assertIn("'hook-wrong-data' (bigWord)", problems[0])
        self.assertIn("at 17.0s", problems[0])

    def test_the_same_cues_a_second_apart_pass(self):
        self.assertEqual(text_gates.text_clear_problems([KICKER, {**CHIP, "at": 19.0, "end": 21.0}]), [])

    def test_boxes_side_by_side_inside_the_margin_fail_and_clear_of_it_pass(self):
        left = {**CHIP, "boxes": [[100, 100, 200, 50]]}
        self.assertEqual(len(text_gates.text_clear_problems([left, {**KICKER, "boxes": [[304, 100, 100, 50]]}])), 1)
        self.assertEqual(text_gates.text_clear_problems([left, {**KICKER, "boxes": [[312, 100, 100, 50]]}]), [])

    def test_a_caption_under_a_big_word_fails(self):
        word = {**KICKER, "boxes": [[260, 1700, 560, 160]]}
        self.assertEqual(len(text_gates.text_clear_problems([word, CAPTION])), 1)

    def test_an_unnamed_cue_is_named_by_kind_and_clip(self):
        word = {**KICKER, "boxes": [[260, 1700, 560, 160]]}
        self.assertIn("caption c40", text_gates.text_clear_problems([word, CAPTION])[0])

    def test_two_captions_in_a_row_never_collide(self):
        # A words caption grows its line state by state: consecutive states overlap by design.
        self.assertEqual(text_gates.text_clear_problems([CAPTION, {**CAPTION, "clip": "c41", "at": 18.5, "end": 19.0}]), [])


class SheetTests(unittest.TestCase):
    def setUp(self):
        self.work = Path(tempfile.mkdtemp(prefix="zks-text-"))
        self.addCleanup(shutil.rmtree, self.work, True)
        patch = mock.patch("zks_engine.qc.inputs.WORK", self.work)
        patch.start()
        self.addCleanup(patch.stop)
        (self.work / "edl").mkdir()

    def test_check_raises_with_every_collision_and_the_fix(self):
        (self.work / "edl" / "v1.text.json").write_text(json.dumps([KICKER, CHIP]), encoding="utf-8")
        with self.assertRaisesRegex(GateFailed, "text overlaps text.*move one or drop it"):
            text_gates.check("v1")

    def test_a_missing_measurement_is_a_failure_not_a_pass(self):
        with self.assertRaisesRegex(GateFailed, "render.js .* --boxes"):
            text_gates.load_boxes("v1")


# OpenCode's pair as drawn: the kicker above a y-380 word lands in the top band, where the chip sits.
COLLIDING = [
    {"kind": "bigWord", "id": "wrong-data", "at": 0.5, "end": 2.5, "text": "WRONG DATA", "size": 142, "x": 540, "y": 380, "kicker": "ONEPUHUNAN · AI TRAINING", "drop": True},
    {"kind": "chipRail", "id": "topic", "at": 0.5, "end": 2.5, "y": 190, "align": "center", "x": 540, "chips": [{"text": "AI · DATA ENTRY", "tone": "accent"}]},
]


@needs_renderer(hyperframes_ready(), HYPERFRAMES_SKIP)
class MeasuredTests(unittest.TestCase):
    """render.js --boxes in Chrome, then the gate: the real layout, not a hand-written box."""

    def measure(self, cues):
        folder = tempfile.mkdtemp(prefix="zks-boxes-")
        self.addCleanup(shutil.rmtree, folder, True)
        work = scratch_work(folder, "t", make_edl([(0, 120)]), cues)
        result = subprocess.run(["node", str(ENGINE / "hf" / "render.js"), "t", "--boxes", "--theme", "learning"], cwd=work,
                                env={**os.environ, "ZKS_WORK": str(work)}, capture_output=True, text=True, timeout=300)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads((work / "edl" / "t.text.json").read_text(encoding="utf-8"))

    def test_a_kicker_under_a_chip_rail_is_caught(self):
        problems = text_gates.text_clear_problems(self.measure(COLLIDING))
        self.assertEqual(problems, ["'wrong-data' (bigWord) and 'topic' (chipRail) at 0.5s"])

    def test_the_rail_moved_clear_passes(self):
        moved = [COLLIDING[0], {**COLLIDING[1], "y": 1200}]
        self.assertEqual(text_gates.text_clear_problems(self.measure(moved)), [])


if __name__ == "__main__":
    unittest.main()
