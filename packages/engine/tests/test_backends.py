# Created by The Angelo Umali.
# Render backends (plan §7): the doctor's probe result picks a profile, and each profile builds an exact graph and encoder.
import os
import unittest
from unittest import mock

from support import make_edl  # first: it sets a scratch ZKS_HOME

from zks_engine import backends
from zks_engine.backends import graph

PUNCHED = make_edl([(0, 30), (60, 90)], [1.0, 1.08])


def attempts(*passing):
    return [{"backend": name, "encoder": backends.get(name).probe_encoder, "ok": name in passing} for name in backends.PROBE_ORDER]


class SelectTests(unittest.TestCase):
    def test_the_first_backend_that_encoded_wins_in_probe_order(self):
        self.assertEqual(backends.select(attempts("vaapi", "qsv", "cpu")).name, "qsv")

    def test_nothing_passing_falls_back_to_cpu(self):
        self.assertEqual(backends.select(attempts()).name, "cpu")
        self.assertEqual(backends.select([]).name, "cpu")

    def test_a_doctor_check_result_is_read_from_its_data(self):
        check = {"id": "gpu", "status": "pass", "detail": "nvidia (hevc_nvenc)", "data": {"attempts": attempts("nvidia")}}
        self.assertEqual(backends.from_doctor(check).name, "nvidia")

    def test_a_pin_wins_over_the_probe(self):
        with mock.patch.dict(os.environ, {"ZKS_BACKEND": "amf"}), mock.patch.object(backends, "probe_attempts") as probe:
            self.assertEqual(backends.active().name, "amf")
        probe.assert_not_called()

    def test_an_unknown_pin_is_refused(self):
        with mock.patch.dict(os.environ, {"ZKS_BACKEND": "metal"}), self.assertRaisesRegex(SystemExit, "ZKS_BACKEND"):
            backends.active()

    def test_only_nvidia_and_cpu_claim_hardware_proof(self):
        proven = {name for name in backends.PROBE_ORDER if backends.get(name).hardware_tested}
        self.assertEqual(proven, {"nvidia", "cpu"})


class ProbeCacheTests(unittest.TestCase):
    def test_attempts_are_cached_per_ffmpeg_hash_and_driver(self):
        runs = []

        def run(command, **_):
            runs.append(command)
            return mock.Mock(returncode=0 if "libx265" in command else 1)

        with mock.patch.object(backends, "fingerprint", return_value="abc|1.0"), mock.patch.object(backends.subprocess, "run", side_effect=run):
            first = backends.probe_attempts(refresh=True)
            count = len(runs)
            self.assertEqual(backends.probe_attempts(), first)
            self.assertEqual(len(runs), count)
        self.assertEqual(backends.select(first).name, "cpu")
        self.assertEqual(count, len(backends.PROBE_ORDER) + 1)  # only cpu's encode passed, so only cpu ran its round trip

    def test_a_new_driver_runs_the_probe_again(self):
        with mock.patch.object(backends.subprocess, "run", return_value=mock.Mock(returncode=1)) as run:
            with mock.patch.object(backends, "fingerprint", return_value="abc|1.0"):
                backends.probe_attempts(refresh=True)
            with mock.patch.object(backends, "fingerprint", return_value="abc|2.0"):
                backends.probe_attempts()
        self.assertEqual(run.call_count, 2 * len(backends.PROBE_ORDER))


class RenderJobsTests(unittest.TestCase):
    def test_jobs_follow_the_profile(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("RENDER_JOBS", None)
            self.assertEqual(backends.render_jobs(backends.get("nvidia")), 4)
            self.assertEqual(backends.render_jobs(backends.get("videotoolbox")), 2)
            self.assertEqual(backends.render_jobs(backends.get("qsv")), 2)
            self.assertEqual(backends.render_jobs(backends.get("cpu"), cores=24), 6)
            self.assertEqual(backends.render_jobs(backends.get("cpu"), cores=2), 1)

    def test_the_env_overrides_the_profile(self):
        with mock.patch.dict(os.environ, {"RENDER_JOBS": "3"}):
            self.assertEqual(backends.render_jobs(backends.get("nvidia")), 3)


CPU_COMPOSITE = (
    "[0:v]select='between(n,0,29)+between(n,60,89)',settb=1001/30000,setpts=N,sidedata=mode=delete:type=DISPLAYMATRIX[upright];"
    "[upright]split[a][b];"
    "[a]scale=1080:1920:flags=lanczos[wide];"
    "[b]{punch},scale=1080:1920:flags=lanczos[punch];"
    "[wide][punch]overlay=enable='between(n,30,59)',eq=contrast=1.03:saturation=1.05[base];"
    "[1:v]scale=1080:1920:flags=lanczos:out_color_matrix=bt709:out_range=tv,format=yuva420p[ovl];"
    "[base][ovl]overlay=alpha=straight:eof_action=pass:repeatlast=0:ts_sync_mode=nearest,format=yuv420p,"
    "setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709{upload}[v]"
)


class CompositeGraphTests(unittest.TestCase):
    def composite(self, name, **options):
        return graph.composite(backends.get(name), PUNCHED, **options)

    def expected(self, upload):
        return CPU_COMPOSITE.format(punch=PUNCHED["punch_crop"], upload=upload)

    def test_cpu(self):
        self.assertEqual(self.composite("cpu"), self.expected(""))

    def test_amf_uses_the_cpu_filter_graph(self):
        self.assertEqual(self.composite("amf"), self.expected(",format=nv12"))

    def test_qsv(self):
        self.assertEqual(self.composite("qsv"), self.expected(",format=nv12"))

    def test_videotoolbox(self):
        self.assertEqual(self.composite("videotoolbox"), self.expected(",format=nv12"))

    def test_vaapi_uploads_to_its_device_last(self):
        self.assertEqual(self.composite("vaapi"), self.expected(",format=nv12,hwupload"))

    def test_nvidia_fallback_hands_nvenc_system_frames(self):
        self.assertEqual(self.composite("nvidia"), self.expected(""))

    def test_a_chunk_counts_select_from_its_seeked_first_frame(self):
        self.assertIn("select='between(n,0,9)+between(n,40,69)'", graph.composite(backends.get("cpu"), make_edl([(20, 30), (60, 90)]), first_frame=20))

    def test_4k_sharpens_the_footage_before_the_animation_layer(self):
        built = graph.composite(backends.get("cpu"), PUNCHED, size=(2160, 3840))
        self.assertIn(f"eq=contrast=1.03:saturation=1.05,{graph.CPU_CRISP}[base]", built)
        self.assertIn("[1:v]scale=2160:3840:flags=lanczos", built)

    def test_blur_runs_on_the_upright_source(self):
        built = graph.composite(backends.get("cpu"), PUNCHED, regions=[(0, 0, 64, 64, [(0, 10)])], frame_size=(432, 768))
        self.assertLess(built.index("gblur"), built.index("split[a][b]"))
        self.assertIn("[blurred]split[a][b]", built)


class EncoderTests(unittest.TestCase):
    def test_master_encoders(self):
        expected = {
            "nvidia": ["-c:v", "h264_nvenc"],
            "videotoolbox": ["-c:v", "h264_videotoolbox"],
            "qsv": ["-c:v", "h264_qsv"],
            "amf": ["-c:v", "h264_amf"],
            "vaapi": ["-c:v", "h264_vaapi"],
            "cpu": ["-c:v", "libx264"],
        }
        for name, codec in expected.items():
            self.assertEqual(backends.get(name).master(False)[:2], codec, name)

    def test_every_4k_export_is_hevc_tagged_hvc1(self):
        codecs = {name: backends.get(name).uhd[1] for name in backends.PROBE_ORDER}
        self.assertEqual(codecs, {"nvidia": "hevc_nvenc", "videotoolbox": "hevc_videotoolbox", "qsv": "hevc_qsv", "amf": "hevc_amf",
                                  "vaapi": "hevc_vaapi", "cpu": "libx265"})
        for name in backends.PROBE_ORDER:
            uhd = backends.get(name).uhd
            self.assertEqual(uhd[uhd.index("-tag:v") + 1], "hvc1", name)

    def test_exact_encoder_args(self):
        self.assertEqual(backends.get("vaapi").uhd, ["-c:v", "hevc_vaapi", "-rc_mode", "CQP", "-qp", "18", "-profile:v", "main",
                                                     "-tag:v", "hvc1"])
        self.assertEqual(backends.get("amf").uhd, ["-c:v", "hevc_amf", "-usage", "transcoding", "-quality", "quality", "-rc", "qvbr", "-qvbr_quality_level", "26",
                                                   "-b:v", "40M", "-maxrate", "60M", "-profile:v", "main", "-tag:v", "hvc1"])
        self.assertEqual(backends.get("qsv").uhd, ["-c:v", "hevc_qsv", "-preset", "veryslow", "-global_quality", "17", "-look_ahead_depth", "40",
                                                   "-maxrate", "60M", "-bufsize", "120M", "-profile:v", "main", "-tag:v", "hvc1"])
        self.assertEqual(backends.get("videotoolbox").uhd, ["-c:v", "hevc_videotoolbox", "-b:v", "40M", "-maxrate", "60M", "-bufsize", "120M",
                                                            "-profile:v", "main", "-tag:v", "hvc1"])
        self.assertEqual(backends.get("cpu").uhd, ["-c:v", "libx265", "-preset", "medium", "-crf", "17", "-x265-params", "log-level=error",
                                                   "-pix_fmt", "yuv420p", "-profile:v", "main", "-tag:v", "hvc1"])

    def test_decode_hands_back_system_frames_so_autorotate_turns_them(self):
        decodes = {name: backends.get(name).decode for name in backends.PROBE_ORDER}
        self.assertEqual(decodes, {"nvidia": ["-hwaccel", "cuda"], "videotoolbox": ["-hwaccel", "videotoolbox"], "qsv": ["-hwaccel", "qsv"],
                                   "amf": ["-hwaccel", "d3d11va"], "vaapi": ["-hwaccel", "vaapi", "-hwaccel_device", "va"], "cpu": []})

    def test_vaapi_opens_its_render_node_for_the_upload(self):
        self.assertEqual(backends.get("vaapi").device, ["-init_hw_device", "vaapi=va:/dev/dri/renderD128", "-filter_hw_device", "va"])


class IntroFilterTests(unittest.TestCase):
    def test_the_intro_scales_on_the_cpu_and_uploads_like_the_edit(self):
        self.assertEqual(graph.intro_filter(backends.get("vaapi"), (2160, 3840)),
                         "format=rgba,scale=2160:3840:flags=lanczos:out_color_matrix=bt709:out_range=tv,format=yuv420p,"
                         "setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709,format=nv12,hwupload")


if __name__ == "__main__":
    unittest.main()
