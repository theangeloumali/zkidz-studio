# Created by The Angelo Umali.
# Person matte: which source frames get matted, how a matte window list is read from a cut spec, and how a mask is stored.
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np
import support  # noqa: F401  first: it sets a scratch ZKS_HOME
from test_cardclip import nvenc_ready

from zks_engine import ffio, matte
from zks_engine import pipeline


class MatteFramesTests(unittest.TestCase):
    def test_only_frames_inside_windows_are_matted(self):
        frames = matte.matted_frames([[1.0, 2.0], [5.0, 5.5]], 300)
        self.assertIn(round(1.5 * pipeline.FPS), frames)
        self.assertNotIn(round(3.0 * pipeline.FPS), frames)
        self.assertEqual(min(frames), round(1.0 * pipeline.FPS))

    def test_windows_are_clamped_to_the_source(self):
        self.assertEqual(max(matte.matted_frames([[9.0, 99.0]], 300)), 299)

    def test_without_torch_the_error_names_the_extra(self):
        with mock.patch.dict(sys.modules, {"torch": None}), self.assertRaisesRegex(SystemExit, "--extra matte"):
            matte.model()

    def test_cutout_name_is_stable(self):
        self.assertEqual(matte.cutout_name("v80", 21.6), "v80-21.60.png")


@unittest.skipUnless(nvenc_ready(), "needs an NVENC ffmpeg")
class EncodeTests(unittest.TestCase):
    # Pre-squashed 16/235 gray was squashed again to 30/218: faces blurred at 91 %, so they showed through (#44).
    def test_a_mask_is_stored_as_exact_tv_range_luma(self):
        width, height = pipeline.OUTPUT
        half = np.zeros((height, width), np.uint8)
        half[:, width // 2:] = 255
        with tempfile.TemporaryDirectory() as folder:
            out = Path(folder) / "m.mkv"
            matte.encode([half, half.astype(float) / 255], 2, out)
            raw = subprocess.run([ffio.ffmpeg_bin(), "-v", "error", "-i", str(out), "-f", "rawvideo", "-pix_fmt", "yuv420p", "-"],
                                 capture_output=True, check=True).stdout
        luma = np.frombuffer(raw, np.uint8).reshape(2, -1)[:, :width * height]
        self.assertEqual([sorted(set(frame.tolist())) for frame in luma], [[16, 235], [16, 235]])
