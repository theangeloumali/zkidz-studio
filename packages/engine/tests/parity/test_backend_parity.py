# Created by The Angelo Umali.
# Backend parity (plan §12): ZKS_PARITY_BACKEND=<name> renders every fixture spec on that backend and on the CPU, and the
# checked frames must agree to PARITY_SSIM. Unset or cpu, there is nothing to compare and the class skips.
import os
import tempfile
import unittest
from pathlib import Path

from zks_engine.render_final import count_frames

from parity import harness

BACKEND = os.environ.get("ZKS_PARITY_BACKEND", "cpu")


@unittest.skipIf(BACKEND == "cpu", "set ZKS_PARITY_BACKEND to a hardware backend (nvidia, videotoolbox, qsv, amf, vaapi)")
class BackendParityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        harness.skip_without_ffmpeg()
        harness.skip_unless_usable(BACKEND)
        cls.scratch = tempfile.TemporaryDirectory(prefix="zks-parity-")
        root = Path(cls.scratch.name)
        cls.masters = {
            key: {backend: harness.render(clip, backend, root / backend / clip.name) for backend in ("cpu", BACKEND)} for key, clip in harness.CLIPS.items()
        }
        cls.repeat = harness.render(harness.CLIPS["ntsc"], BACKEND, root / "repeat")

    @classmethod
    def tearDownClass(cls):
        cls.scratch.cleanup()

    def test_the_backend_renders_the_same_frame_count_as_the_cpu(self):
        for key, clip in harness.CLIPS.items():
            with self.subTest(clip.name):
                masters = self.masters[key]
                self.assertEqual(count_frames(masters[BACKEND]), count_frames(masters["cpu"]))

    def test_a_second_render_of_the_same_spec_decodes_to_identical_frames(self):
        # A score that moves between identical runs cannot hold a 0.995 bar: the AC flaked at frame 0 before this held.
        self.assertEqual(harness.frame_digests(self.repeat), harness.frame_digests(self.masters["ntsc"][BACKEND]))

    def test_checked_frames_match_the_cpu_render(self):
        for key, clip in harness.CLIPS.items():
            for frame in harness.check_frames(clip):
                with self.subTest(clip=clip.name, frame=frame):
                    pngs = [harness.frame_png(self.masters[key][backend], frame, Path(self.scratch.name) / f"{backend}-{clip.name}-{frame}.png")
                            for backend in ("cpu", BACKEND)]
                    self.assertGreaterEqual(harness.ssim(*pngs), harness.PARITY_SSIM)


if __name__ == "__main__":
    unittest.main()
