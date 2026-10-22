# Created by The Angelo Umali.
# Person matte: which source frames get matted, and how a matte window list is read from a cut spec.
import unittest

import support  # noqa: F401  first: it sets a scratch ZKS_HOME

from zks_engine import matte
from zks_engine import pipeline


class MatteFramesTests(unittest.TestCase):
    def test_only_frames_inside_windows_are_matted(self):
        frames = matte.matted_frames([[1.0, 2.0], [5.0, 5.5]], 300)
        self.assertIn(round(1.5 * pipeline.FPS), frames)
        self.assertNotIn(round(3.0 * pipeline.FPS), frames)
        self.assertEqual(min(frames), round(1.0 * pipeline.FPS))

    def test_windows_are_clamped_to_the_source(self):
        self.assertEqual(max(matte.matted_frames([[9.0, 99.0]], 300)), 299)

    def test_cutout_name_is_stable(self):
        self.assertEqual(matte.cutout_name("v80", 21.6), "v80-21.60.png")
