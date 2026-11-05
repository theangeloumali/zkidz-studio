# Created by The Angelo Umali.
# The bystander blur's mask (#44): every face but the creator's, in source space, over the frames the edit keeps.
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import support  # noqa: F401  first: it sets a scratch ZKS_HOME

from zks_engine import face_mask, pipeline


class DrawTests(unittest.TestCase):
    def test_the_mask_covers_every_face_but_the_creators(self):
        sample = {"t": 1.0, "faces": [{"box": [100, 900, 60, 60], "track": 0}, {"box": [800, 900, 60, 60], "track": 1}]}
        mask = face_mask.draw([sample], 1.0, creator={0}, size=(1080, 1920))
        self.assertEqual(mask[930, 130], 0)
        self.assertGreater(mask[930, 830], 200)

    def test_a_face_moving_between_samples_stays_covered_on_its_way(self):
        # OnePuhunan 11:20: a colleague turned her head between two samples and her face slid out of the nearest one's ellipse.
        seen = [{"t": 1.0, "faces": [{"box": [100, 900, 60, 60], "track": 1}]}, {"t": 1.5, "faces": [{"box": [300, 900, 60, 60], "track": 1}]}]
        mask = face_mask.draw(seen, 1.25, creator=set(), size=(1080, 1920))
        self.assertTrue(all(mask[930, x] == 255 for x in (130, 230, 330)))

    def test_a_face_missed_for_a_moment_stays_blurred(self):
        seen = [{"t": 1.0, "faces": [{"box": [800, 900, 60, 60], "track": 1}]}, {"t": 1.5, "faces": []}]
        self.assertGreater(face_mask.draw(seen, 1.9, creator=set(), size=(1080, 1920))[930, 830], 200)
        self.assertEqual(face_mask.draw(seen, 1.0 + face_mask.HOLD_S + 0.5, creator=set(), size=(1080, 1920))[930, 830], 0)


class WriteTests(unittest.TestCase):
    def setUp(self):
        # The mask and its key go to pipeline.WORK: a scratch folder, or a stale key from the last run reads as a cache hit.
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        patcher = mock.patch.object(pipeline, "WORK", Path(folder.name))
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_only_the_kept_source_frames_are_drawn_the_rest_is_black(self):
        segments = [{"in": 30, "out": 60, "target": 0}, {"in": 90, "out": 120, "target": 30}]
        with mock.patch.object(face_mask.matte, "write_mask") as write:
            face_mask.write("v1", [], set(), segments, total=150)
        out, total, drawn = write.call_args.args
        self.assertEqual((out.name, total), ("v1.faces.mkv", 150))
        self.assertEqual([(first, count) for first, count, _ in drawn], [(30, 30), (90, 30)])

    def test_frames_go_to_the_encoder_as_full_range_bytes(self):
        # matte.encode squashes to 16..235 itself; pre-squashed bytes were squashed twice (#44).
        sample = {"t": 0.0, "faces": [{"box": [800, 900, 60, 60], "track": 1}]}
        with mock.patch.object(face_mask.matte, "write_mask") as write:
            face_mask.write("v1", [sample], set(), [{"in": 0, "out": 1, "target": 0}], total=1)
        frame = next(write.call_args.args[2][0][2])
        self.assertEqual((frame.dtype.name, int(frame[0, 0]), int(frame[930, 830])), ("uint8", 0, 255))

    def test_an_unchanged_mask_is_not_written_again(self):
        # A cue-only fix re-renders with the same faces and cuts: the 5-minute mask is reused, not redrawn.
        segments = [{"in": 30, "out": 60, "target": 0}]
        sample = {"t": 1.0, "faces": [{"box": [800, 900, 60, 60], "track": 1}]}
        with mock.patch.object(face_mask.matte, "write_mask", side_effect=lambda out, *_: out.write_bytes(b"mask")) as write:
            face_mask.write("v9", [sample], set(), segments, total=150)
            face_mask.write("v9", [sample], set(), segments, total=150)
            self.assertEqual(write.call_count, 1)
            face_mask.write("v9", [sample], {1}, segments, total=150)  # he is now the creator: a different mask
            self.assertEqual(write.call_count, 2)


if __name__ == "__main__":
    unittest.main()
