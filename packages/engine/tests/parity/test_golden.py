# Created by The Angelo Umali.
# The CPU golden render (plan §10.3): each fixture spec rendered by render_final on the CPU backend matches the committed
# frames, with the edit's frame count, the source's frame rate and an upright 1080x1920 picture.
import tempfile
import unittest
from pathlib import Path

from zks_engine import ffio
from zks_engine.pipeline import OUTPUT
from zks_engine.render_final import count_frames

from parity import harness


class GoldenRenderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        harness.skip_without_ffmpeg()
        cls.scratch = tempfile.TemporaryDirectory(prefix="zks-golden-")
        cls.masters = {key: harness.render(clip, "cpu", Path(cls.scratch.name) / clip.name) for key, clip in harness.CLIPS.items()}

    @classmethod
    def tearDownClass(cls):
        cls.scratch.cleanup()

    def test_each_master_has_exactly_the_edits_frame_count(self):
        for key, clip in harness.CLIPS.items():
            with self.subTest(clip.name):
                self.assertEqual(count_frames(self.masters[key]), harness.edl_of(clip)["frames"])

    def test_each_master_keeps_its_sources_frame_rate(self):
        for key, clip in harness.CLIPS.items():
            with self.subTest(clip.name):
                fps = ffio.probe(self.masters[key])["fps"]
                self.assertEqual((fps["num"], fps["den"]), clip.fps)

    def test_each_master_is_upright_1080x1920_with_no_rotation_tag(self):
        for key, clip in harness.CLIPS.items():
            with self.subTest(clip.name):
                info = ffio.probe(self.masters[key])
                self.assertEqual((info["size"]["width"], info["size"]["height"], info["rotation"]), (*OUTPUT, 0))

    def test_the_reference_is_a_libx264_encode(self):
        for key, clip in harness.CLIPS.items():
            with self.subTest(clip.name):
                self.assertTrue(harness.encoded_by_x264(self.masters[key]))

    def test_checked_frames_match_the_golden_pngs(self):
        for key, clip in harness.CLIPS.items():
            for frame in harness.check_frames(clip):
                with self.subTest(clip=clip.name, frame=frame):
                    rendered = harness.frame_png(self.masters[key], frame, Path(self.scratch.name) / f"{clip.name}-{frame}.png")
                    self.assertGreaterEqual(harness.ssim(rendered, harness.golden_of(clip, frame)), harness.GOLDEN_SSIM)

    def test_a_frame_one_step_off_falls_below_the_threshold(self):
        # Proves the threshold catches a dropped or repeated frame, the failure the frame-identity rules guard against.
        clip = harness.CLIPS["ntsc"]
        frame = harness.check_frames(clip)[0]
        neighbour = harness.frame_png(self.masters["ntsc"], frame + 1, Path(self.scratch.name) / "neighbour.png")
        self.assertLess(harness.ssim(neighbour, harness.golden_of(clip, frame)), harness.GOLDEN_SSIM)


if __name__ == "__main__":
    unittest.main()
