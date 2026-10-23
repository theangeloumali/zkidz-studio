# Created by The Angelo Umali.
# §7.2: the probe runs the render's own path (decode -> composite -> encode) on 8 testsrc2 frames, not an encode alone.
import unittest
from unittest import mock

import support  # noqa: F401  first: it sets a scratch ZKS_HOME

from zks_engine import backends
from zks_engine.backends import graph

PREAMBLE = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin"]
VAAPI_DEVICE = ["-init_hw_device", "vaapi=va:/dev/dri/renderD128", "-filter_hw_device", "va"]


class ProbeCommandTests(unittest.TestCase):
    def commands(self, name):
        return backends.probe_commands(backends.get(name), "ffmpeg", "sample.mkv")

    def test_the_sample_is_eight_testsrc2_frames_through_the_backends_encoder(self):
        encode, _ = self.commands("cpu")
        self.assertEqual(encode, [*PREAMBLE, "-y", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30", "-frames:v", "8",
                                  "-vf", "format=yuv420p", "-c:v", "libx265", "sample.mkv"])

    def test_the_round_trip_decodes_with_the_backend_and_runs_the_composite(self):
        nvidia = backends.get("nvidia")
        _, round_trip = self.commands("nvidia")
        self.assertEqual(round_trip, [*PREAMBLE, "-hwaccel", "cuda", "-i", "sample.mkv",
                                      "-f", "lavfi", "-i", "color=c=black@0:size=320x240:rate=30,format=rgba,trim=end_frame=1",
                                      "-filter_complex", graph.composite(nvidia, backends.PROBE_EDL, size=(320, 240)), "-map", "[v]",
                                      "-frames:v", "8", "-c:v", "hevc_nvenc", "-f", "null", "-"])

    def test_vaapi_opens_its_render_node_and_uploads_for_both_steps(self):
        encode, round_trip = self.commands("vaapi")
        self.assertEqual(encode[5:9], VAAPI_DEVICE)
        self.assertEqual(round_trip[5:9], VAAPI_DEVICE)
        self.assertEqual(encode[encode.index("-vf") + 1], "format=nv12,hwupload")
        self.assertTrue(round_trip[round_trip.index("-filter_complex") + 1].endswith(",format=nv12,hwupload[v]"))
        self.assertEqual(round_trip[round_trip.index("-c:v") + 1], "hevc_vaapi")


class RunProbeTests(unittest.TestCase):
    def test_a_failed_encode_skips_the_round_trip(self):
        with mock.patch.object(backends.subprocess, "run", return_value=mock.Mock(returncode=1)) as run:
            self.assertFalse(backends.run_probe(backends.get("qsv")))
        self.assertEqual(run.call_count, 1)

    def test_a_failed_round_trip_fails_the_backend(self):
        with mock.patch.object(backends.subprocess, "run", side_effect=[mock.Mock(returncode=0), mock.Mock(returncode=1)]):
            self.assertFalse(backends.run_probe(backends.get("amf")))

    def test_both_steps_passing_passes_the_backend(self):
        with mock.patch.object(backends.subprocess, "run", return_value=mock.Mock(returncode=0)) as run:
            self.assertTrue(backends.run_probe(backends.get("cpu")))
        self.assertEqual(run.call_count, 2)


if __name__ == "__main__":
    unittest.main()
