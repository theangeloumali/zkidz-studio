# Created by The Angelo Umali.
# Unit tests for orientation handling with a mocked ffprobe: which filter turns a rotated source upright, where it
# runs, and the post-encode upright assertion.
import json
import subprocess
import unittest
from unittest import mock

import support  # noqa: F401  first: it sets a scratch ZKS_HOME

from zks_engine import pipeline


def probe_result(rotation=None, width=3840, height=2160, sar="1:1"):
    stream = {"width": width, "height": height, "sample_aspect_ratio": sar}
    if rotation is not None:
        stream["side_data_list"] = [{"side_data_type": "Display Matrix", "rotation": rotation}]
    return subprocess.CompletedProcess([], 0, stdout=json.dumps({"streams": [stream]}), stderr="")


class OrientationTests(unittest.TestCase):
    def probe(self, function, *args, **stream):
        with mock.patch.object(pipeline.subprocess, "run", return_value=probe_result(**stream)) as run:
            return function(*args), run

    def test_cuda_turns_minus_90_clockwise(self):
        self.assertEqual(self.probe(pipeline.orientation_filter, "clip.mp4", True, rotation=-90)[0], "transpose_cuda=dir=clock")

    def test_cuda_turns_90_counter_clockwise(self):
        self.assertEqual(self.probe(pipeline.orientation_filter, "clip.mp4", True, rotation=90)[0], "transpose_cuda=dir=cclock")

    def test_half_turn_runs_on_cpu_after_download(self):
        orientation = self.probe(pipeline.orientation_filter, "clip.mp4", True, rotation=180)[0]
        self.assertEqual(pipeline.split_orientation(orientation), ("", "hflip,vflip"))
        self.assertEqual(pipeline.split_orientation("transpose_cuda=dir=clock"), ("transpose_cuda=dir=clock", ""))

    def test_unrotated_source_needs_nothing(self):
        self.assertEqual(self.probe(pipeline.orientation_filter, "clip.mp4", True)[0], "")

    def test_cpu_path_leaves_it_to_autorotate(self):
        orientation, run = self.probe(pipeline.orientation_filter, "clip.mp4", False, rotation=-90)
        self.assertEqual(orientation, "")
        run.assert_not_called()

    def test_upright_size_swaps_quarter_turns(self):
        self.assertEqual(self.probe(pipeline.upright_size, "clip.mp4", rotation=-90)[0], (2160, 3840))
        self.assertEqual(self.probe(pipeline.upright_size, "clip.mp4", rotation=180)[0], (3840, 2160))

    def test_assert_upright_accepts_a_square_pixel_portrait(self):
        for sar in ("1:1", "N/A"):
            self.probe(pipeline.assert_upright, "out.mp4", width=1080, height=1920, sar=sar)

    def test_assert_upright_fails_loudly(self):
        for stream in ({"rotation": -90, "width": 1080, "height": 1920}, {"width": 1080, "height": 1920, "sar": "256:81"},
                       {"width": 1920, "height": 1080}):
            with self.assertRaises(SystemExit):
                self.probe(pipeline.assert_upright, "out.mp4", **stream)


if __name__ == "__main__":
    unittest.main()
