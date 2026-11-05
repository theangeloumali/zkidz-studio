# Created by The Angelo Umali.
# The learning theme's face gates: no overlay on the presenter's face (faceClear) and the face-width bar (faceWidth),
# then both, with density and variety, collected by qc_master and read by assert_exportable.
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import cv2
import numpy as np

from support import has_ffmpeg, make_edl, write_sheet  # first: it sets a scratch ZKS_HOME
from test_faces import HAS_YUNET, YUNET_SKIP, ffmpeg, make_proxy

from zks_engine import qc
from zks_engine.qc import face_gates
from zks_engine.specs.gates import GateFailed

FACE = (480, 700, 160, 200)  # x, y, w, h on the 1080 grid
EDL = make_edl([(0, 30)])  # one second, uncut: source seconds are edited seconds


def write_overlay(frames_dir, count, card=None, from_frame=0, until_frame=None):
    """Transparent RGBA frames; `card` (x, y, w, h) drawn opaque on frames from_frame..until_frame."""
    frames_dir.mkdir(parents=True, exist_ok=True)
    clear = np.zeros((1920, 1080, 4), np.uint8)
    covered = clear.copy()
    if card:
        x, y, w, h = card
        covered[y:y + h, x:x + w] = (40, 40, 200, 255)
    for frame in range(count):
        cv2.imwrite(str(frames_dir / f"{frame:05d}.png"), covered if card and from_frame <= frame < (until_frame or count) else clear)


class FaceGateTests(unittest.TestCase):
    def setUp(self):
        self.work = Path(tempfile.mkdtemp(prefix="zks-face-gates-"))
        self.addCleanup(shutil.rmtree, self.work, True)
        patch = mock.patch("zks_engine.qc.inputs.WORK", self.work)
        patch.start()
        self.addCleanup(patch.stop)
        self.found = [(index / 5, FACE) for index in range(5)]  # the presenter at 5 fps over the second

    def clear(self, cues=(), intro=None, split_frames=0, found=None):
        return face_gates.face_clear_problems("v1", list(cues), EDL, intro, split_frames, self.found if found is None else found)[0]

    def test_a_clear_overlay_passes(self):
        write_overlay(self.work / "frames" / "v1", 30)
        self.assertEqual(self.clear(), [])

    def test_a_face_covered_by_an_overlay_fails_at_its_time(self):
        write_overlay(self.work / "frames" / "v1", 30, card=FACE, from_frame=12)
        problems = self.clear()
        self.assertEqual(len(problems), 1)
        self.assertIn("0.6s 1.000", problems[0])
        self.assertNotIn("0.4s", problems[0])  # two clear neighbours: a sample may land a frame off the overlay grid

    def test_a_card_over_the_face_is_skipped_while_a_footage_card_holds(self):
        write_overlay(self.work / "frames" / "v1", 30, card=FACE, until_frame=15)
        self.assertEqual(self.clear([{"kind": "footageCard", "at": 0, "end": 0.5}]), [])
        self.assertEqual(len(self.clear()), 1)

    def test_a_paper_scene_hides_the_presenter_so_its_frames_are_skipped(self):
        # On opaque paper he is not on screen; YuNet even finds faces in the paper's dots.
        write_overlay(self.work / "frames" / "v1", 30, card=FACE, until_frame=15)
        for cover in ("paperScene", "cutaway"):
            self.assertEqual(self.clear([{"kind": cover, "at": 0, "end": 0.5}]), [], cover)

    def test_the_brand_split_frames_are_skipped(self):
        write_overlay(self.work / "frames" / "v1", 30, card=FACE, until_frame=16)
        intro = {"at": 0, "frames": 60}
        found = [(seconds + 2.002, box) for seconds, box in self.found]  # master seconds after the 60-frame pre-roll
        self.assertEqual(self.clear(intro=intro, split_frames=16, found=found), [])
        self.assertEqual(len(self.clear(intro=intro, split_frames=0, found=found)), 1)

    def test_nothing_to_measure_outside_the_cards_fails(self):
        write_overlay(self.work / "frames" / "v1", 30)
        self.assertEqual(self.clear([{"kind": "footageCard", "at": 0, "end": 1.1}]), ["no frame outside the footage cards and the split to measure"])

    def test_the_caption_layer_counts(self):
        write_overlay(self.work / "frames" / "v1", 30)
        write_overlay(self.work / "frames" / "v1.cc", 30, card=FACE)
        self.assertEqual(len(self.clear()), 1)

    def test_missing_overlay_frames_fail_and_say_to_render(self):
        self.assertIn("re-render", self.clear()[0])

    def test_no_face_in_the_master_proves_nothing(self):
        self.assertEqual(self.clear(found=[(0.0, None)]), ["no face found in the master: nothing proven"])

    def test_a_frosted_face_is_never_the_presenter_when_others_are_blurred(self):
        # 4:08 of the OnePuhunan edit: he is off screen and a colleague's frosted face, the largest, read as his.
        image = cv2.GaussianBlur(np.random.default_rng(3).uniform(0, 255, (960, 540, 3)).astype(np.uint8), (0, 0), 12)
        image[100:160, 100:160] = np.random.default_rng(4).uniform(0, 255, (60, 60, 3))  # a sharp face
        found = [{"box": [400, 600, 300, 300], "score": 0.9}, {"box": [200, 200, 120, 120], "score": 0.9}]  # grid, largest first
        self.assertEqual(face_gates.presenter_box(image, found, frosted_out=True), [200, 200, 120, 120])
        self.assertEqual(face_gates.presenter_box(image, found, frosted_out=False), [400, 600, 300, 300])
        self.assertIsNone(face_gates.presenter_box(image, found[:1], frosted_out=True))

    def test_the_widest_face_over_the_bar_is_reported_as_framing(self):
        problems, _ = face_gates.face_width_problems([(0.0, FACE), (0.2, (300, 600, 400, 480))])
        self.assertEqual(len(problems), 1)
        self.assertIn("0.370", problems[0])
        self.assertIn("framing", problems[0])
        self.assertIn("never cover", problems[0])

    def test_a_face_within_the_bar_passes_and_places_the_graphics(self):
        problems, summary = face_gates.face_width_problems([(0.0, FACE)])
        self.assertEqual(problems, [])
        self.assertIn("median face x 480-640, y 700-900", summary)


@unittest.skipUnless(has_ffmpeg(), "needs ffmpeg")
@unittest.skipUnless(HAS_YUNET, YUNET_SKIP)
@unittest.skipUnless(shutil.which("node"), "needs node")
class LearningQcMasterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder = Path(tempfile.mkdtemp(prefix="zks-learning-qc-"))
        cls.master, picture = cls.folder / "master.mp4", cls.folder / "picture.mp4"
        make_proxy(picture, letterbox=False, seconds=1)
        ffmpeg("-i", str(picture), "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=1", "-map", "0:v", "-map", "1:a",
               "-c:v", "copy", "-c:a", "aac", str(cls.master))
        cls.box = face_gates.master_faces(cls.master)[0][1]

    def setUp(self):
        self.work = Path(tempfile.mkdtemp(prefix="work-", dir=self.folder))
        (self.work / "edl").mkdir()
        (self.work / "edl" / "v1.json").write_text(json.dumps({**EDL, "zooms": []}), encoding="utf-8")
        (self.work / "edl" / "v1.sfx.json").write_text(json.dumps({"frames": 30, "events": []}), encoding="utf-8")
        (self.work / "style.json").write_text(json.dumps({"theme": "learning"}), encoding="utf-8")
        write_sheet(self.work, "v1", [{"kind": "meterGauge", "at": 0.1, "end": 0.9, "label": "x", "level": 0.5}])
        patch = mock.patch("zks_engine.qc.inputs.WORK", self.work)
        patch.start()
        self.addCleanup(patch.stop)

    def checks(self):
        report = qc.qc_master("v1", self.master, self.master, [], lambda *_: [])
        return {check["name"]: check for check in report["checks"]}, report

    def test_the_presenter_is_found_in_the_master(self):
        x, y, w, h = self.box
        self.assertTrue(300 <= x and x + w <= 780 and 720 <= y and y + h <= 1200, self.box)

    def test_a_learning_edit_gets_the_four_learning_gates(self):
        write_overlay(self.work / "frames" / "v1", 30)
        checks, _ = self.checks()
        self.assertTrue({"density", "variety", "faceClear", "faceWidth"} <= set(checks))
        self.assertTrue(checks["faceClear"]["ok"], checks["faceClear"])
        self.assertTrue(checks["faceWidth"]["ok"], checks["faceWidth"])
        self.assertEqual(checks["variety"]["detail"], "meterGauge 100% of beats")  # the one beat is every beat

    def test_an_overlay_on_the_face_fails_face_clear_and_blocks_export(self):
        write_overlay(self.work / "frames" / "v1", 30, card=self.box)
        checks, report = self.checks()
        self.assertFalse(checks["faceClear"]["ok"])
        self.assertFalse(report["ok"])

    def test_a_house_theme_edit_runs_no_learning_gate(self):
        (self.work / "style.json").unlink()
        write_overlay(self.work / "frames" / "v1", 30)
        checks, _ = self.checks()
        self.assertFalse({"density", "variety", "faceClear", "faceWidth"} & set(checks))


class ReportedOnlyTests(unittest.TestCase):
    """faceWidth is footage framing, the owner's call: it is reported and never blocks the export on its own."""

    def setUp(self):
        self.work = Path(tempfile.mkdtemp(prefix="zks-reported-"))
        self.addCleanup(shutil.rmtree, self.work, True)
        patch = mock.patch("zks_engine.qc.inputs.WORK", self.work)
        patch.start()
        self.addCleanup(patch.stop)
        (self.work / "out").mkdir()
        (self.work / "qc").mkdir()
        self.master = self.work / "out" / "v1.mp4"
        self.master.write_bytes(b"master")

    def report(self, failing):
        checks = [{"name": name, "ok": name not in failing, "detail": "x"} for name in ("faceClear", "faceWidth")]
        body = {"ok": True, "checks": checks, "master": qc.master_record(self.master), "source": {"relPath": "x"}, "specsSnapshot": None}
        (self.work / "qc" / "v1.json").write_text(json.dumps(body), encoding="utf-8")

    def test_a_face_width_failure_alone_allows_export(self):
        self.report({"faceWidth"})
        qc.assert_exportable("v1")

    def test_a_face_clear_failure_blocks_export(self):
        self.report({"faceClear"})
        with self.assertRaisesRegex(GateFailed, "faceClear"):
            qc.assert_exportable("v1")


class CaptionLayerProvenanceTests(unittest.TestCase):
    def test_a_caption_layer_redrawn_after_the_render_changes_its_inputs(self):
        work = Path(tempfile.mkdtemp(prefix="zks-cc-inputs-"))
        self.addCleanup(shutil.rmtree, work, True)
        (work / "frames" / "v1.cc").mkdir(parents=True)
        (work / "frames" / "v1.cc" / "00000.png").write_bytes(b"a")
        recorded = qc.inputs.render_inputs("v1", work)
        (work / "frames" / "v1.cc" / "00001.png").write_bytes(b"b")
        self.assertEqual(qc.inputs.render_input_problems(recorded, qc.inputs.render_inputs("v1", work)),
                         ["frames/v1.cc/ changed since the render that made this master"])


if __name__ == "__main__":
    unittest.main()
