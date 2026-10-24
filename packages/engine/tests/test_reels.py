# Created by The Angelo Umali.
# Unit tests for make_reels: keep-range complement, reel flag, carried-over privacy data and the EDL it yields.
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np
from support import seconds  # first: it sets a scratch ZKS_HOME

from zks_engine import edl
from zks_engine import make_reels
from zks_engine import pipeline

SPEC = {
    "source": "raw.mp4",
    "duration": 100.0,
    "remove": [[10.0, 12.0, "false start"], [50.0, 55.0, "repeat"]],
    "trim_pauses": {"threshold_db": -90, "min": 99, "keep": 0.2, "exclude": []},
    "facecam": [[0, 100.0]],
    "cutaways": [{"at": 20.5, "end": 21.5, "title": "kept"}, {"at": 70.0, "end": 71.0, "title": "dropped"},
                 {"at": 29.9, "end": 31.0, "title": "on a keep edge"}],
    "bleep": [[80.0, 80.5, 540, 900]],
    "blur": [[5.0, 90.0, 0, 0, 100, 100, "column"]],
}
KEEP = [[30.0, 60.0], [5.0, 15.0], [20.0, 25.0]]


class MakeReelsTests(unittest.TestCase):
    def reel(self):
        return make_reels.reel_spec("v4", SPEC, make_reels.merged(KEEP, SPEC["duration"]))

    def test_merged_sorts_clamps_and_joins(self):
        ranges = [[30, 40], [5, 15], [38, 45], [-3, 1], [95, 120], [60, 60]]
        self.assertEqual(make_reels.merged(ranges, 100.0), [[0.0, 1], [5, 15], [30, 45], [95, 100.0]])

    def test_complement_covers_everything_outside_keep(self):
        gaps = make_reels.complement([[5, 15], [30, 45]], 100.0)
        self.assertEqual([gap[:2] for gap in gaps], [[0.0, 5], [15, 30], [45, 100.0]])
        self.assertEqual(make_reels.complement([[0.0, 100.0]], 100.0), [])

    def test_a_pinned_keep_pins_the_removal_that_leads_into_it(self):
        # v5r QC r6: the unpinned edge at 180.05 snapped back into the [k] of the cut 'ko' at 179.913.
        keep = make_reels.merged([[30, 45, "pin"], [5, 15]], 100.0)
        self.assertEqual(keep, [[5, 15], [30, 45, "pin"]])
        outside = make_reels.OUTSIDE_KEEP
        self.assertEqual(make_reels.complement(keep, 100.0), [[0.0, 5, outside], [15, 30, outside, "pin"], [45, 100.0, outside]])
        self.assertTrue(make_reels.inside({"at": 31, "end": 40}, keep))

    def test_reel_spec_adds_the_complement_and_flags_the_reel(self):
        reel = self.reel()
        self.assertTrue(reel["reel"])
        self.assertEqual(reel["base"], "v4")
        self.assertEqual(reel["remove"][:2], SPEC["remove"])
        self.assertEqual([gap[:2] for gap in reel["remove"][2:]], [[0.0, 5.0], [15.0, 20.0], [25.0, 30.0], [60.0, 100.0]])
        for key in ("source", "duration", "trim_pauses", "facecam", "bleep", "blur"):
            self.assertEqual(reel[key], SPEC[key])
        self.assertEqual(len(SPEC["remove"]), 2, "the full edit's spec must not be mutated")

    def test_only_cutaways_inside_keep_ranges_survive(self):
        self.assertEqual([cutaway["title"] for cutaway in self.reel()["cutaways"]], ["kept", "on a keep edge"])

    def test_reel_edl_keeps_only_the_keep_ranges(self):
        segments, frames = edl.build(self.reel(), np.full(10_001, -20.0))
        keep = make_reels.merged(KEEP, SPEC["duration"])
        for segment in segments:
            middle = (segment["in"] + segment["out"]) / 2 / pipeline.FPS
            self.assertTrue(any(start <= middle <= end for start, end in keep), segment)
        # 10 + 5 + 30 s kept, minus the 2 s and 5 s removals inside them (every edge snaps by the same amount here).
        self.assertAlmostEqual(frames / pipeline.FPS, 38.0, delta=seconds(3))

    def test_bleep_on_removed_footage_maps_to_nothing(self):
        segments, frames = edl.build(self.reel(), np.full(10_001, -20.0))
        timeline = {"fps_num": pipeline.FPS_NUM, "fps_den": pipeline.FPS_DEN, "frames": frames, "segments": segments}
        self.assertEqual(pipeline.map_interval(80.0, 80.5, timeline), [])

    def test_main_writes_the_reel_spec_and_reports_the_estimate(self):
        with tempfile.TemporaryDirectory() as folder:
            work = Path(folder)
            (work / "cuts").mkdir()
            (work / "reels").mkdir()
            (work / "cuts" / "v4.json").write_text(json.dumps(SPEC), encoding="utf-8")
            (work / "reels" / "v4.json").write_text(json.dumps({"keep": KEEP}), encoding="utf-8")
            output = io.StringIO()
            with mock.patch.object(make_reels, "WORK", work), mock.patch.object(pipeline, "WORK", work), contextlib.redirect_stdout(output):
                make_reels.main("v4", "reels/v4.json")
            self.assertFalse((work / "cuts" / "v4r.json").exists())  # derived, so a job never mistakes it for a spec
            written = json.loads((work / "derived" / "cuts" / "v4r.json").read_text(encoding="utf-8"))
        self.assertTrue(written["reel"])
        self.assertIn("3 keep ranges, 45.0s kept, about 38.0s", output.getvalue())


if __name__ == "__main__":
    unittest.main()
