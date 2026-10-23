# Created by The Angelo Umali.
# verify:gpu's engine half: render one fixture per passing backend and hold it to SSIM >= 0.995 against the cpu render.
import io
import shutil
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

import support  # noqa: F401  first: it sets a scratch ZKS_HOME

from zks_engine import backends, ffio, render_final
from zks_engine.backends import parity


def attempts(*passing):
    return [{"backend": name, "encoder": backends.get(name).probe_encoder, "ok": name in passing} for name in backends.PROBE_ORDER]


def run_main(passing, scores=None):
    out = io.StringIO()
    with (mock.patch.object(parity.backends, "probe_attempts", return_value=attempts(*passing)),
          mock.patch.object(parity, "build_fixture"), mock.patch.object(parity, "render", side_effect=lambda backend, root: Path(backend.name)),
          mock.patch.object(parity, "ssim", side_effect=lambda candidate, reference: (scores or {})[candidate.name]), redirect_stdout(out)):
        code = parity.main()
    return code, out.getvalue()


class ParityMainTests(unittest.TestCase):
    def test_no_gpu_backend_skips_with_the_reason_and_passes(self):
        code, out = run_main({"cpu"})
        self.assertEqual(code, 0)
        self.assertIn("skip: no GPU backend passed the probe", out)

    def test_every_passing_gpu_backend_is_held_to_the_threshold(self):
        code, out = run_main({"nvidia", "vaapi", "cpu"}, {"nvidia": 0.998, "vaapi": 0.990})
        self.assertEqual(code, 1)
        self.assertIn("PASS nvidia", out)
        self.assertIn("FAIL vaapi", out)
        self.assertIn("untested on hardware", out)

    def test_all_above_the_threshold_passes(self):
        self.assertEqual(run_main({"nvidia", "cpu"}, {"nvidia": 0.9951})[0], 0)


class SsimTests(unittest.TestCase):
    def test_the_all_score_is_read_from_ffmpegs_summary(self):
        log = "[Parsed_ssim_0 @ 0x1] SSIM Y:0.998 (27.1) U:0.999 (30.0) V:0.999 (30.2) All:0.998512 (28.27)\n"
        with mock.patch.object(parity.subprocess, "run", return_value=mock.Mock(stderr=log, returncode=0)):
            self.assertAlmostEqual(parity.ssim(Path("a.mp4"), Path("b.mp4")), 0.998512)


@unittest.skipUnless(shutil.which(ffio.ffmpeg_bin()), "needs ffmpeg")
class CpuRenderTests(unittest.TestCase):
    def test_the_cpu_fixture_renders_every_frame_and_matches_itself(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            parity.build_fixture(root)
            out = parity.render(backends.get("cpu"), root)
            self.assertEqual(render_final.count_frames(out), parity.FRAMES)
            self.assertGreater(parity.ssim(out, out), 0.999)


if __name__ == "__main__":
    unittest.main()
