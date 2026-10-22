# Created by The Angelo Umali.
# EDL invariants: removals, slivers, face-cam punch-in, cutaway pinning and the written payload.
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np
import support  # noqa: F401  first: it sets a scratch ZKS_HOME

from zks_engine import edl
from zks_engine import pipeline


class EdlTests(unittest.TestCase):
    def spec(self, remove, duration=20.0, **extra):
        return {"duration": duration, "remove": remove, "facecam": [[0, duration]],
                "trim_pauses": {"threshold_db": -90, "min": 99, "keep": 0.2, "exclude": []}, **extra}

    def test_short_removal_never_inverts(self):
        # Quiet window at 5.20 s: both ends of a 0.2 s removal can snap onto it in reverse order.
        energy = np.full(2000, -20.0)
        energy[520] = -80.0
        segments, frames = edl.build(self.spec([[5.25, 5.15, "inverted"]]), energy)
        for earlier, later in zip(segments, segments[1:]):
            self.assertLessEqual(earlier["out"], later["in"])
        self.assertLessEqual(frames, round(20.0 * pipeline.FPS))

    def test_segments_monotonic_and_targets_contiguous(self):
        segments, frames = edl.build(self.spec([[3.0, 4.0, "a"], [9.0, 11.0, "b"]]), np.full(2000, -20.0))
        target = 0
        for segment in segments:
            self.assertEqual(segment["target"], target)
            target += segment["out"] - segment["in"]
        self.assertEqual(target, frames)

    def test_pinned_removal_keeps_its_edges(self):
        # A quieter dip inside the snap window would pull a normal edge into the word before it.
        energy = np.full(2000, -20.0)
        energy[508] = -80.0
        snapped, _ = edl.build(self.spec([[3.0, 5.1, "snaps"]]), energy)
        pinned, _ = edl.build(self.spec([[3.0, 5.1, "held", "pin"]]), energy)
        self.assertEqual(snapped[1]["in"], round(5.08 * pipeline.FPS))
        self.assertEqual(pinned[1]["in"], round(5.1 * pipeline.FPS))

    def test_slivers_dropped(self):
        segments, _ = edl.build(self.spec([[3.0, 4.0, "a"], [4.1, 6.0, "b"]]), np.full(2000, -20.0))
        for segment in segments:
            self.assertGreaterEqual(segment["out"] - segment["in"], edl.MIN_SEGMENT * pipeline.FPS)

    def test_punch_in_needs_the_whole_segment_on_face_cam(self):
        # 4-9 s starts on a screen shot and ends on face-cam: its midpoint is on face-cam, but it must not zoom.
        spec = self.spec([[3.0, 4.0, "a", "pin"], [9.0, 10.0, "b", "pin"], [14.0, 15.0, "c", "pin"]], facecam=[[5.0, 20.0]])
        segments, _ = edl.build(spec, np.full(2000, -20.0))
        self.assertEqual([segment["facecam"] for segment in segments], [False, False, True, True])
        self.assertEqual([segment["zoom"] for segment in segments], [1.0, 1.0, 1.0, edl.FACECAM_ZOOM])

    def test_segment_on_the_face_cam_edges_counts(self):
        # The range starts on a cut and ends one frame before the file does (a hand-typed "to the end").
        spec = self.spec([[3.0, 4.0, "a", "pin"], [9.0, 10.0, "b", "pin"]], facecam=[[4.0, 19.96]])
        segments, _ = edl.build(spec, np.full(2000, -20.0))
        self.assertEqual([segment["facecam"] for segment in segments], [False, True, True])

    def test_cutaway_pinned_to_its_cut(self):
        segments = [{"in": 0, "out": 100}, {"in": 3175, "out": 3500}]
        pinned = edl.pin_cutaways([{"at": 106.1, "end": 108.8, "title": "x", "style": "wipe"}], segments)
        self.assertAlmostEqual(pinned[0]["at"], 3175 / pipeline.FPS)
        self.assertEqual(pinned[0]["style"], "wipe")

    def test_distant_cutaway_untouched(self):
        pinned = edl.pin_cutaways([{"at": 50.0, "end": 52.0}], [{"in": 0, "out": 100}, {"in": 3175, "out": 3500}])
        self.assertEqual(pinned[0]["at"], 50.0)

    def written(self, video, spec):
        segments, frames = edl.build(spec, np.full(2000, -20.0))
        with tempfile.TemporaryDirectory() as work, mock.patch.object(edl, "WORK", Path(work)):
            edl.write_outputs(video, spec, segments, frames)
            return json.loads((Path(work) / "edl" / f"{video}.json").read_text(encoding="utf-8"))

    def test_reel_flag_base_and_cutaway_style_pass_through(self):
        cutaway = {"at": 5.0, "end": 6.0, "title": "t", "style": "wipe"}
        payload = self.written("v4r", self.spec([], reel=True, base="v4", cutaways=[cutaway]))
        self.assertTrue(payload["reel"])
        self.assertEqual(payload["base"], "v4")
        self.assertEqual(payload["cutaways"][0]["style"], "wipe")

    def test_full_edit_is_not_a_reel(self):
        payload = self.written("v4", self.spec([]))
        self.assertFalse(payload["reel"])
        self.assertEqual(payload["base"], "v4")


if __name__ == "__main__":
    unittest.main()


class ZoomTests(unittest.TestCase):
    """Animated zooms are authored in source seconds and written as edited frames."""

    def written(self, spec):
        with tempfile.TemporaryDirectory() as work, mock.patch.object(edl, "WORK", Path(work)):
            segments, frames = edl.build(spec, np.full(2000, -20.0))
            edl.write_outputs("v9", spec, segments, frames)
            return json.loads((Path(work) / "edl" / "v9.json").read_text(encoding="utf-8"))

    def spec(self, zooms, remove=()):
        return {"duration": 20.0, "remove": [list(item) for item in remove], "facecam": [], "zooms": zooms,
                "trim_pauses": {"threshold_db": -90, "min": 99, "keep": 0.2, "exclude": []}}

    def test_window_maps_to_edited_frames_across_an_earlier_cut(self):
        payload = self.written(self.spec([[5.0, 6.0, "snap"]], remove=[(3.0, 4.0, "a", "pin")]))
        zoom = payload["zooms"][0]
        self.assertEqual(zoom["preset"], "snap")
        self.assertAlmostEqual(zoom["start"], round(5.0 * pipeline.FPS) - (round(4.0 * pipeline.FPS) - round(3.0 * pipeline.FPS)), delta=1)
        self.assertAlmostEqual(zoom["end"] - zoom["start"], round(1.0 * pipeline.FPS), delta=1)

    def test_centre_defaults_to_the_punch_in_framing(self):
        zoom = self.written(self.spec([[5.0, 6.0, "push"]]))["zooms"][0]
        self.assertEqual(zoom["cx"], 0.5)
        self.assertAlmostEqual(zoom["cy"], edl.PUNCH_TOP + 0.5 / edl.FACECAM_ZOOM)

    def test_window_wholly_removed_is_dropped(self):
        self.assertEqual(self.written(self.spec([[3.2, 3.8, "snap"]], remove=[(3.0, 4.0, "a", "pin")]))["zooms"], [])

    def test_unknown_preset_is_refused(self):
        with self.assertRaises(SystemExit):
            self.written(self.spec([[5.0, 6.0, "wobble"]]))

    def test_no_zooms_writes_an_empty_list(self):
        self.assertEqual(self.written(self.spec([]))["zooms"], [])


class PortalTests(unittest.TestCase):
    """A portal pushes into a screen's corners until it fills the frame, then the edit cuts to that screen's insert."""

    def test_portal_targets_the_quad_centre_and_fill_scale(self):
        spec = {"duration": 20.0, "remove": [], "facecam": [], "trim_pauses": {"threshold_db": -90, "min": 99, "keep": 0.2, "exclude": []},
                "portals": [[5.0, 6.0, 270, 480, 810, 480, 810, 960, 270, 960]]}
        segments, frames = edl.build(spec, np.full(2000, -20.0))
        zoom = edl.map_portals(spec["portals"], segments)[0]
        self.assertEqual(zoom["preset"], "portal")
        self.assertAlmostEqual(zoom["cx"], 540 / 1080)
        self.assertAlmostEqual(zoom["cy"], 720 / 1920)
        self.assertAlmostEqual(zoom["to"], 2.0)  # 540 px wide on a 1080 frame


class EmptyZoomTests(unittest.TestCase):
    def test_window_touching_a_kept_range_only_at_its_end_is_dropped(self):
        segments = [{"in": 0, "out": 90, "target": 0}, {"in": 300, "out": 400, "target": 90}]
        self.assertEqual(edl.map_zooms([[9.0, 10.0, "snap"]], segments), [])


class MatteWindowTests(unittest.TestCase):
    def test_matte_windows_map_to_edited_frames(self):
        segments = [{"in": 0, "out": 90, "target": 0}, {"in": 120, "out": 300, "target": 90}]
        self.assertEqual(edl.map_windows([[5.0, 6.0]], segments), [{"start": 90 + round(5.0 * pipeline.FPS) - 120, "end": 90 + round(6.0 * pipeline.FPS) - 120}])

    def test_removed_matte_window_is_dropped(self):
        segments = [{"in": 0, "out": 90, "target": 0}, {"in": 300, "out": 400, "target": 90}]
        self.assertEqual(edl.map_windows([[4.0, 8.0]], segments), [])
