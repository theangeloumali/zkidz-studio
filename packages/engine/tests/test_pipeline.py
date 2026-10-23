# Created by The Angelo Umali.
# Unit tests for the engine pipeline: paths, time mapping and bleeps (EDL invariants: test_edl.py).
# Run (from engine/): python -m unittest discover -s tests
import os
import unittest
from pathlib import Path
from unittest import mock

import numpy as np
from support import make_edl, seconds  # first: it sets a scratch ZKS_HOME

from zks_engine import audio
from zks_engine import check_windows
from zks_engine import pipeline
from zks_engine import transcribe


class WorkDirTests(unittest.TestCase):
    def test_env_overrides_cwd(self):
        with mock.patch.dict(os.environ, {"ZKS_WORK": "/tmp/some-edit"}):
            self.assertEqual(pipeline.work_dir(), Path("/tmp/some-edit"))

    def test_defaults_to_cwd(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("ZKS_WORK", None)
            self.assertEqual(pipeline.work_dir(), Path.cwd())


class CheckWindowArgsTests(unittest.TestCase):
    def test_defaults_to_english(self):
        self.assertEqual(check_windows.parse_args(["a.wav", "1.0-1.5"]), ("en", "a.wav", [(1.0, 1.5)]))

    def test_lang_flag(self):
        self.assertEqual(check_windows.parse_args(["--lang", "tl", "a.wav", "2-3", "4.5-5"]),
                         ("tl", "a.wav", [(2.0, 3.0), (4.5, 5.0)]))


class SplitPointTests(unittest.TestCase):
    def check(self, duration, chunks):
        points = transcribe.split_points(np.full(int(duration / pipeline.ENERGY_WINDOW), -30.0), chunks)
        self.assertEqual(points[0], 0.0)
        self.assertAlmostEqual(points[-1], duration)
        for earlier, later in zip(points, points[1:]):
            self.assertLess(earlier, later)
        return points

    def test_short_clip_does_not_crash(self):
        self.assertEqual(len(self.check(30.0, 8)), 2)

    def test_minute_clip_never_repeats_a_point(self):
        self.check(60.0, 8)

    def test_long_file_keeps_requested_chunks(self):
        self.assertEqual(len(self.check(590.0, 8)), 9)


class TimeMappingTests(unittest.TestCase):
    timeline = make_edl([(0, 30), (60, 90), (120, 150)])

    def test_source_to_edited_inside_second_segment(self):
        # source frame 75 is 15 frames into the second segment, which starts at edited frame 30.
        self.assertAlmostEqual(pipeline.source_to_edited(seconds(75), self.timeline), seconds(45))

    def test_exclusive_end_is_accepted(self):
        self.assertAlmostEqual(pipeline.source_to_edited(seconds(30), self.timeline), seconds(30))

    def test_removed_range_raises(self):
        with self.assertRaises(ValueError):
            pipeline.source_to_edited(seconds(45), self.timeline)

    def assertSpans(self, start, end, expected):
        spans = pipeline.map_interval(seconds(start), seconds(end), self.timeline)
        self.assertEqual(len(spans), len(expected))
        for (low, high), (want_low, want_high) in zip(spans, expected):
            self.assertAlmostEqual(low, seconds(want_low))
            self.assertAlmostEqual(high, seconds(want_high))

    def test_map_interval_inside_one_segment(self):
        self.assertSpans(65, 70, [(35, 40)])

    def test_map_interval_fully_removed(self):
        self.assertSpans(35, 55, [])
        self.assertSpans(30, 60, [])  # exactly the removed gap: segment ends are exclusive

    def test_map_interval_clips_a_partly_removed_span(self):
        self.assertSpans(80, 100, [(50, 60)])
        self.assertSpans(100, 125, [(60, 65)])

    def test_map_interval_merges_across_cuts(self):
        # The removed middle collapses, so the kept parts abut in the edit and read as one span.
        self.assertSpans(20, 70, [(20, 40)])
        self.assertSpans(10, 140, [(10, 80)])

    def test_map_interval_empty_and_off_frame_grid(self):
        self.assertSpans(70, 70, [])
        spans = pipeline.map_interval(2.5, 2.7, self.timeline)
        self.assertAlmostEqual(spans[0][0], 2.5 - seconds(30))
        self.assertAlmostEqual(spans[0][1], 2.7 - seconds(30))


class AudioTests(unittest.TestCase):
    def test_assemble_matches_video_frames_exactly(self):
        rng = np.random.default_rng(7)
        source = rng.standard_normal((pipeline.AUDIO_RATE * 60, 2)).astype(np.float32)
        starts = sorted(rng.choice(np.arange(10, 1500, 37), 8, replace=False))
        ranges = [(int(start), int(start) + int(rng.integers(20, 30))) for start in starts]
        timeline = make_edl(ranges)
        self.assertEqual(len(audio.assemble(source, timeline)), pipeline.frame_to_sample(timeline["frames"], timeline))

    def bleeped(self, start, end):
        timeline = make_edl([(0, 30), (60, 90)])
        output = np.zeros((pipeline.frame_to_sample(timeline["frames"], timeline), 2))
        audio.bleep(output, timeline, [{"at": seconds(start), "end": seconds(end)}])
        return output

    def test_bleep_on_removed_footage_is_a_no_op(self):
        self.assertFalse(self.bleeped(35, 55).any())

    def test_partly_removed_bleep_is_clipped_to_the_kept_part(self):
        output = self.bleeped(20, 45)
        first, last = int(seconds(20) * pipeline.AUDIO_RATE), int(seconds(30) * pipeline.AUDIO_RATE)
        self.assertFalse(output[:first].any())
        self.assertFalse(output[last:].any())
        self.assertTrue(output[first:last].any())

    def test_bleep_shorter_than_its_ramps_does_not_crash(self):
        self.bleeped(29.99, 45)


if __name__ == "__main__":
    unittest.main()
