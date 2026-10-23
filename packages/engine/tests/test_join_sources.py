# Created by The Angelo Umali.
# join_sources pieces: hwdownload cannot convert NVDEC surfaces, so each clip downloads in its own bit depth; every other
# backend (and a quarter-turned clip without transpose_cuda) decodes to system frames that autorotate turns.
import dataclasses
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from support import media_file, media_project, has_ffmpeg  # first: it sets a scratch ZKS_HOME

from zks_engine import backends, ffio, join_sources
from zks_engine.pipeline import has_cuda

NVIDIA, CPU = backends.get("nvidia"), backends.get("cpu")
NVIDIA_VULKAN = dataclasses.replace(NVIDIA, libplacebo=True)  # the probe found a Vulkan GPU for libplacebo


def command_for(clip, backend=NVIDIA_VULKAN, transpose_cuda=True):
    with mock.patch.object(join_sources, "has_filter", return_value=transpose_cuda):
        return join_sources.piece_command(clip, 0, 30, Path("out.mp4"), backend)


def piece_filter(clip, backend=NVIDIA_VULKAN, transpose_cuda=True):
    command = command_for(clip, backend, transpose_cuda)
    return command[command.index("-vf") + 1]


def clip(name="a.mp4", **fields):
    return join_sources.Clip(media_file(name), 30, **{"hdr": False, "zoom": 1.0, "ten_bit": False, **fields})


class PieceCommandTests(unittest.TestCase):
    def test_an_8_bit_clip_downloads_nv12(self):
        self.assertIn("hwdownload,format=nv12,", piece_filter(clip()))

    def test_a_10_bit_clip_downloads_p010le(self):
        self.assertIn("hwdownload,format=p010le,", piece_filter(clip(hdr=True, ten_bit=True)))

    def test_a_portrait_phone_clip_turns_upright_on_the_gpu(self):
        # iPhone stores 3840x2160 with a -90 display matrix; NVDEC frames are never autorotated (#39).
        self.assertIn("transpose_cuda=dir=clock,hwdownload,format=p010le,", piece_filter(clip("a.mov", hdr=True, ten_bit=True, rotation=270)))

    def test_without_transpose_cuda_a_quarter_turn_decodes_to_system_frames(self):
        command = command_for(clip("a.mov", rotation=270), transpose_cuda=False)
        graph = command[command.index("-vf") + 1]
        self.assertNotIn("hwdownload", graph)
        self.assertNotIn("transpose", graph)
        self.assertIn(join_sources.SCALE, graph)
        self.assertNotIn("-hwaccel_output_format", command)

    def test_the_display_matrix_is_dropped_so_players_do_not_turn_it_again(self):
        self.assertIn("sidedata=mode=delete:type=DISPLAYMATRIX", piece_filter(clip("a.mov", rotation=270)))

    def test_an_unrotated_clip_is_not_turned(self):
        self.assertNotIn("transpose", piece_filter(clip(hdr=True, ten_bit=True)))

    def test_frames_restamp_onto_the_clips_own_rate(self):
        command = command_for(clip(fps=(25, 1)))
        self.assertIn("settb=1/25,setpts=N", command[command.index("-vf") + 1])
        self.assertEqual(command[command.index("-r") + 1], "25/1")


class BackendPieceTests(unittest.TestCase):
    def test_the_cpu_backend_scales_and_tone_maps_on_the_cpu(self):
        command = command_for(clip(hdr=True, ten_bit=True, zoom=1.25), CPU)
        self.assertEqual(command[command.index("-vf") + 1],
                         "select='between(n,0,29)',crop=iw/1.25:ih/1.25:(iw-iw/1.25)/2:0,"
                         f"{join_sources.CPU_TONEMAP},{join_sources.CPU_SCALE},settb=1001/30000,setpts=N,sidedata=mode=delete:type=DISPLAYMATRIX")
        self.assertNotIn("vulkan", command)
        self.assertEqual(command[command.index("-c:v"):command.index("-an")], CPU.mezzanine)

    def test_vaapi_uploads_the_finished_frame_to_its_render_node(self):
        vaapi = backends.get("vaapi")
        command = command_for(clip(), vaapi)
        self.assertTrue(command[command.index("-vf") + 1].endswith(",format=nv12,hwupload"))
        self.assertLess(command.index("vaapi=va:/dev/dri/renderD128"), command.index("-i"))
        self.assertEqual(command[command.index("-c:v"):command.index("-an")], vaapi.mezzanine)

    def test_pieces_split_by_the_backends_jobs(self):
        long = join_sources.Clip(media_file("a.mp4"), 9000, False, 1.0, False)
        self.assertEqual(len(join_sources.pieces([long], 2)), 2)
        self.assertEqual(len(join_sources.pieces([long], 4)), 4)


CUDA_DECODE = ["-init_hw_device", "cuda=cu:0", "-filter_hw_device", "cu", "-hwaccel", "cuda", "-hwaccel_device", "cu"]
TO_4K = "scale_cuda=2160:3840:interp_algo=lanczos:format=yuv420p,setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709"
TAIL = "settb=1001/30000,setpts=N,sidedata=mode=delete:type=DISPLAYMATRIX"


class CudaPieceTests(unittest.TestCase):
    """NVIDIA without a libplacebo Vulkan device (WSL: only llvmpipe): scale and zoom stay on CUDA, and only an HDR
    tone-map or a half turn leaves the GPU, at the source's size, between download and upload."""

    def test_an_8_bit_sdr_clip_never_leaves_cuda(self):
        command = command_for(clip(), NVIDIA)
        self.assertEqual(command[command.index("-vf") + 1], f"select='between(n,0,29)',colorspace_cuda=range=tv,{TO_4K},{TAIL}")
        self.assertEqual(command[5:15], [*CUDA_DECODE, "-hwaccel_output_format", "cuda"])
        self.assertEqual(command[command.index("-c:v"):command.index("-an")], NVIDIA.mezzanine)

    def test_a_zoom_scales_up_on_cuda_and_crops_its_top_centre_window_after_download(self):
        # Not overlay_cuda: on a scale_cuda frame it pads the width to 2176 (16 green columns).
        graph = piece_filter(clip(zoom=1.25), NVIDIA)
        self.assertEqual(graph, "select='between(n,0,29)',colorspace_cuda=range=tv,scale_cuda=2700:4800:interp_algo=lanczos:format=yuv420p,"
                                f"setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709,hwdownload,format=yuv420p,crop=2160:3840:270:0,{TAIL}")

    def test_hdr_tone_maps_between_download_and_upload_then_scales_on_cuda(self):
        graph = piece_filter(clip(hdr=True, ten_bit=True, rotation=270), NVIDIA)
        self.assertEqual(graph, f"select='between(n,0,29)',transpose_cuda=dir=clock,hwdownload,format=p010le,{join_sources.CPU_TONEMAP},hwupload,"
                                f"colorspace_cuda=range=tv,{TO_4K},{TAIL}")

    def test_a_half_turn_flips_between_download_and_upload(self):
        self.assertIn("hwdownload,format=nv12,hflip,vflip,format=yuv420p,hwupload,colorspace_cuda", piece_filter(clip(rotation=180), NVIDIA))

    def test_without_transpose_cuda_a_quarter_turn_uploads_its_autorotated_frames(self):
        command = command_for(clip("a.mov", rotation=270), NVIDIA, transpose_cuda=False)
        self.assertEqual(command[5:13], CUDA_DECODE)
        self.assertNotIn("-hwaccel_output_format", command)
        self.assertEqual(command[command.index("-vf") + 1], f"select='between(n,0,29)',format=yuv420p,hwupload,colorspace_cuda=range=tv,{TO_4K},{TAIL}")

    def test_a_codec_nvdec_cannot_decode_uploads_system_frames(self):
        # ProRes and FFV1 have no NVDEC: CUDA output frames were software ones, and colorspace_cuda failed on them.
        command = command_for(clip("a.mov", nvdec=False), NVIDIA)
        self.assertNotIn("-hwaccel_output_format", command)
        self.assertEqual(command[command.index("-vf") + 1], f"select='between(n,0,29)',format=yuv420p,hwupload,colorspace_cuda=range=tv,{TO_4K},{TAIL}")
        self.assertNotIn("hwdownload", piece_filter(clip("a.mov", nvdec=False)))  # the libplacebo route too

    def test_no_route_opens_vulkan_or_scales_on_the_cpu(self):
        for fields in ({}, {"zoom": 1.25}, {"hdr": True, "ten_bit": True}, {"rotation": 180}, {"rotation": 270}):
            for transpose_cuda in (True, False):
                command = " ".join(command_for(clip(**fields), NVIDIA, transpose_cuda))
                for cpu_or_vulkan in ("vulkan", "libplacebo", "flags=lanczos", "libx26"):
                    self.assertNotIn(cpu_or_vulkan, command, (fields, transpose_cuda))


@unittest.skipUnless(has_ffmpeg() and has_cuda(), "needs ffmpeg with CUDA and NVENC")
class CudaPieceRenderTests(unittest.TestCase):
    """The CUDA route through real NVDEC, scale_cuda / overlay_cuda and NVENC: exact counts and a picture that moves."""

    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)

    def source(self, name, hdr):
        tags = "format=yuv420p10le,setparams=color_trc=arib-std-b67:color_primaries=bt2020:colorspace=bt2020nc:range=tv" if hdr else (
            "format=yuv420p,setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709")
        path = self.root / name
        subprocess.run([ffio.ffmpeg_bin(), "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=540x960:rate=30000/1001:duration=1", "-vf", tags,
                        "-c:v", "hevc_nvenc", *(["-profile:v", "main10"] if hdr else []), str(path)], check=True)
        return path

    def test_sdr_zoom_and_hdr_pieces_render_every_frame_at_4k_and_move(self):
        for name, hdr, zoom in (("sdr.mp4", False, 1.25), ("hlg.mp4", True, 1.0)):
            piece = join_sources.Clip(self.source(name, hdr), 30, hdr, zoom, hdr)
            out = self.root / f"out-{name}"
            result = subprocess.run(join_sources.piece_command(piece, 5, 20, out, NVIDIA), capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(join_sources.count_frames(out), 20, name)
            report = subprocess.run([ffio.ffmpeg_bin(), "-v", "error", "-i", str(out), "-f", "framemd5", "-"], capture_output=True, text=True, check=True)
            hashes = {line.split(",")[-1] for line in report.stdout.splitlines() if line and not line.startswith("#")}
            self.assertGreater(len(hashes), 15, f"{name}: frames repeat, the picture is frozen")
            size = subprocess.run([ffio.ffprobe_bin(), "-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", str(out)],
                                  capture_output=True, text=True, check=True).stdout.strip()
            self.assertEqual(size, "2160,3840", name)


class RateTests(unittest.TestCase):
    def probe(self, rate, codec="hevc"):
        stream = {"streams": [{"nb_read_packets": "50", "r_frame_rate": rate, "pix_fmt": "yuv420p", "codec_name": codec}]}
        with (mock.patch.object(join_sources.subprocess, "run", return_value=mock.Mock(stdout=__import__("json").dumps(stream))),
              mock.patch.object(join_sources, "probe_video", return_value={}), media_project()):
            return join_sources.probe(str(media_file("a.mp4")))

    def test_any_constant_rate_is_read(self):
        for rate, fps in (("24000/1001", (24000, 1001)), ("25/1", (25, 1)), ("30000/1001", (30000, 1001)), ("30/1", (30, 1)),
                          ("60000/1001", (60000, 1001))):
            self.assertEqual(self.probe(rate).fps, fps, rate)

    def test_the_codec_says_whether_nvdec_decodes_the_clip(self):
        self.assertTrue(self.probe("30/1", "hevc").nvdec)
        self.assertTrue(self.probe("30/1", "h264").nvdec)
        self.assertFalse(self.probe("30/1", "prores").nvdec)
        self.assertFalse(self.probe("30/1", "ffv1").nvdec)

    def test_clips_at_different_rates_are_refused(self):
        with self.assertRaisesRegex(SystemExit, "25/1"):
            join_sources.common_rate([clip(), clip(fps=(25, 1))])
        self.assertEqual(join_sources.common_rate([clip(fps=(25, 1))]), (25, 1))


@unittest.skipUnless(has_ffmpeg(), "needs ffmpeg")
class FrameExactTests(unittest.TestCase):
    """Real decodes on the cpu backend: select by decode index, then restamp, keeps exact counts at every rate."""

    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)

    def source(self, name, rate, rotation=None):
        path = self.root / name
        subprocess.run([ffio.ffmpeg_bin(), "-v", "error", "-f", "lavfi", "-i", f"testsrc2=size=320x180:rate={rate}:duration=1.5", "-c:v", "libx264",
                        "-pix_fmt", "yuv420p", str(path)], check=True)
        if rotation is None:
            return path
        turned = self.root / f"turned-{name}"
        subprocess.run([ffio.ffmpeg_bin(), "-v", "error", "-display_rotation", str(rotation), "-i", str(path), "-c", "copy", str(turned)], check=True)
        return turned

    def frames(self, path, rate):
        piece = join_sources.Clip(path, 0, False, 1.0, False, fps=tuple(int(part) for part in rate.split("/")))
        command = join_sources.piece_command(piece, 5, 20, Path("unused.mp4"), CPU)
        out = command.index("-c:v")
        decode = subprocess.run([*command[:out], "-f", "framecrc", "-"], capture_output=True, text=True, check=True)
        return [line.split(",") for line in decode.stdout.splitlines() if line and not line.startswith("#")]

    def test_every_rate_keeps_exact_frame_counts_and_a_gapless_grid(self):
        for rate in ("24000/1001", "25/1", "30000/1001", "30/1", "60000/1001"):
            rows = self.frames(self.source(f"{rate.replace('/', '-')}.mp4", rate), rate)
            self.assertEqual(len(rows), 20, rate)
            self.assertEqual([int(row[2]) for row in rows], list(range(20)), rate)  # pts in the output's 1/rate grid

    def test_a_rotated_source_turns_upright_and_keeps_its_count(self):
        turned = self.source("r.mp4", "30000/1001", rotation=90)
        rows = self.frames(turned, "30000/1001")
        self.assertEqual(len(rows), 20)
        self.assertEqual(rows[0][-1], self.reference(turned, "transpose=cclock,"))  # frame 5, turned as the matrix says
        self.assertNotEqual(rows[0][-1], self.reference(turned, ""))

    def reference(self, path, turn):
        graph = f"select='eq(n,5)',{turn}{join_sources.CPU_SCALE}"
        decode = subprocess.run([ffio.ffmpeg_bin(), "-v", "error", "-noautorotate", "-i", str(path), "-vf", graph, "-frames:v", "1", "-f", "framecrc", "-"],
                                capture_output=True, text=True, check=True)
        return next(line for line in decode.stdout.splitlines() if line and not line.startswith("#")).split(",")[-1]


if __name__ == "__main__":
    unittest.main()
