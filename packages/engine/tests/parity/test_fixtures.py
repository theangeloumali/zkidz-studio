# Created by The Angelo Umali.
# The parity fixtures are self-generated (lavfi testsrc2 + sine), small, and carry the properties the frame-count ACs need.
import hashlib
import tempfile
import unittest
from pathlib import Path

from zks_engine import ffio

from parity import harness

MAX_FIXTURE_BYTES = 2_000_000


class FixtureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        harness.skip_without_ffmpeg()

    def test_the_fixture_clips_stay_under_2_mb_together(self):
        total = sum(harness.source_of(clip).stat().st_size for clip in harness.CLIPS.values())
        self.assertLess(total, MAX_FIXTURE_BYTES)

    def test_each_clip_has_the_frame_rate_its_spec_declares(self):
        for clip in harness.CLIPS.values():
            with self.subTest(clip.name):
                fps = ffio.probe(harness.source_of(clip))["fps"]
                self.assertEqual((fps["num"], fps["den"]), clip.fps)

    def test_the_film_clip_runs_at_23_976(self):
        self.assertEqual(harness.CLIPS["film"].fps, (24000, 1001))

    def test_the_rotated_clip_is_stored_landscape_and_plays_portrait(self):
        info = ffio.probe(harness.source_of(harness.CLIPS["rotated"]))
        self.assertEqual(info["rotation"], 270)  # ffprobe's -90, mod 360
        self.assertEqual((info["size"]["width"], info["size"]["height"]), harness.SOURCE_SIZE)

    def test_every_clip_has_a_sine_track_for_the_edit_audio(self):
        for clip in harness.CLIPS.values():
            with self.subTest(clip.name):
                self.assertIsNotNone(ffio.probe(harness.source_of(clip))["audio"])

    def test_two_builds_of_a_project_draw_byte_identical_overlay_frames(self):
        # A run-to-run change in the overlay moved frame-0 SSIM by 0.002 and flaked the 0.995 parity AC.
        clip = harness.CLIPS["ntsc"]
        with tempfile.TemporaryDirectory() as folder:
            builds = [harness.build_project(clip, Path(folder) / str(index)) / "frames" / clip.name for index in range(2)]
            digests = [[hashlib.sha256(png.read_bytes()).hexdigest() for png in sorted(frames.glob("*.png"))] for frames in builds]
        self.assertEqual(digests[0], digests[1])


if __name__ == "__main__":
    unittest.main()
