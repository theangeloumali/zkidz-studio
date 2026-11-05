# Created by The Angelo Umali.
# YuNet face boxes and the frame-faces command: the presenter, the letterbox band, and the JSON the frame_faces tool reads.
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

from support import ENGINE, has_ffmpeg  # first: it sets a scratch ZKS_HOME

from zks_engine import faces, ffio, home
from zks_engine.specs import SpecError

# NASA portrait S69-31741 (public domain), cropped to the head.
PORTRAIT = ENGINE / "tests" / "fixture" / "faces" / "portrait.jpg"
BAND_Y, BAND_H = 480, 960  # the fixture letterbox: a 9:8 picture centred on the canvas


def installed_yunet():
    """The pinned YuNet from the machine's own ZKS_HOME (zks setup fetches it), copied into the scratch one; None if absent."""
    pin = json.loads((ENGINE.parents[1] / "tools.lock.json").read_text(encoding="utf-8"))["models"]["yunet"]
    with mock.patch.dict(os.environ, {"ZKS_HOME": ""}):
        machine = home.zks_home() / "models" / pin["file"]
    if not machine.is_file() or hashlib.sha256(machine.read_bytes()).hexdigest() != pin["sha256"]:
        return None
    scratch = home.data_dir("models") / pin["file"]
    scratch.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(machine, scratch)
    return scratch


HAS_YUNET = installed_yunet() is not None
YUNET_SKIP = "needs the pinned YuNet model (pnpm zks setup)"


def ffmpeg(*arguments):
    subprocess.run([ffio.ffmpeg_bin(), "-v", "error", "-nostdin", "-y", *arguments], check=True, timeout=120)


def make_proxy(path, letterbox, seconds=3, with_face=True):
    """A 1080x1920 30 fps proxy: the portrait on grey, in a black letterbox or filling the frame."""
    height = BAND_H if letterbox else 1920
    picture = f"color=c=0x707070:s=1080x{height}:r=30:d={seconds}"
    graph = "[1:v]scale=480:480[face];[0:v][face]overlay=300:(H-480)/2" if with_face else "[0:v]null"
    graph += f",pad=1080:1920:0:{BAND_Y}:color=black" if letterbox else ""
    path.parent.mkdir(parents=True, exist_ok=True)
    ffmpeg("-f", "lavfi", "-i", picture, "-loop", "1", "-framerate", "30", "-i", str(PORTRAIT), "-filter_complex", graph + ",format=yuv420p",
           "-frames:v", str(seconds * 30), "-c:v", "libx264", "-preset", "ultrafast", "-g", "30", str(path))


class PresenterTests(unittest.TestCase):
    def test_the_largest_face_is_the_presenter(self):
        found = faces.ranked([np.array([10, 10, 50, 60, *[0] * 10, 0.99]), np.array([500, 300, 200, 240, *[0] * 10, 0.7])], 1.0)
        self.assertEqual(faces.presenter(found), [500, 300, 200, 240])
        self.assertEqual([face["score"] for face in found], [0.7, 0.99])

    def test_no_face_has_no_presenter(self):
        self.assertIsNone(faces.presenter([]))

    def test_boxes_are_scaled_to_the_grid_and_clamped_inside_it(self):
        found = faces.ranked([np.array([-20, 900, 300, 100, *[0] * 10, 0.9])], 2.0)
        self.assertEqual(found[0]["box"], [0, 1800, 560, 120])


class BandTests(unittest.TestCase):
    def test_black_rows_above_and_below_the_picture_are_the_letterbox(self):
        rows, columns = np.zeros(960), np.full(540, 90.0)
        rows[240:720] = 80
        self.assertEqual(faces.band_from_profile(rows, columns, 2.0), [0, 480, 1080, 960])

    def test_an_all_black_frame_keeps_the_full_frame(self):
        self.assertEqual(faces.band_from_profile(np.zeros(960), np.zeros(540), 2.0), [0, 0, 1080, 1920])

    def test_a_recorded_band_on_the_4k_canvas_is_halved_and_picked_by_time(self):
        with tempfile.TemporaryDirectory() as folder:
            work = Path(folder)
            (work / "sources").mkdir()
            bands = [{"at": 0, "end": 10, "band": [0, 0, 2160, 3840]}, {"at": 10, "end": 20, "band": [0, 960, 2160, 1920]}]
            (work / "sources" / "v1.bands.json").write_text(json.dumps(bands), encoding="utf-8")
            self.assertEqual(faces.recorded_band(work, "v1", 12.0), [0, 480, 1080, 960])
            self.assertEqual(faces.recorded_band(work, "v1", 3.0), [0, 0, 1080, 1920])
            self.assertIsNone(faces.recorded_band(work, "v2", 0.0))


class ModelTests(unittest.TestCase):
    def test_a_missing_model_names_the_setup_fix(self):
        with tempfile.TemporaryDirectory() as empty, mock.patch.dict(os.environ, {"ZKS_MODELS": empty}):
            with self.assertRaisesRegex(ffio.ToolMissing, "face_detection_yunet_2023mar.onnx.*zks setup"):
                faces.model_path()


@unittest.skipUnless(has_ffmpeg(), "needs ffmpeg")
class FrameFacesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.work = Path(tempfile.mkdtemp(prefix="zks-faces-")) / "work"
        make_proxy(cls.work / "mezz" / "boxed.mp4", letterbox=True)
        make_proxy(cls.work / "mezz" / "full.mp4", letterbox=False)
        make_proxy(cls.work / "mezz" / "empty.mp4", letterbox=False, with_face=False)

    def setUp(self):
        patch = mock.patch("zks_engine.pipeline.WORK", self.work)
        patch.start()
        self.addCleanup(patch.stop)

    @unittest.skipUnless(HAS_YUNET, YUNET_SKIP)
    def test_a_letterboxed_proxy_reports_its_band_and_the_face_inside_it(self):
        report = faces.frame_faces("boxed", fps=2)
        self.assertEqual(report["band"], [0, BAND_Y, 1080, BAND_H])
        self.assertEqual([sample["t"] for sample in report["samples"]], [0.0, 0.5, 1.0, 1.5, 2.0, 2.5])
        for sample in report["samples"]:
            self.assertEqual(len(sample["faces"]), 1, sample)
            x, y, w, h = sample["faces"][0]["box"]
            self.assertGreater(sample["faces"][0]["score"], 0.6)
            self.assertTrue(300 <= x and x + w <= 780 and BAND_Y + 240 <= y and y + h <= BAND_Y + 720, sample)

    @unittest.skipUnless(HAS_YUNET, YUNET_SKIP)
    def test_a_full_frame_proxy_has_the_whole_canvas_as_its_band(self):
        report = faces.frame_faces("full", at=1.0, end=2.0, fps=4)
        self.assertEqual(report["band"], [0, 0, 1080, 1920])
        self.assertEqual([sample["t"] for sample in report["samples"]], [1.0, 1.25, 1.5, 1.75])
        self.assertTrue(all(len(sample["faces"]) == 1 for sample in report["samples"]))

    @unittest.skipUnless(HAS_YUNET, YUNET_SKIP)
    def test_footage_without_a_face_samples_no_faces(self):
        report = faces.frame_faces("empty")
        self.assertEqual(len(report["samples"]), 3)
        self.assertTrue(all(sample["faces"] == [] for sample in report["samples"]))

    @unittest.skipUnless(HAS_YUNET, YUNET_SKIP)
    def test_a_recorded_band_wins_over_the_detected_one(self):
        bands = self.work / "sources" / "full.bands.json"
        bands.parent.mkdir(exist_ok=True)
        bands.write_text(json.dumps([{"at": 0, "end": 3, "band": [0, 200, 2160, 3440]}]), encoding="utf-8")
        self.addCleanup(bands.unlink)
        self.assertEqual(faces.frame_faces("full", end=1.0)["band"], [0, 100, 1080, 1720])

    def test_a_video_without_a_proxy_is_a_spec_error(self):
        with self.assertRaisesRegex(SpecError, "mezz/nope.mp4"):
            faces.frame_faces("nope")

    def test_a_span_past_the_end_is_a_spec_error(self):
        with self.assertRaisesRegex(SpecError, "after"):
            faces.frame_faces("full", at=5.0)

    @unittest.skipUnless(HAS_YUNET, YUNET_SKIP)
    def test_the_cli_prints_only_the_report_json(self):
        result = subprocess.run([sys.executable, "-m", "zks_engine.cli", "frame-faces", "--json", "--video", "boxed", "--fps", "1"],
                                cwd=self.work, capture_output=True, text=True, timeout=120, env={**os.environ, "ZKS_WORK": str(self.work)})
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(set(report), {"band", "samples"})
        self.assertEqual(len(report["samples"]), 3)

    def test_the_cli_refuses_more_than_four_samples_a_second(self):
        result = subprocess.run([sys.executable, "-m", "zks_engine.cli", "frame-faces", "--json", "--video", "boxed", "--fps", "5"],
                                cwd=self.work, capture_output=True, text=True, timeout=60, env={**os.environ, "ZKS_WORK": str(self.work)})
        self.assertNotEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
